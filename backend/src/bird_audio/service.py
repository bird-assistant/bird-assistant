"""Analysis orchestration: staging, decoding, windowed inference and reporting."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from bird_audio.analyzer import (
    Candidate,
    Decision,
    Policy,
    WindowScore,
    decide,
    window_diagnostics,
)
from bird_audio.audio import AudioDecoder, AudioStager, DecodedAudio, StagedAudio, UploadFileLike
from bird_audio.config import AudioSettings
from bird_audio.engine import AudioEngine
from bird_audio.labels import ModelLabel, SpeciesLink
from bird_audio.metrics import AudioMetrics
from bird_audio.windows import (
    WindowPlan,
    extract_window,
    plan_windows,
    required_confirmations,
)
from bird_common.errors import ServiceError

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class AnalysisReport:
    analysis_id: str
    created_at: datetime
    decision: Decision
    audio: DecodedAudio
    staged: StagedAudio
    plans: tuple[WindowPlan, ...]
    windows: tuple[WindowScore, ...]
    policy: Policy
    timings: dict[str, float]
    notes: tuple[str, ...]
    requested_candidates: int
    client_reference: str | None

    @property
    def state(self) -> str:
        return self.decision.state

    @property
    def candidates(self) -> tuple[Candidate, ...]:
        return self.decision.candidates


class AudioAnalysisService:
    """One analysis at a time on the CPU model, with bounded admission."""

    def __init__(
        self,
        settings: AudioSettings,
        engine: AudioEngine,
        labels: Sequence[ModelLabel],
        links: Sequence[SpeciesLink],
        metrics: AudioMetrics,
        *,
        decoder: AudioDecoder | None = None,
        stager: AudioStager | None = None,
    ) -> None:
        self.settings = settings
        self.engine = engine
        self.labels = list(labels)
        self.links = list(links)
        self.metrics = metrics
        self.decoder = decoder or AudioDecoder(settings)
        self.stager = stager or AudioStager(settings)
        self.last_error: str | None = None
        self._admission_limit = settings.max_concurrent_analyses + settings.max_queued_analyses
        self._in_flight = 0
        self._admission_lock = threading.Lock()
        self._decode_slots = asyncio.Semaphore(settings.max_concurrent_decodes)
        self._analysis_slots = asyncio.Semaphore(settings.max_concurrent_analyses)
        self._inference_lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self.engine.ready

    @property
    def in_flight(self) -> int:
        return self._in_flight

    def admit(self) -> None:
        with self._admission_lock:
            if self._in_flight >= self._admission_limit:
                self.metrics.rejections.labels("AUDIO_CAPACITY_EXCEEDED").inc()
                raise ServiceError(
                    "AUDIO_CAPACITY_EXCEEDED",
                    "the audio service is at capacity; retry shortly",
                    429,
                    {"limit": self._admission_limit},
                )
            self._in_flight += 1
            self.metrics.in_flight.set(self._in_flight)

    def release(self) -> None:
        with self._admission_lock:
            self._in_flight = max(0, self._in_flight - 1)
            self.metrics.in_flight.set(self._in_flight)

    async def analyze(
        self,
        upload: UploadFileLike,
        *,
        top_k: int,
        client_reference: str | None = None,
        is_cancelled: Callable[[], Awaitable[bool]] | None = None,
    ) -> AnalysisReport:
        if not self.ready:
            raise ServiceError("SERVICE_NOT_READY", "audio model is not loaded", 503)
        started = time.perf_counter()
        staged = await self.stager.stage(upload)
        try:
            async with self._analysis_slots:
                try:
                    async with asyncio.timeout(self.settings.processing_timeout_seconds):
                        report = await self._analyze_staged(
                            staged, top_k=top_k, client_reference=client_reference, is_cancelled=is_cancelled
                        )
                except TimeoutError as exc:
                    self.metrics.rejections.labels("AUDIO_PROCESSING_TIMEOUT").inc()
                    raise ServiceError(
                        "AUDIO_PROCESSING_TIMEOUT",
                        "audio analysis exceeded the processing deadline",
                        504,
                        {"timeout_seconds": self.settings.processing_timeout_seconds},
                    ) from exc
        finally:
            self.stager.discard(staged)
        self.metrics.analysis_latency.observe(time.perf_counter() - started)
        self.metrics.analyses.labels(report.state, report.decision.reason).inc()
        LOGGER.info(
            "audio_analysis_finished",
            extra={
                "analysis_id": report.analysis_id,
                "state": report.state,
                "detail": report.decision.reason,
                "window_count": len(report.windows),
            },
        )
        return report

    async def _analyze_staged(
        self,
        staged: StagedAudio,
        *,
        top_k: int,
        client_reference: str | None,
        is_cancelled: Callable[[], Awaitable[bool]] | None,
    ) -> AnalysisReport:
        decode_started = time.perf_counter()
        async with self._decode_slots:
            audio = await asyncio.to_thread(self.decoder.decode, staged)
        decode_ms = (time.perf_counter() - decode_started) * 1000.0
        self.metrics.decode_latency.observe(decode_ms / 1000.0)
        if is_cancelled is not None and await is_cancelled():
            self.metrics.rejections.labels("ANALYSIS_CANCELLED").inc()
            raise ServiceError(
                "ANALYSIS_CANCELLED",
                "client disconnected before inference started",
                499,
            )
        plans = plan_windows(len(audio.samples), self.settings.window_samples, self.settings.hop_samples)
        windows = await asyncio.to_thread(self._run_windows, audio, plans)
        self.metrics.windows.inc(len(windows))
        aggregate_started = time.perf_counter()
        policy = Policy(
            min_score=self.settings.min_score,
            min_confirming_windows=self.settings.min_confirming_windows,
            min_margin=self.settings.min_margin,
            candidate_count=top_k,
            required_windows=required_confirmations(len(windows), self.settings.min_confirming_windows),
        )
        decision = decide(windows, self.labels, self.links, policy)
        aggregate_ms = (time.perf_counter() - aggregate_started) * 1000.0
        inference_ms = sum(window.inference_ms for window in windows)
        total_ms = decode_ms + inference_ms + aggregate_ms
        notes = self._notes(audio, plans, decision, len(windows))
        return AnalysisReport(
            analysis_id=f"aud_{uuid.uuid4().hex}",
            created_at=datetime.now(UTC),
            decision=decision,
            audio=audio,
            staged=staged,
            plans=tuple(plans),
            windows=tuple(windows),
            policy=policy,
            timings={
                "decode_ms": round(decode_ms, 3),
                "inference_ms": round(inference_ms, 3),
                "aggregate_ms": round(aggregate_ms, 3),
                "total_ms": round(total_ms, 3),
            },
            notes=notes,
            requested_candidates=top_k,
            client_reference=client_reference,
        )

    def _run_windows(self, audio: DecodedAudio, plans: Sequence[WindowPlan]) -> list[WindowScore]:
        settings = self.settings
        results: list[WindowScore] = []
        # The LiteRT interpreter is not re-entrant; a single lock serialises every
        # window even when the decode pool runs concurrently.
        with self._inference_lock:
            for plan in plans:
                window = extract_window(audio.samples, plan, settings.window_samples)
                started = time.perf_counter()
                try:
                    scores = self.engine.predict(window)
                except Exception as exc:  # noqa: BLE001 - reported as a service failure
                    self.last_error = f"{type(exc).__name__}: {exc}"
                    LOGGER.exception("audio inference failed", extra={"detail": "engine.predict"})
                    self.metrics.rejections.labels("INFERENCE_FAILED").inc()
                    raise ServiceError(
                        "INFERENCE_FAILED",
                        "the audio model failed to execute",
                        500,
                        {"stage": "inference", "window": plan.index},
                    ) from exc
                elapsed = (time.perf_counter() - started) * 1000.0
                self.metrics.inference_latency.observe(elapsed / 1000.0)
                results.append(
                    WindowScore(
                        index=plan.index,
                        start_seconds=plan.start_seconds(audio.sample_rate),
                        end_seconds=plan.end_seconds(audio.sample_rate),
                        padded=plan.padded,
                        scores=scores,
                        inference_ms=elapsed,
                    )
                )
        return results

    def _notes(
        self,
        audio: DecodedAudio,
        plans: Sequence[WindowPlan],
        decision: Decision,
        window_count: int,
    ) -> tuple[str, ...]:
        notes: list[str] = []
        if window_count == 1 and audio.duration_seconds < self.settings.window_seconds:
            notes.append("short_clip_zero_padded")
        if decision.required_windows < self.settings.min_confirming_windows:
            notes.append("reduced_window_confirmation")
        if decision.state == "unknown" and decision.top_non_bird:
            notes.append("non_bird_labels_excluded")
        if any(not candidate.mapped for candidate in decision.candidates):
            notes.append("unmapped_candidates_present")
        if self.engine.backend == "mock":
            notes.append("mock_engine")
        return tuple(notes)

    def diagnostics(self, report: AnalysisReport) -> dict[str, object]:
        return {
            "top_labels": list(report.decision.top_labels),
            "non_bird_top": report.decision.top_non_bird,
            "windows": list(window_diagnostics(report.windows, self.labels)),
        }
