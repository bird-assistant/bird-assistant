from __future__ import annotations

import array
from pathlib import Path

import httpx
import pytest

from bird_audio.app import MOCK_LABELS, create_app, load_labels, runtime_paths
from bird_audio.audio import AudioDecoder
from bird_audio.config import AudioSettings
from bird_audio.labels import load_model_labels

CATALOG_CSV = (
    "species_id,scientific_name,common_name_zh,common_name_en,order,family,enabled,taxon_source,taxon_version,license\n"
    "turdus,Turdus merula,乌鸫,Eurasian Blackbird,Passeriformes,Turdidae,true,AviList,v2026,CC BY 4.0\n"
    "parus,Parus major,大山雀,Great Tit,Passeriformes,Paridae,true,AviList,v2026,CC BY 4.0\n"
)


class FakeRunner:
    """Stand-in for ffmpeg: returns 1 s of raw 48 kHz float32 PCM."""

    def __call__(self, args, timeout):  # noqa: ANN001 - test double
        stdout = array.array("f", [0.2] * 48_000).tobytes()
        return 0, stdout, b"  Stream #0:0: Audio: wav, 48000 Hz, mono, flt\n"


def fake_decoder(settings: AudioSettings) -> AudioDecoder:
    return AudioDecoder(settings, runner=FakeRunner(), ffmpeg="ffmpeg")


def write_labels(path: Path) -> Path:
    path.write_text(
        "Turdus merula_Eurasian Blackbird\nParus major_Great Tit\nHuman vocal_Human vocal\n",
        encoding="utf-8",
    )
    return path


async def get_models(settings: AudioSettings):
    app = create_app(settings, decoder=fake_decoder(settings))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        return (await client.get("/api/v1/models")).json()


async def test_labels_fall_back_to_the_mock_vocabulary(audio_settings, tmp_path) -> None:
    settings = audio_settings.model_copy(update={"labels_path": tmp_path / "missing.txt"})
    body = await get_models(settings)
    assert body["labels"]["count"] == len(MOCK_LABELS)
    assert body["labels"]["source"] == "builtin_mock"


def test_load_labels_requires_the_file_for_the_real_engine(audio_settings, tmp_path) -> None:
    settings = audio_settings.model_copy(
        update={"labels_path": tmp_path / "missing.txt", "engine_backend": "birdnet"}
    )
    with pytest.raises(FileNotFoundError):
        load_labels(settings)


def test_load_labels_reads_the_model_file(audio_settings, tmp_path) -> None:
    labels_path = write_labels(tmp_path / "labels.txt")
    settings = audio_settings.model_copy(update={"labels_path": labels_path})
    labels, source = load_labels(settings)
    assert source == "model_file"
    assert len(labels) == 3
    assert len(load_model_labels(labels_path)) == 3


async def test_catalog_mapping_is_reported(audio_settings, tmp_path) -> None:
    labels_path = write_labels(tmp_path / "labels.txt")
    catalog_path = tmp_path / "catalog.csv"
    catalog_path.write_text(CATALOG_CSV, encoding="utf-8", newline="")
    settings = audio_settings.model_copy(update={"labels_path": labels_path, "catalog_path": catalog_path})
    body = await get_models(settings)
    assert body["catalog"]["available"] is True
    assert body["catalog"]["version"] == "v2026"
    assert body["catalog"]["total_species"] == 2
    assert body["labels"]["mapped_classes"] == 2
    assert body["labels"]["unmapped_classes"] == 0


async def test_missing_catalog_keeps_candidates_unmapped(audio_settings, tmp_path) -> None:
    labels_path = write_labels(tmp_path / "labels.txt")
    settings = audio_settings.model_copy(
        update={"labels_path": labels_path, "catalog_path": tmp_path / "missing.csv"}
    )
    body = await get_models(settings)
    assert body["catalog"]["available"] is False
    assert body["labels"]["mapped_classes"] == 0


def test_runtime_paths_are_reported(audio_settings) -> None:
    paths = runtime_paths(audio_settings)
    assert set(paths) == {"model", "labels", "catalog", "temp_dir"}


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"sample_rate": 44_100}, "SAMPLE_RATE"),
        ({"window_seconds": 2.0}, "WINDOW_SECONDS"),
        ({"hop_seconds": 4.0}, "hop_seconds"),
        ({"min_duration_seconds": 61.0}, "min_duration_seconds"),
        ({"candidate_count": 10, "max_candidate_count": 5}, "candidate_count"),
    ],
)
def test_settings_validate_the_model_contract(overrides, message) -> None:
    with pytest.raises(ValueError, match=message):
        AudioSettings(environment="test", **overrides)


def test_production_settings_require_real_assets(tmp_path) -> None:
    with pytest.raises(ValueError):
        AudioSettings(environment="production")
    with pytest.raises(ValueError, match="ALLOW_ANONYMOUS"):
        AudioSettings(environment="production", api_keys="k")
    with pytest.raises(ValueError, match="ENGINE_BACKEND"):
        AudioSettings(
            environment="production",
            api_keys="k",
            allow_anonymous=False,
            model_path=tmp_path / "m.tflite",
            labels_path=tmp_path / "l.txt",
            model_sha256="a" * 64,
            labels_sha256="b" * 64,
            catalog_path=tmp_path / "c.csv",
            temp_dir=tmp_path,
        )
