from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class BusinessSettings(BaseSettings):
    """Runtime configuration for the business service, loaded from ``BIRD_BUSINESS_*``."""

    model_config = SettingsConfigDict(
        env_prefix="BIRD_BUSINESS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    service_name: str = "bird-business-service"
    service_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    database_path: Path = Path("runtime/observations.sqlite3")
    catalog_path: Path = Path(__file__).resolve().parents[2] / "config/catalog/avilist_v2026_global.csv"
    default_page_size: int = Field(default=20, ge=1, le=200)
    max_page_size: int = Field(default=100, ge=1, le=500)
    max_note_length: int = Field(default=2000, ge=0, le=20_000)

    api_keys: str = ""
    trip_api_key: SecretStr = SecretStr("")
    trip_workspace: str = Field(default="", pattern=r"^(?:|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$")
    trip_model: str = Field(default="qwen-plus", pattern=r"^qwen[a-zA-Z0-9._-]{0,79}$")
    trip_global_hourly: int = Field(default=100, ge=1, le=10000)
    admin_password_sha256: str = Field(default="", pattern=r"^(?:|[a-f0-9]{64})$")
    wechat_app_id: str = ""
    wechat_app_secret: str = ""
    mobile_signing_key: str = Field(default="", pattern=r"^(?:|[a-f0-9]{64})$")
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
    def validate_runtime_contract(self) -> BusinessSettings:
        if self.default_page_size > self.max_page_size:
            raise ValueError("default_page_size cannot exceed max_page_size")
        if self.environment == "production":
            if self.allow_anonymous:
                raise ValueError("production must set BIRD_BUSINESS_ALLOW_ANONYMOUS=false")
            if not self.api_key_set:
                raise ValueError("production must configure BIRD_BUSINESS_API_KEYS")
        return self

    @property
    def api_key_set(self) -> frozenset[str]:
        return frozenset(part.strip() for part in self.api_keys.split(",") if part.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [part.strip() for part in self.cors_origins.split(",") if part.strip()]


def get_settings() -> BusinessSettings:
    return BusinessSettings()
