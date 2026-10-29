from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AudioSettings(BaseSettings):
    """Runtime configuration for the audio service, loaded from ``BIRD_AUDIO_*``."""

    model_config = SettingsConfigDict(
        env_prefix="BIRD_AUDIO_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    service_name: str = "bird-audio-service"
    service_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # mock keeps API development possible without the 49 MB model; birdnet loads
    # the exact LiteRT graph at startup and refuses to serve if it cannot.
    engine_backend: Literal["mock", "birdnet"] = "mock"
    model_path: Path = Path("../鸟类识别预研/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite")
    labels_path: Path = Path("../鸟类识别预研/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Labels.txt")
    model_name: str = "BirdNET_GLOBAL_6K_V2.4"
    model_version: str = "2.4"
    model_sha256: str | None = None
    labels_sha256: str | None = None
    verify_asset_hashes: bool = True
    inference_threads: int = Field(default=4, ge=1, le=32)
    sensitivity: float = Field(default=1.0, gt=0.0, le=5.0)
    warmup_on_start: bool = True

    # BirdNET v2.4 takes exactly 144000 float32 samples (48 kHz x 3 s) and does
    # not reshape to other window lengths, so both fields are validated below.
    sample_rate: int = 48_000
    window_seconds: float = Field(default=3.0, gt=0.0, le=30.0)
    hop_seconds: float = Field(default=1.5, gt=0.0, le=30.0)

    catalog_path: Path | None = Path("config/catalog/avilist_v2026_global.csv")

    ffmpeg_path: str = ""
    ffmpeg_threads: int = Field(default=2, ge=1, le=16)
    ffmpeg_timeout_seconds: float = Field(default=20.0, gt=0.0, le=120.0)

    max_audio_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    max_duration_seconds: float = Field(default=60.0, gt=0.0, le=600.0)
    min_duration_seconds: float = Field(default=1.0, gt=0.0, le=30.0)
    upload_timeout_seconds: float = Field(default=20.0, gt=0.0, le=300.0)
    processing_timeout_seconds: float = Field(default=30.0, gt=0.0, le=600.0)
    max_concurrent_decodes: int = Field(default=2, ge=1, le=32)
    max_concurrent_analyses: int = Field(default=1, ge=1, le=32)
    max_queued_analyses: int = Field(default=4, ge=0, le=256)
    temp_dir: Path | None = None

    candidate_count: int = Field(default=5, ge=1, le=20)
    max_candidate_count: int = Field(default=20, ge=1, le=50)
    min_score: float = Field(default=0.50, ge=0.0, le=1.0)
    min_confirming_windows: int = Field(default=2, ge=1, le=64)
    min_margin: float = Field(default=0.0, ge=0.0, le=1.0)
    include_diagnostics: bool = True

    api_keys: str = ""
    allow_anonymous: bool = True
    cors_origins: str = ""

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        value = value.upper()
        if value not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("unsupported log level")
        return value

    @model_validator(mode="after")
    def validate_runtime_contract(self) -> AudioSettings:
        if self.sample_rate != 48_000:
            raise ValueError("BirdNET v2.4 requires BIRD_AUDIO_SAMPLE_RATE=48000")
        if self.window_seconds != 3.0:
            raise ValueError("BirdNET v2.4 requires BIRD_AUDIO_WINDOW_SECONDS=3.0")
        if self.hop_seconds > self.window_seconds:
            raise ValueError("hop_seconds cannot exceed window_seconds")
        if self.min_duration_seconds >= self.max_duration_seconds:
            raise ValueError("min_duration_seconds must be below max_duration_seconds")
        if self.candidate_count > self.max_candidate_count:
            raise ValueError("candidate_count cannot exceed max_candidate_count")
        if self.environment == "production":
            if self.allow_anonymous:
                raise ValueError("production must set BIRD_AUDIO_ALLOW_ANONYMOUS=false")
            if not self.api_key_set:
                raise ValueError("production must configure BIRD_AUDIO_API_KEYS")
            if self.engine_backend != "birdnet":
                raise ValueError("production must set BIRD_AUDIO_ENGINE_BACKEND=birdnet")
            if not self.model_path.expanduser().is_file():
                raise ValueError("production audio model must be an existing local file")
            if not self.labels_path.expanduser().is_file():
                raise ValueError("production label file must be an existing local file")
            if not self.model_sha256:
                raise ValueError("production must configure BIRD_AUDIO_MODEL_SHA256")
            if not self.labels_sha256:
                raise ValueError("production must configure BIRD_AUDIO_LABELS_SHA256")
            if self.catalog_path is None or not self.catalog_path.expanduser().is_file():
                raise ValueError("production requires BIRD_AUDIO_CATALOG_PATH")
            if self.temp_dir is None:
                raise ValueError("production must configure BIRD_AUDIO_TEMP_DIR")
        for field_name in ("model_sha256", "labels_sha256"):
            value = getattr(self, field_name)
            invalid = value is not None and (
                len(value) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in value)
            )
            if invalid:
                raise ValueError(f"{field_name} must be a 64-character SHA-256 hexadecimal digest")
        return self

    @property
    def window_samples(self) -> int:
        return int(round(self.window_seconds * self.sample_rate))

    @property
    def hop_samples(self) -> int:
        return max(1, int(round(self.hop_seconds * self.sample_rate)))

    @property
    def max_samples(self) -> int:
        return int(round(self.max_duration_seconds * self.sample_rate))

    @property
    def api_key_set(self) -> frozenset[str]:
        return frozenset(part.strip() for part in self.api_keys.split(",") if part.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [part.strip() for part in self.cors_origins.split(",") if part.strip()]


def get_settings() -> AudioSettings:
    return AudioSettings()
