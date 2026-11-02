from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
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
    default_page_size: int = Field(default=20, ge=1, le=200)
    max_page_size: int = Field(default=100, ge=1, le=500)
    max_note_length: int = Field(default=2000, ge=0, le=20_000)

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
