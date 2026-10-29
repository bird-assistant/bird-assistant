from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


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


class ReadyResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    database: str
    observations: int


class ObservationCreate(BaseModel):
    source: Literal["audio", "photo"]
    source_analysis_id: str = Field(min_length=1, max_length=128)
    species_id: str = Field(min_length=1, max_length=128)
    scientific_name: str = Field(min_length=1, max_length=200)
    common_name_zh: str | None = Field(default=None, max_length=200)
    common_name_en: str | None = Field(default=None, max_length=200)
    score: float | None = Field(default=None, ge=0.0, le=1.0)
    score_type: str | None = Field(default=None, max_length=64)
    observed_at: datetime | None = None
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    region_code: str | None = Field(default=None, min_length=2, max_length=2)
    note: str | None = Field(default=None, max_length=20_000)
    client_reference: str | None = Field(default=None, max_length=128)

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
    def validate_coordinate_pair(self) -> ObservationCreate:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self


class ObservationResponse(BaseModel):
    observation_id: str
    created_at: datetime
    observed_at: datetime
    source: Literal["audio", "photo"]
    source_analysis_id: str
    species_id: str
    scientific_name: str
    common_name_zh: str | None = None
    common_name_en: str | None = None
    score: float | None = None
    score_type: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    region_code: str | None = None
    note: str | None = None
    client_reference: str | None = None


class ObservationPage(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[ObservationResponse]
