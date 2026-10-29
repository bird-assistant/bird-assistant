from __future__ import annotations

import array
import asyncio
import time
from pathlib import Path

import pytest

from bird_audio.audio import DecodedAudio, StagedAudio
from bird_audio.labels import ModelLabel, SpeciesLink
from bird_audio.metrics import AudioMetrics
from bird_audio.service import AudioAnalysisService
from bird_common.errors import ServiceError

LABELS = [
    ModelLabel(0, "Turdus merula_Eurasian Blackbird", "Turdus merula", "Eurasian Blackbird", True),
    ModelLabel(1, "Parus major_Great Tit", "Parus major", "Great Tit", True),
    ModelLabel(2, "Human vocal_Human vocal", "Human vocal", "Human vocal", False),
]
LINKS = [SpeciesLink("turdus", "乌鸫", "Eurasian Blackbird", "scientific_name"), SpeciesLink(), SpeciesLink()]


class FakeUpload:
    filename = "voice.mp3"
    content_type = "audio/mpeg"

    def __init__(self, data: bytes = b"ID3\x04fake-audio") -> None:
        self._data = data

    async def read(self, size: int = -1) -> bytes:
        chunk, self._data = self._data, b""
        return chunk


class FakeDecoder:
    def __init__(self, *, duration_seconds: float = 6.0, delay: float = 0.0, error=None) -> None:
        self.duration_seconds = duration_seconds
        self.delay = delay
        self.error = error
        self.calls = 0

    def decode(self, staged: StagedAudio) -> DecodedAudio:
        self.calls += 1
        if self.delay:
            time.sleep(self.delay)
        if self.error is not None:
            raise self.error
        samples = array.array("f", [0.1] * int(self.duration_seconds * 48_000))
        return DecodedAudio(
            samples=samples,
            sample_rate=48_000,
            duration_seconds=len(samples) / 48_000,
            container="mp3",
            source_codec="mp3",
            source_sample_rate=44_100,
            source_channels=1,
            decode_ms=1.5,
        )


class FakeEngine:
    name = "fake-birdnet"
    backend = "mock"
    device = "cpu"
    score_type = "mock"

    def __init__(self, scores: list[list[float]] | None = None, *, error: Exception | None = None) -> None:
        self.scores = scores or [[0.91, 0.12, 0.03]]
        self.error = error
        self.ready = True
        self.calls = 0

    def load(self) -> None:
        self.ready = True

    def predict(self, window) -> list[float]:  # noqa: ANN001 - test double
        index = min(self.calls, len(self.scores) - 1)
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.scores[index]

    def metadata(self) -> dict:
        return {"fake": True}

    def close(self) -> None:
        self.ready = False


def make_service(settings, *, decoder=None, engine=None, metrics=None) -> AudioAnalysisService:
    return AudioAnalysisService(
        settings,
        engine or FakeEngine(),
        LABELS,
        LINKS,
        metrics or AudioMetrics(),
        decoder=decoder or FakeDecoder(),
    )


async def test_analyze_returns_candidates_and_cleans_up(audio_settings) -> None:
    service = make_service(audio_settings, decoder=FakeDecoder(duration_seconds=6.0))
    service.admit()
    try:
        report = await service.analyze(FakeUpload(), top_k=3, client_reference="wx-1")
    finally:
        service.release()
    assert report.state == "candidate"
    assert report.candidates[0].species_id == "turdus"
    assert report.client_reference == "wx-1"
    assert report.analysis_id.startswith("aud_")
    assert set(report.timings) == {"decode_ms", "inference_ms", "aggregate_ms", "total_ms"}
    assert len(report.windows) == 3
    assert "mock_engine" in report.notes
    assert not report.staged.path.exists()
    assert service.in_flight == 0


async def test_short_clip_sets_padding_notes(audio_settings) -> None:
    service = make_service(audio_settings, decoder=FakeDecoder(duration_seconds=2.0))
    service.admit()
    try:
        report = await service.analyze(FakeUpload(), top_k=3)
    finally:
        service.release()
    assert len(report.windows) == 1
    assert report.policy.required_windows == 1
    assert "short_clip_zero_padded" in report.notes
    assert "reduced_window_confirmation" in report.notes


async def test_unknown_state_when_scores_stay_low(audio_settings) -> None:
    engine = FakeEngine([[0.1, 0.05, 0.01]])
    service = make_service(audio_settings, engine=engine)
    service.admit()
    try:
        report = await service.analyze(FakeUpload(), top_k=3)
    finally:
        service.release()
    assert report.state == "unknown"
    assert report.decision.reason == "no_label_above_threshold"
    assert report.candidates == ()


async def test_service_not_ready_is_rejected(audio_settings) -> None:
    engine = FakeEngine()
    engine.ready = False
    service = make_service(audio_settings, engine=engine)
    with pytest.raises(ServiceError) as excinfo:
        await service.analyze(FakeUpload(), top_k=3)
    assert excinfo.value.code == "SERVICE_NOT_READY"
    assert excinfo.value.status_code == 503


async def test_capacity_is_bounded(audio_settings) -> None:
    settings = audio_settings.model_copy(update={"max_concurrent_analyses": 1, "max_queued_analyses": 0})
    service = make_service(settings)
    service.admit()
    with pytest.raises(ServiceError) as excinfo:
        service.admit()
    assert excinfo.value.code == "AUDIO_CAPACITY_EXCEEDED"
    assert excinfo.value.status_code == 429
    service.release()
    service.admit()
    service.release()
    assert service.in_flight == 0


async def test_processing_timeout_is_mapped(audio_settings) -> None:
    settings = audio_settings.model_copy(update={"processing_timeout_seconds": 0.05})
    service = make_service(settings, decoder=FakeDecoder(delay=0.3))
    with pytest.raises(ServiceError) as excinfo:
        await service.analyze(FakeUpload(), top_k=3)
    assert excinfo.value.code == "AUDIO_PROCESSING_TIMEOUT"
    assert excinfo.value.status_code == 504


async def test_decode_errors_keep_the_documented_code(audio_settings) -> None:
    error = ServiceError("AUDIO_TOO_SHORT", "audio is shorter than the minimum", 422)
    service = make_service(audio_settings, decoder=FakeDecoder(error=error))
    with pytest.raises(ServiceError) as excinfo:
        await service.analyze(FakeUpload(), top_k=3)
    assert excinfo.value.code == "AUDIO_TOO_SHORT"
    assert service.in_flight == 0


async def test_client_disconnect_before_inference_aborts(audio_settings) -> None:
    service = make_service(audio_settings)

    async def cancelled() -> bool:
        return True

    with pytest.raises(ServiceError) as excinfo:
        await service.analyze(FakeUpload(), top_k=3, is_cancelled=cancelled)
    assert excinfo.value.code == "ANALYSIS_CANCELLED"
    assert excinfo.value.status_code == 499


async def test_engine_failure_is_reported_as_service_error(audio_settings) -> None:
    engine = FakeEngine(error=RuntimeError("interpreter exploded"))
    service = make_service(audio_settings, engine=engine)
    with pytest.raises(ServiceError) as excinfo:
        await service.analyze(FakeUpload(), top_k=3)
    assert excinfo.value.code == "INFERENCE_FAILED"
    assert excinfo.value.status_code == 500
    assert excinfo.value.details == {"stage": "inference", "window": 0}
    assert service.last_error is not None and "interpreter exploded" in service.last_error


async def test_staged_file_is_removed_after_a_decode_failure(audio_settings, tmp_path) -> None:
    error = ServiceError("AUDIO_DECODE_FAILED", "audio cannot be decoded", 422)
    service = make_service(audio_settings, decoder=FakeDecoder(error=error))
    created: list[Path] = []

    class RecordingStager:
        def __init__(self) -> None:
            from bird_audio.audio import AudioStager

            self.inner = AudioStager(audio_settings)

        async def stage(self, upload):  # noqa: ANN001 - test double
            staged = await self.inner.stage(upload)
            created.append(staged.path)
            return staged

        def discard(self, staged):  # noqa: ANN001 - test double
            self.inner.discard(staged)

    service.stager = RecordingStager()
    with pytest.raises(ServiceError):
        await service.analyze(FakeUpload(), top_k=3)
    assert created and not created[0].exists()


async def test_diagnostics_include_windows_and_non_bird(audio_settings) -> None:
    engine = FakeEngine([[0.05, 0.02, 0.88]])
    service = make_service(audio_settings, engine=engine)
    service.admit()
    try:
        report = await service.analyze(FakeUpload(), top_k=3)
    finally:
        service.release()
    diagnostics = service.diagnostics(report)
    assert diagnostics["non_bird_top"]["model_label"] == "Human vocal_Human vocal"
    assert diagnostics["windows"][0]["top_labels"][0]["is_bird"] is False
    assert diagnostics["top_labels"][0]["model_label"] == "Human vocal_Human vocal"


async def test_analysis_metrics_are_recorded(audio_settings) -> None:
    metrics = AudioMetrics()
    service = make_service(audio_settings, metrics=metrics)
    service.admit()
    try:
        await service.analyze(FakeUpload(), top_k=3)
    finally:
        service.release()
    text = metrics.render().decode()
    assert 'bird_audio_analyses_total{reason="candidate_above_threshold",state="candidate"} 1.0' in text
    assert "bird_audio_decode_duration_seconds_count 1.0" in text


def test_run_windows_is_serialised() -> None:
    # The engine lock is not re-entrant, so two concurrent calls must not overlap.
    settings = AudioSettingsForTest()
    service = make_service(settings)
    decoder = FakeDecoder()
    audio = decoder.decode(StagedAudio(Path("x"), 0, b"", None, None))
    from bird_audio.windows import plan_windows

    plans = plan_windows(len(audio.samples), settings.window_samples, settings.hop_samples)

    async def run() -> None:
        await asyncio.gather(
            asyncio.to_thread(service._run_windows, audio, plans),
            asyncio.to_thread(service._run_windows, audio, plans),
        )

    asyncio.run(run())
    assert service.engine.calls == 2 * len(plans)


def AudioSettingsForTest():  # noqa: N802 - helper mirroring the fixture
    from bird_audio.config import AudioSettings

    return AudioSettings(environment="test", engine_backend="mock")
