from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from ``BIRD_VISION_*`` variables."""

    model_config = SettingsConfigDict(
        env_prefix="BIRD_VISION_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    service_name: str = "bird-vision-service"
    service_version: str = "0.3.0"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    detector_backend: Literal["mock", "yolo"] = "mock"
    device: Literal["auto", "cpu", "cuda"] = "cpu"
    model_path: Path = Path("../鸟类识别预研/models/yolo11n.pt")
    model_sha256: str | None = None
    model_image_size: int = Field(default=640, ge=320, le=1920)
    detection_confidence: float = Field(default=0.25, ge=0.0, le=1.0)
    detection_iou: float = Field(default=0.50, ge=0.0, le=1.0)
    detection_class_ids: str = "14"
    detection_expected_class_names: str = "bird"
    detection_max_detections: int = Field(default=50, ge=1, le=1000)
    warmup_on_start: bool = True

    species_backend: Literal["disabled", "mock", "bioclip"] = "disabled"
    species_catalog_path: Path | None = None
    bioclip_model: str = "hf-hub:imageomics/bioclip-2"
    bioclip_model_revision: str | None = None
    bioclip_expected_fingerprint: str | None = None
    species_warmup_on_start: bool = True
    species_top_k: int = Field(default=5, ge=1, le=20)
    species_batch_size: int = Field(default=8, ge=1, le=64)
    species_text_batch_size: int = Field(default=256, ge=16, le=2048)
    species_precision: Literal["auto", "fp32", "fp16"] = "auto"
    species_text_cache_dir: Path = Path("runtime/species-text-cache")
    # Location-aware filtering is opt-in; without request coordinates the
    # classifier must remain global rather than silently assuming China.
    species_default_region_code: str | None = None
    species_occurrence_path: Path | None = None
    species_live_occurrence_enabled: bool = True
    species_live_occurrence_radius_km: float = Field(default=100.0, ge=1.0, le=500.0)
    species_live_occurrence_facet_limit: int = Field(default=100, ge=2, le=1000)
    species_live_occurrence_cache_ttl_seconds: int = Field(default=86_400, ge=60, le=2_592_000)
    species_live_occurrence_timeout_seconds: float = Field(default=8.0, gt=1.0, le=30.0)
    species_temporal_window_months: int = Field(default=1, ge=0, le=3)
    species_min_local_candidates: int = Field(default=2, ge=2, le=10_000)
    species_min_similarity: float = Field(default=0.20, ge=-1.0, le=1.0)
    species_min_margin: float = Field(default=0.01, ge=0.0, le=2.0)

    api_keys: str = ""
    allow_anonymous: bool = True

    max_image_bytes: int = Field(default=6 * 1024 * 1024, ge=1024)
    max_image_pixels: int = Field(default=3840 * 2160, ge=1024)
    max_sessions: int = Field(default=64, ge=1, le=10_000)
    max_sessions_per_principal: int = Field(default=8, ge=1, le=1000)
    max_frame_rate: float = Field(default=5.0, gt=0.0, le=30.0)
    max_frames_per_session: int = Field(default=100_000, ge=1, le=10_000_000)
    frame_max_queue_age_ms: int = Field(default=2000, ge=100, le=60_000)
    session_idle_ttl_seconds: int = Field(default=300, ge=10, le=86_400)
    max_concurrent_inference: int = Field(default=1, ge=1, le=1)
    inference_timeout_seconds: float = Field(default=30.0, gt=0, le=3600)
    max_concurrent_decodes: int = Field(default=4, ge=1, le=32)
    upload_timeout_seconds: float = Field(default=15.0, gt=0, le=300)
    max_buffered_image_bytes: int = Field(default=512 * 1024 * 1024, ge=1024 * 1024)
    max_saved_crop_bytes: int = Field(default=128 * 1024 * 1024, ge=1024 * 1024)
    subscriber_queue_size: int = Field(default=16, ge=1, le=1024)
    max_subscribers_per_session: int = Field(default=2, ge=1, le=128)
    max_capture_clock_skew_seconds: int = Field(default=300, ge=0, le=86_400)

    tracker_backend: Literal["auto", "motion", "bytetrack"] = "auto"
    track_iou_threshold: float = Field(default=0.30, ge=0.0, le=1.0)
    track_high_confidence: float = Field(default=0.25, ge=0.0, le=1.0)
    track_low_confidence: float = Field(default=0.10, ge=0.0, le=1.0)
    track_center_distance_threshold: float = Field(default=1.50, gt=0.0, le=10.0)
    track_max_missed_frames: int = Field(default=5, ge=0, le=120)
    track_confirm_hits: int = Field(default=3, ge=1, le=120)
    min_recognizable_side_px: int = Field(default=64, ge=8, le=4096)
    species_max_crop_side_px: int = Field(default=1024, ge=64, le=4096)
    crop_padding_ratio: float = Field(default=0.15, ge=0.0, le=1.0)
    classification_cooldown_seconds: float = Field(default=5.0, ge=0.0, le=3600.0)
    classification_min_quality_gain: float = Field(default=0.10, ge=0.0, le=10.0)
    classification_refresh_seconds: float = Field(default=15.0, gt=0.0, le=3600.0)
    species_evidence_window: int = Field(default=5, ge=1, le=32)
    species_switch_confirmations: int = Field(default=2, ge=1, le=10)

    cors_origins: str = ""

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        value = value.upper()
        if value not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("unsupported log level")
        return value

    @field_validator("species_default_region_code")
    @classmethod
    def validate_region_code(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().upper()
        if len(normalized) != 2 or not normalized.isascii() or not normalized.isalpha():
            raise ValueError("species default region code must be a two-letter country code")
        return normalized

    @model_validator(mode="after")
    def validate_production_security(self) -> Settings:
        if self.environment == "production" and self.allow_anonymous:
            raise ValueError("production must set BIRD_VISION_ALLOW_ANONYMOUS=false")
        if self.environment == "production" and not self.api_key_set:
            raise ValueError("production must configure BIRD_VISION_API_KEYS")
        if self.environment == "production" and self.detector_backend != "yolo":
            raise ValueError("production must set BIRD_VISION_DETECTOR_BACKEND=yolo")
        if self.environment == "production" and self.species_backend != "bioclip":
            raise ValueError("production must set BIRD_VISION_SPECIES_BACKEND=bioclip")
        if self.environment == "production" and self.device != "cuda":
            raise ValueError("production must set BIRD_VISION_DEVICE=cuda")
        if self.environment == "production" and self.tracker_backend == "motion":
            raise ValueError("production requires the ByteTrack tracker")
        if self.environment == "production" and not self.model_path.expanduser().is_file():
            raise ValueError("production detector weights must be an existing local file")
        if self.environment == "production" and not self.model_sha256:
            raise ValueError("production must configure BIRD_VISION_MODEL_SHA256")
        if (
            self.environment == "production"
            and self.bioclip_model.startswith("hf-hub:")
            and not re.fullmatch(r"[0-9a-fA-F]{40}", self.bioclip_model_revision or "")
        ):
            raise ValueError("production BIOCLIP_MODEL_REVISION must be a full 40-character commit SHA")
        if self.environment == "production" and not self.bioclip_expected_fingerprint:
            raise ValueError("production must configure BIRD_VISION_BIOCLIP_EXPECTED_FINGERPRINT")
        if self.species_backend == "bioclip" and self.species_catalog_path is None:
            raise ValueError("BioCLIP requires BIRD_VISION_SPECIES_CATALOG_PATH")
        if (
            self.environment == "production"
            and self.species_occurrence_path is not None
            and not self.species_occurrence_path.expanduser().is_file()
        ):
            raise ValueError("production occurrence profile must be an existing local file")
        for field_name in ("model_sha256", "bioclip_expected_fingerprint"):
            value = getattr(self, field_name)
            invalid_digest = value is not None and (
                len(value) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in value)
            )
            if invalid_digest:
                raise ValueError(f"{field_name} must be a 64-character SHA-256 hexadecimal digest")
        if self.max_sessions_per_principal > self.max_sessions:
            raise ValueError("max_sessions_per_principal cannot exceed max_sessions")
        minimum_image_reservation = self.max_image_bytes + self.max_image_pixels * 16
        if self.max_buffered_image_bytes < minimum_image_reservation:
            raise ValueError("max_buffered_image_bytes must fit one worst-case upload/decode reservation")
        if self.classification_refresh_seconds < self.classification_cooldown_seconds:
            raise ValueError("classification_refresh_seconds cannot be below classification_cooldown_seconds")
        if self.track_low_confidence > self.track_high_confidence:
            raise ValueError("track_low_confidence cannot exceed track_high_confidence")
        return self

    @property
    def api_key_set(self) -> frozenset[str]:
        return frozenset(part.strip() for part in self.api_keys.split(",") if part.strip())

    @property
    def class_id_list(self) -> list[int]:
        return [int(part.strip()) for part in self.detection_class_ids.split(",") if part.strip()]

    @property
    def expected_class_name_set(self) -> frozenset[str]:
        return frozenset(
            part.strip().casefold() for part in self.detection_expected_class_names.split(",") if part.strip()
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [part.strip() for part in self.cors_origins.split(",") if part.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
