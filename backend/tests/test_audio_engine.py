from __future__ import annotations

import sys
from pathlib import Path

import pytest

from bird_audio.config import AudioSettings
from bird_audio.engine import BirdNetEngine, MockAudioEngine, build_engine, verify_assets
from bird_audio.labels import load_model_labels, parse_model_labels

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = REPO_ROOT / "鸟类识别预研/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite"
LABELS_PATH = REPO_ROOT / "鸟类识别预研/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Labels.txt"

LABELS = parse_model_labels(
    [
        "Turdus merula_Eurasian Blackbird",
        "Parus major_Great Tit",
        "Human vocal_Human vocal",
    ]
)


def test_mock_engine_follows_window_energy() -> None:
    engine = MockAudioEngine(LABELS)
    engine.load()
    assert engine.ready is True
    silent = engine.predict([0.0] * 8)
    loud = engine.predict([0.5] * 8)
    assert len(silent) == len(LABELS)
    assert silent[0] == 0.0
    assert loud[0] > 0.5
    assert loud[0] > loud[1] > loud[2] > 0.0
    assert engine.metadata()["labels"] == len(LABELS)
    engine.close()
    assert engine.ready is False


def test_mock_engine_handles_empty_vocabulary() -> None:
    engine = MockAudioEngine([])
    engine.load()
    assert engine.predict([0.3]) == []


def test_birdnet_engine_refuses_to_predict_before_load() -> None:
    settings = AudioSettings(environment="test", engine_backend="birdnet")
    engine = BirdNetEngine(settings, LABELS)
    with pytest.raises(RuntimeError, match="not loaded"):
        engine.predict([0.0] * settings.window_samples)


def test_build_engine_selects_backend() -> None:
    mock = build_engine(AudioSettings(environment="test", engine_backend="mock"), LABELS)
    assert isinstance(mock, MockAudioEngine)
    real = build_engine(AudioSettings(environment="test", engine_backend="birdnet"), LABELS)
    assert isinstance(real, BirdNetEngine)
    assert real.score_type == "birdnet_confidence"


def test_verify_assets_reports_missing_files(audio_settings, tmp_path) -> None:
    settings = audio_settings.model_copy(update={"model_path": tmp_path / "missing.tflite"})
    with pytest.raises(FileNotFoundError):
        verify_assets(settings)


def test_verify_assets_detects_hash_mismatch(audio_settings, tmp_path) -> None:
    model = tmp_path / "model.tflite"
    labels = tmp_path / "labels.txt"
    model.write_bytes(b"model")
    labels.write_bytes(b"labels")
    settings = audio_settings.model_copy(
        update={
            "model_path": model,
            "labels_path": labels,
            "model_sha256": "0" * 64,
        }
    )
    with pytest.raises(RuntimeError, match="model hash mismatch"):
        verify_assets(settings)


def test_verify_assets_returns_digests(audio_settings, tmp_path) -> None:
    model = tmp_path / "model.tflite"
    labels = tmp_path / "labels.txt"
    model.write_bytes(b"model")
    labels.write_bytes(b"labels")
    settings = audio_settings.model_copy(update={"model_path": model, "labels_path": labels})
    digests = verify_assets(settings)
    assert len(digests["model_sha256"]) == 64
    assert len(digests["labels_sha256"]) == 64


def test_verify_assets_can_be_skipped(audio_settings, tmp_path) -> None:
    model = tmp_path / "model.tflite"
    labels = tmp_path / "labels.txt"
    model.write_bytes(b"model")
    labels.write_bytes(b"labels")
    settings = audio_settings.model_copy(
        update={
            "model_path": model,
            "labels_path": labels,
            "verify_asset_hashes": False,
            "model_sha256": "a" * 64,
        }
    )
    assert verify_assets(settings)["model_sha256"] == "a" * 64


def test_birdnet_engine_requires_the_audio_extra(audio_settings, monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "numpy", None)
    monkeypatch.setitem(sys.modules, "ai_edge_litert", None)
    monkeypatch.setitem(sys.modules, "ai_edge_litert.interpreter", None)
    engine = BirdNetEngine(audio_settings, LABELS)
    with pytest.raises(RuntimeError, match="audio"):
        engine.load()


@pytest.mark.skipif(not MODEL_PATH.is_file(), reason="BirdNET weights are not installed")
def test_birdnet_engine_runs_the_real_model() -> None:
    pytest.importorskip("numpy")
    pytest.importorskip("ai_edge_litert.interpreter")
    labels = load_model_labels(LABELS_PATH)
    settings = AudioSettings(
        environment="test",
        engine_backend="birdnet",
        model_path=MODEL_PATH,
        labels_path=LABELS_PATH,
        inference_threads=2,
    )
    engine = BirdNetEngine(settings, labels)
    engine.load()
    try:
        scores = engine.predict([0.0] * settings.window_samples)
        assert len(scores) == len(labels)
        assert all(0.0 <= score <= 1.0 for score in scores[:100])
        metadata = engine.metadata()
        assert metadata["window_samples"] == 144_000
        assert metadata["sample_rate"] == 48_000
    finally:
        engine.close()
    assert engine.ready is False


@pytest.mark.skipif(not MODEL_PATH.is_file(), reason="BirdNET weights are not installed")
def test_birdnet_engine_rejects_a_mismatched_window() -> None:
    pytest.importorskip("numpy")
    pytest.importorskip("ai_edge_litert.interpreter")
    settings = AudioSettings(
        environment="test",
        engine_backend="birdnet",
        model_path=MODEL_PATH,
        labels_path=LABELS_PATH,
    )
    # model_copy bypasses the 3 s validation on purpose: the engine must still
    # refuse to serve a graph whose input does not match the configuration.
    broken = settings.model_copy(update={"window_seconds": 2.0})
    engine = BirdNetEngine(broken, LABELS[:3])
    with pytest.raises(RuntimeError, match="input shape"):
        engine.load()
