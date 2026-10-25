from __future__ import annotations

import pytest
from pydantic import ValidationError

from bird_vision.config import Settings


def test_production_rejects_anonymous_access() -> None:
    with pytest.raises(ValidationError, match="ALLOW_ANONYMOUS"):
        Settings(environment="production", allow_anonymous=True)


def test_production_requires_api_key() -> None:
    with pytest.raises(ValidationError, match="API_KEYS"):
        Settings(environment="production", allow_anonymous=False, api_keys="")


def test_api_keys_are_trimmed() -> None:
    settings = Settings(environment="test", api_keys=" one, two ,,", allow_anonymous=False)
    assert settings.api_key_set == {"one", "two"}


def test_region_code_is_normalized() -> None:
    settings = Settings(environment="test", species_default_region_code="cn")
    assert settings.species_default_region_code == "CN"


def test_location_defaults_are_global_and_unscoped() -> None:
    settings = Settings(environment="test")
    assert settings.species_default_region_code is None
    assert settings.species_occurrence_path is None
    assert settings.species_live_occurrence_enabled
    assert settings.species_live_occurrence_cache_path.name == "gbif-occurrence-cache.sqlite3"
    assert settings.species_live_occurrence_cache_ttl_seconds == 2_592_000
    assert settings.species_live_occurrence_facet_limit == 300
    assert not settings.detection_high_resolution_enabled
    assert settings.detection_high_resolution_image_size == 1280
    assert settings.detection_high_resolution_min_image_ratio == 1.5


def test_high_resolution_detector_size_validation_only_applies_when_enabled() -> None:
    disabled = Settings(
        _env_file=None,
        environment="test",
        model_image_size=1536,
        detection_high_resolution_enabled=False,
    )
    assert disabled.model_image_size == 1536
    with pytest.raises(ValueError, match="stride-32 aligned"):
        Settings(
            _env_file=None,
            environment="test",
            model_image_size=640,
            detection_high_resolution_enabled=True,
            detection_high_resolution_image_size=640,
        )
    with pytest.raises(ValueError, match="stride-32 aligned"):
        Settings(
            _env_file=None,
            environment="test",
            model_image_size=641,
            detection_high_resolution_enabled=True,
            detection_high_resolution_image_size=650,
        )


def test_principal_session_quota_cannot_exceed_global_capacity() -> None:
    with pytest.raises(ValidationError, match="max_sessions_per_principal"):
        Settings(environment="test", max_sessions=2, max_sessions_per_principal=3)


def test_image_memory_budget_must_fit_one_decode() -> None:
    with pytest.raises(ValidationError, match="worst-case upload/decode"):
        Settings(
            environment="test",
            max_image_bytes=1024,
            max_image_pixels=1024 * 1024,
            max_buffered_image_bytes=1024 * 1024,
        )


def test_production_rejects_mock_backends(tmp_path) -> None:
    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"weights")
    catalog = tmp_path / "catalog.csv"
    catalog.write_text("species_id,scientific_name\na,Avis alpha\n", encoding="utf-8")
    with pytest.raises(ValidationError, match="DETECTOR_BACKEND=yolo"):
        Settings(
            environment="production",
            allow_anonymous=False,
            api_keys="secret",
            model_path=weights,
            model_sha256="0" * 64,
            species_catalog_path=catalog,
            bioclip_model_revision="commit",
            bioclip_expected_fingerprint="0" * 64,
        )


def test_production_requires_pinned_model_artifacts(tmp_path) -> None:
    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"weights")
    catalog = tmp_path / "catalog.csv"
    catalog.write_text("species_id,scientific_name\na,Avis alpha\n", encoding="utf-8")
    with pytest.raises(ValidationError, match="MODEL_SHA256"):
        Settings(
            environment="production",
            allow_anonymous=False,
            api_keys="secret",
            detector_backend="yolo",
            species_backend="bioclip",
            device="cuda",
            model_path=weights,
            species_catalog_path=catalog,
            bioclip_model_revision="commit",
            bioclip_expected_fingerprint="0" * 64,
        )


def test_production_requires_immutable_bioclip_revision(tmp_path) -> None:
    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"weights")
    catalog = tmp_path / "catalog.csv"
    catalog.write_text("species_id,scientific_name\na,Avis alpha\n", encoding="utf-8")
    with pytest.raises(ValidationError, match="40-character commit SHA"):
        Settings(
            environment="production",
            allow_anonymous=False,
            api_keys="secret",
            detector_backend="yolo",
            species_backend="bioclip",
            device="cuda",
            model_path=weights,
            model_sha256="0" * 64,
            species_catalog_path=catalog,
            bioclip_model_revision="main",
            bioclip_expected_fingerprint="0" * 64,
        )


def test_production_rejects_motion_tracker(tmp_path) -> None:
    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"weights")
    with pytest.raises(ValidationError, match="ByteTrack"):
        Settings(
            environment="production",
            allow_anonymous=False,
            api_keys="secret",
            detector_backend="yolo",
            species_backend="bioclip",
            device="cuda",
            tracker_backend="motion",
            model_path=weights,
            model_sha256="0" * 64,
            species_catalog_path=tmp_path / "catalog.csv",
            bioclip_model_revision="0" * 40,
            bioclip_expected_fingerprint="0" * 64,
        )
