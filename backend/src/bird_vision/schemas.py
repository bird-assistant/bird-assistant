from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class ModelInfo(BaseModel):
    name: str
    backend: str
    device: str
    ready: bool
    details: dict[str, Any] = Field(default_factory=dict)


class ReadyResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    models: list[ModelInfo]


class CreateSessionRequest(BaseModel):
    client_session_id: str | None = Field(default=None, max_length=128)
    observation_mode: Literal["live", "historical"] = "live"
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    region_code: str | None = Field(default=None, min_length=2, max_length=2)

    @field_validator("region_code")
    @classmethod
    def normalize_region_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.upper()
        if not normalized.isascii() or not normalized.isalpha():
            raise ValueError("region_code must be an ISO 3166-1 alpha-2 code")
        return normalized

    @model_validator(mode="after")
    def validate_coordinate_pair(self) -> CreateSessionRequest:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self


class CreateSessionResponse(BaseModel):
    session_id: str
    created_at: datetime
    expires_after_idle_seconds: int
    recommended_frame_interval_ms: int
    websocket_path: str
    observation_mode: Literal["live", "historical"]
    latitude: float | None
    longitude: float | None
    region_code: str | None
    catalog_version: str | None
    coordinates_used_for_inference: bool


class OccurrenceCachePrepareRequest(BaseModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    observed_at: datetime
    time_precision: Literal["exact", "date", "month", "unknown"] = "exact"


class OccurrenceCachePrepareResponse(BaseModel):
    status: Literal["ready", "pending", "failed", "unavailable"]
    source: Literal["offline_profile", "gbif"] | None = None
    candidate_count: int = Field(ge=0)


class SessionStats(BaseModel):
    accepted_frames: int
    processed_frames: int
    replaced_frames: int
    stale_frames: int
    failed_frames: int


class SessionResponse(BaseModel):
    session_id: str
    client_session_id: str | None
    state: Literal["active", "closing", "closed"]
    created_at: datetime
    last_activity_at: datetime
    observation_mode: Literal["live", "historical"]
    latitude: float | None
    longitude: float | None
    region_code: str | None
    stats: SessionStats
    coordinates_used_for_inference: bool


class FrameAcceptedResponse(BaseModel):
    accepted: Literal[True] = True
    session_id: str
    frame_id: str
    replaced_frame_id: str | None = None


class NormalizedBox(BaseModel):
    x1: float = Field(ge=0.0, le=1.0)
    y1: float = Field(ge=0.0, le=1.0)
    x2: float = Field(ge=0.0, le=1.0)
    y2: float = Field(ge=0.0, le=1.0)


class SpeciesCandidateResponse(BaseModel):
    species_id: str
    scientific_name: str
    common_name_zh: str | None = None
    common_name_en: str | None = None
    score: float
    score_type: Literal["relative_similarity", "mock"]
    similarity: float | None = None
    region_match: bool = False
    local_occurrence_count: int | None = None


class SpeciesDecisionResponse(BaseModel):
    accepted: bool
    reason: str
    top_similarity: float | None = None
    margin: float | None = None
    min_similarity: float | None = None
    min_margin: float | None = None
    candidate_count: int
    region_code: str | None = None
    catalog_version: str | None = None
    candidate_scope: Literal["local_seasonal", "country", "global"]
    location_profile_id: str | None = None
    location_profile_name: str | None = None
    location_distance_km: float | None = None
    observation_month: int | None = Field(default=None, ge=1, le=12)
    temporal_window_months: int | None = None
    occurrence_dataset_version: str | None = None
    coordinates_used: bool
    fallback_reason: str | None = None


class SpeciesResultResponse(BaseModel):
    state: Literal["unavailable", "waiting_for_quality", "unknown", "candidate"]
    stability: Literal["stable", "held", "switch_pending"] | None = None
    model: str | None = None
    candidates: list[SpeciesCandidateResponse] = Field(default_factory=list)
    decision: SpeciesDecisionResponse | None = None
    note: str


class SpeciesCatalogItem(BaseModel):
    species_id: str
    scientific_name: str
    common_name_zh: str | None = None
    common_name_en: str | None = None
    order: str | None = None
    family: str | None = None
    ebird_code: str | None = None
    avibase_id: str | None = None
    region_codes: list[str] = Field(default_factory=list)
    extinction_status: str | None = None
    iucn_status: str | None = None
    enabled: bool


class SpeciesCatalogPage(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[SpeciesCatalogItem]


class SpeciesCatalogInfo(BaseModel):
    available: bool
    path: str | None = None
    source: str | None = None
    version: str | None = None
    license: str | None = None
    checksum_sha256: str | None = None
    total_species: int = 0
    enabled_species: int = 0
    region_counts: dict[str, int] = Field(default_factory=dict)


class TrackResponse(BaseModel):
    track_id: int
    state: Literal["tentative", "confirmed"]
    visibility: Literal["detected", "temporarily_lost"]
    bbox: NormalizedBox
    detection_score: float
    short_side_px: float
    recognizable: bool
    hits: int
    species: SpeciesResultResponse


class TimingResponse(BaseModel):
    queue_ms: float
    decode_ms: float
    preprocess_ms: float
    detection_ms: float
    postprocess_ms: float
    species_ms: float
    total_ms: float


class ObservationContextResponse(BaseModel):
    observed_at: datetime
    time_source: Literal["captured_at", "received_at"]
    time_precision: Literal["exact", "date", "month", "unknown"]
    latitude: float | None = None
    longitude: float | None = None
    coordinate_source: Literal["frame", "session", "none"]
    region_code: str | None = None


class FrameResultEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["vision.frame.result"] = "vision.frame.result"
    event_id: str
    occurred_at: datetime
    session_id: str
    frame_id: str
    captured_at: datetime | None
    observation_context: ObservationContextResponse
    image_width: int
    image_height: int
    tracks: list[TrackResponse]
    timing: TimingResponse


class StatusEvent(BaseModel):
    type: Literal[
        "vision.session.started",
        "vision.session.closed",
        "vision.frame.dropped",
        "vision.frame.error",
        "vision.heartbeat",
    ]
    event_id: str
    occurred_at: datetime
    session_id: str
    frame_id: str | None = None
    reason: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class PhotoCandidateResponse(BaseModel):
    rank: int
    species_id: str
    scientific_name: str
    common_name_zh: str | None = None
    common_name_en: str | None = None
    score: float
    score_type: Literal["relative_similarity", "mock"]
    similarity: float | None = None
    region_match: bool = False
    local_occurrence_count: int | None = None


class PhotoSubjectResponse(BaseModel):
    rank: int
    bbox: NormalizedBox
    detection_score: float
    short_side_px: float
    state: Literal["candidate", "unknown"]
    reason: str
    candidates: list[PhotoCandidateResponse] = Field(default_factory=list)


class PhotoImageInfo(BaseModel):
    filename: str | None = None
    content_type: str | None = None
    width: int
    height: int
    size_bytes: int


class PhotoPolicyResponse(BaseModel):
    max_subjects: int
    min_short_side_px: int
    detection_confidence: float
    candidate_count: int
    decision: Literal["candidate", "unknown"]
    reason: str
    score_type: str


class PhotoTimingResponse(BaseModel):
    decode_ms: float
    detection_ms: float
    species_ms: float
    total_ms: float


class PhotoAnalysisResponse(BaseModel):
    analysis_id: str
    state: Literal["candidate", "unknown"]
    candidates: list[PhotoCandidateResponse] = Field(default_factory=list)
    subjects: list[PhotoSubjectResponse] = Field(default_factory=list)
    model: ModelInfo
    image: PhotoImageInfo
    policy: PhotoPolicyResponse
    timing: PhotoTimingResponse
    notes: list[str] = Field(default_factory=list)
    created_at: datetime
