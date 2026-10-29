from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str
    details: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str
    timestamp: datetime


class ModelStatusResponse(BaseModel):
    name: str
    backend: str
    device: str
    ready: bool
    score_type: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ReadyResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    models: list[ModelStatusResponse]


class ModelListResponse(BaseModel):
    models: list[ModelStatusResponse]
    labels: dict[str, Any]
    catalog: dict[str, Any]
    policy: dict[str, Any]
    formats: dict[str, Any] = Field(default_factory=dict)


class AudioCandidateResponse(BaseModel):
    rank: int
    species_id: str | None = None
    scientific_name: str
    common_name_zh: str | None = None
    common_name_en: str | None = None
    score: float = Field(ge=0.0, le=1.0)
    score_type: Literal["birdnet_confidence", "mock"]
    confirming_windows: int = Field(ge=0)
    mapped: bool
    match: Literal["scientific_name", "common_name"] | None = None
    model_label: str
    window_scores: list[float] = Field(default_factory=list)


class AudioFileInfo(BaseModel):
    filename: str | None = None
    content_type: str | None = None
    format: str
    size_bytes: int
    duration_seconds: float
    sample_rate: int
    channels: int = 1
    original_sample_rate: int | None = None
    original_channels: int | None = None
    window_count: int
    zero_padded_seconds: float


class AudioPolicyResponse(BaseModel):
    min_score: float
    min_confirming_windows: int
    required_windows: int
    min_margin: float
    candidate_count: int
    window_seconds: float
    hop_seconds: float
    min_duration_seconds: float
    max_duration_seconds: float
    max_audio_bytes: int
    score_type: Literal["birdnet_confidence", "mock"]
    decision: str
    reason: str


class AudioTimingResponse(BaseModel):
    decode_ms: float
    inference_ms: float
    aggregate_ms: float
    total_ms: float


class AudioDiagnosticsResponse(BaseModel):
    top_labels: list[dict[str, Any]] = Field(default_factory=list)
    non_bird_top: dict[str, Any] | None = None
    windows: list[dict[str, Any]] = Field(default_factory=list)


class AudioAnalysisResponse(BaseModel):
    analysis_id: str
    state: Literal["candidate", "unknown"]
    candidates: list[AudioCandidateResponse] = Field(default_factory=list)
    model: ModelStatusResponse
    audio: AudioFileInfo
    policy: AudioPolicyResponse
    timing: AudioTimingResponse
    notes: list[str] = Field(default_factory=list)
    diagnostics: AudioDiagnosticsResponse | None = None
    client_reference: str | None = None
    created_at: datetime
