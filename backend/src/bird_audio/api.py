from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException
from starlette.requests import Request as StarletteRequest

from bird_audio.audio import CONTENT_TYPE_FAMILIES, SUPPORTED_FORMATS
from bird_audio.config import AudioSettings
from bird_audio.schemas import (
    AudioAnalysisResponse,
    AudioCandidateResponse,
    AudioDiagnosticsResponse,
    AudioFileInfo,
    AudioPolicyResponse,
    AudioTimingResponse,
    HealthResponse,
    ModelListResponse,
    ModelStatusResponse,
    ReadyResponse,
)
from bird_audio.service import AnalysisReport, AudioAnalysisService
from bird_common.auth import Principal, require_principal
from bird_common.errors import ServiceError

ANALYSIS_PATH = "/api/v1/audio/analyses"
MULTIPART_OVERHEAD_BYTES = 64 * 1024

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    408: {"description": "Upload or decode deadline exceeded"},
    413: {"description": "Audio exceeds the byte or duration limit"},
    415: {"description": "Unsupported or mismatched container"},
    422: {"description": "Empty, unreadable or too short audio"},
    429: {"description": "Service capacity exhausted"},
    503: {"description": "Model or ffmpeg runtime unavailable"},
    504: {"description": "Processing deadline exceeded"},
}


class AudioAnalysisRoute(APIRoute):
    """Reject oversized bodies and slow uploads before they reach the model queue."""

    def get_route_handler(self):
        handler = super().get_route_handler()
        if self.path != ANALYSIS_PATH:
            return handler

        async def admitted(request: Request):
            settings: AudioSettings = request.app.state.settings
            service: AudioAnalysisService = request.app.state.service
            request.app.state.auth.verify_request(request)
            service.admit()
            limit = settings.max_audio_bytes + MULTIPART_OVERHEAD_BYTES
            received = 0

            async def limited_receive():
                nonlocal received
                message = await request.receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > limit:
                        raise ServiceError("AUDIO_TOO_LARGE", "upload exceeds the byte limit", 413)
                return message

            bounded = StarletteRequest(request.scope, limited_receive)
            try:
                content_length = request.headers.get("content-length")
                if content_length:
                    try:
                        length = int(content_length)
                    except ValueError as exc:
                        raise ServiceError("INVALID_CONTENT_LENGTH", "invalid Content-Length", 422) from exc
                    if length < 0 or length > limit:
                        raise ServiceError("AUDIO_TOO_LARGE", "upload exceeds the byte limit", 413)
                try:
                    async with asyncio.timeout(settings.upload_timeout_seconds):
                        await bounded.form(max_files=1, max_fields=5, max_part_size=1024)
                except TimeoutError as exc:
                    raise ServiceError("AUDIO_UPLOAD_TIMEOUT", "audio upload timed out", 408) from exc
                except HTTPException as exc:
                    raise ServiceError("INVALID_MULTIPART", "invalid audio multipart body", 422) from exc
                return await handler(bounded)
            finally:
                await bounded.close()
                service.release()

        return admitted


router = APIRouter(route_class=AudioAnalysisRoute)


@router.get("/healthz", response_model=HealthResponse, tags=["operations"])
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        service=settings.service_name,
        version=settings.service_version,
        timestamp=datetime.now(UTC),
    )


def _runtime_status(request: Request) -> ModelStatusResponse:
    settings: AudioSettings = request.app.state.settings
    service: AudioAnalysisService = request.app.state.service
    ffmpeg = getattr(request.app.state, "ffmpeg_path", None)
    details: dict[str, Any] = {
        "ffmpeg_path": ffmpeg,
        "labels_source": getattr(request.app.state, "labels_source", None),
        "labels": request.app.state.label_summary,
        "temp_dir": str(settings.temp_dir) if settings.temp_dir else None,
        "max_concurrent_analyses": settings.max_concurrent_analyses,
        "max_queued_analyses": settings.max_queued_analyses,
        "in_flight": service.in_flight,
        "last_error": service.last_error,
    }
    return ModelStatusResponse(
        name="audio-analysis-runtime",
        backend="ffmpeg+ai-edge-litert",
        device="cpu",
        ready=bool(ffmpeg) and service.ready,
        score_type=service.engine.score_type,
        details=details,
    )


@router.get("/readyz", response_model=ReadyResponse, tags=["operations"])
async def readiness(request: Request) -> Response:
    settings: AudioSettings = request.app.state.settings
    service: AudioAnalysisService = request.app.state.service
    models = [
        ModelStatusResponse(
            name=service.engine.name,
            backend=service.engine.backend,
            device=service.engine.device,
            ready=service.engine.ready,
            score_type=service.engine.score_type,
            details=service.engine.metadata(),
        ),
        _runtime_status(request),
    ]
    ready = all(model.ready for model in models)
    if settings.environment == "production":
        ready = ready and service.engine.backend == "ai-edge-litert"
    body = ReadyResponse(status="ready" if ready else "not_ready", models=models)
    return JSONResponse(status_code=200 if ready else 503, content=body.model_dump(mode="json"))


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request, _: Annotated[Principal, Depends(require_principal)]) -> Response:
    return Response(request.app.state.metrics.render(), media_type="text/plain; version=0.0.4")


def policy_payload(settings: AudioSettings, *, required_windows: int | None = None) -> dict[str, Any]:
    return {
        "min_score": settings.min_score,
        "min_confirming_windows": settings.min_confirming_windows,
        "required_windows": (
            settings.min_confirming_windows if required_windows is None else required_windows
        ),
        "min_margin": settings.min_margin,
        "candidate_count": settings.candidate_count,
        "window_seconds": settings.window_seconds,
        "hop_seconds": settings.hop_seconds,
        "min_duration_seconds": settings.min_duration_seconds,
        "max_duration_seconds": settings.max_duration_seconds,
        "max_audio_bytes": settings.max_audio_bytes,
    }


@router.get("/api/v1/models", response_model=ModelListResponse, tags=["models"])
async def list_models(
    request: Request, _: Annotated[Principal, Depends(require_principal)]
) -> ModelListResponse:
    settings: AudioSettings = request.app.state.settings
    service: AudioAnalysisService = request.app.state.service
    return ModelListResponse(
        models=[
            ModelStatusResponse(
                name=service.engine.name,
                backend=service.engine.backend,
                device=service.engine.device,
                ready=service.engine.ready,
                score_type=service.engine.score_type,
                details={**service.engine.metadata(), "version": settings.model_version},
            ),
            _runtime_status(request),
        ],
        labels=dict(request.app.state.label_summary),
        catalog=dict(request.app.state.catalog_info),
        policy={
            **policy_payload(settings),
            "score_type": service.engine.score_type,
            "aggregation": "max_window_score",
        },
        formats={
            "accepted": list(SUPPORTED_FORMATS),
            "content_types": sorted(CONTENT_TYPE_FAMILIES),
            "max_bytes": settings.max_audio_bytes,
            "min_duration_seconds": settings.min_duration_seconds,
        },
    )


def _candidate_response(index: int, candidate, score_type: str) -> AudioCandidateResponse:
    return AudioCandidateResponse(
        rank=index,
        species_id=candidate.species_id,
        scientific_name=candidate.scientific_name,
        common_name_zh=candidate.common_name_zh,
        common_name_en=candidate.common_name_en,
        score=round(candidate.score, 6),
        score_type=score_type,
        confirming_windows=candidate.confirming_windows,
        mapped=candidate.mapped,
        match=candidate.match,
        model_label=candidate.model_label,
        window_scores=[round(value, 6) for value in candidate.window_scores],
    )


def build_analysis_response(
    report: AnalysisReport, service: AudioAnalysisService, settings: AudioSettings
) -> AudioAnalysisResponse:
    score_type = service.engine.score_type
    zero_padded = sum(
        max(0.0, settings.window_seconds - (plan.length_samples / settings.sample_rate))
        for plan in report.plans
    )
    audio = AudioFileInfo(
        filename=report.staged.filename,
        content_type=report.staged.content_type,
        format=report.audio.container,
        size_bytes=report.staged.size_bytes,
        duration_seconds=round(report.audio.duration_seconds, 3),
        sample_rate=report.audio.sample_rate,
        channels=1,
        original_sample_rate=report.audio.source_sample_rate,
        original_channels=report.audio.source_channels,
        window_count=len(report.windows),
        zero_padded_seconds=round(zero_padded, 3),
    )
    policy = AudioPolicyResponse(
        **policy_payload(settings, required_windows=report.policy.required_windows),
        score_type=score_type,
        decision=report.decision.state,
        reason=report.decision.reason,
    )
    diagnostics = None
    if settings.include_diagnostics:
        raw = service.diagnostics(report)
        diagnostics = AudioDiagnosticsResponse.model_validate(raw)
    return AudioAnalysisResponse(
        analysis_id=report.analysis_id,
        state=report.state,
        candidates=[
            _candidate_response(rank, candidate, score_type)
            for rank, candidate in enumerate(report.candidates, start=1)
        ],
        model=ModelStatusResponse(
            name=service.engine.name,
            backend=service.engine.backend,
            device=service.engine.device,
            ready=service.engine.ready,
            score_type=score_type,
            details={**service.engine.metadata(), "version": settings.model_version},
        ),
        audio=audio,
        policy=policy,
        timing=AudioTimingResponse(**report.timings),
        notes=list(report.notes),
        diagnostics=diagnostics,
        client_reference=report.client_reference,
        created_at=report.created_at,
    )


@router.post(
    ANALYSIS_PATH,
    response_model=AudioAnalysisResponse,
    response_model_exclude_none=False,
    responses=ERROR_RESPONSES,
    tags=["audio"],
)
async def create_analysis(
    request: Request,
    _: Annotated[Principal, Depends(require_principal)],
    audio: Annotated[UploadFile, File(description="Recorded clip: MP3, WAV, AAC or M4A")],
    top_k: Annotated[int | None, Form(ge=1, le=50, description="Candidate count")] = None,
    client_reference: Annotated[
        str | None, Form(max_length=128, description="Caller-side id echoed back")
    ] = None,
) -> AudioAnalysisResponse:
    settings: AudioSettings = request.app.state.settings
    service: AudioAnalysisService = request.app.state.service
    candidate_count = settings.candidate_count if top_k is None else top_k
    if candidate_count > settings.max_candidate_count:
        raise ServiceError(
            "INVALID_CANDIDATE_COUNT",
            "top_k exceeds the configured maximum",
            422,
            {"top_k": candidate_count, "max": settings.max_candidate_count},
        )
    report = await service.analyze(
        audio,
        top_k=candidate_count,
        client_reference=client_reference,
        is_cancelled=request.is_disconnected,
    )
    return build_analysis_response(report, service, settings)
