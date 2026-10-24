from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from bird_vision.config import Settings
from bird_vision.inference.detectors import YoloDetector
from bird_vision.inference.species import BioClipSpeciesProvider, _directory_fingerprint


@pytest.fixture
def yolo_detector(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"detector weights")
    torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: True, empty_cache=Mock()),
    )
    model = SimpleNamespace(names={14: "bird"}, ckpt_path=str(weights))
    factory = Mock(return_value=model)
    download = Mock(return_value=str(weights))
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=factory))
    monkeypatch.setitem(sys.modules, "ultralytics.utils", SimpleNamespace())
    monkeypatch.setitem(
        sys.modules,
        "ultralytics.utils.checks",
        SimpleNamespace(check_yolov5u_filename=lambda path, verbose: path),
    )
    monkeypatch.setitem(
        sys.modules, "ultralytics.utils.downloads", SimpleNamespace(attempt_download_asset=download)
    )
    detector = YoloDetector(
        Settings(
            environment="test",
            detector_backend="yolo",
            model_path=weights,
            device="cuda",
            warmup_on_start=False,
        )
    )
    return detector, weights, factory, download, torch


@pytest.mark.parametrize("automatic", [False, True])
@pytest.mark.parametrize("matches", [False, True])
def test_yolo_verifies_hash_before_model_deserialization(
    yolo_detector, monkeypatch, automatic, matches
) -> None:
    detector, weights, factory, download, _ = yolo_detector
    if automatic:
        monkeypatch.chdir(weights.parent)
        detector.settings.model_path = Path("yolo11n.pt")
    digest = hashlib.sha256(weights.read_bytes()).hexdigest()
    detector.settings.model_sha256 = digest.upper() if matches else "0" * 64
    if matches:
        detector.load()
        factory.assert_called_once_with(str(weights.resolve()))
        assert detector.ready
        assert detector._model_sha256 == digest
        assert detector._resolved_model_path == str(weights.resolve())
    else:
        with pytest.raises(RuntimeError, match="SHA-256 mismatch"):
            detector.load()
        factory.assert_not_called()
        assert not detector.ready
        assert detector._model_sha256 is None
        assert detector._model is None
    if automatic:
        download.assert_called_once_with("yolo11n.pt")
    else:
        download.assert_not_called()


def test_yolo_records_hash_for_unpinned_development_download(yolo_detector, monkeypatch) -> None:
    detector, weights, _, download, _ = yolo_detector
    monkeypatch.chdir(weights.parent)
    detector.settings.model_path = Path("yolo11n.pt")
    detector.load()
    assert detector._model_sha256 == hashlib.sha256(weights.read_bytes()).hexdigest()
    download.assert_called_once()


@pytest.mark.parametrize("missing", ["explicit", "directory", "download"])
def test_yolo_requires_a_regular_weight_file(yolo_detector, monkeypatch, missing) -> None:
    detector, weights, factory, download, _ = yolo_detector
    if missing == "explicit":
        detector.settings.model_path = weights.parent / "missing" / "weights.pt"
    elif missing == "directory":
        detector.settings.model_path = weights.parent
    else:
        monkeypatch.chdir(weights.parent)
        detector.settings.model_path = Path("yolo11n.pt")
        download.return_value = str(weights.parent / "missing.pt")
    with pytest.raises(FileNotFoundError, match="detector weights not found"):
        detector.load()
    factory.assert_not_called()
    assert not detector.ready


@pytest.mark.parametrize("stage", ["constructor", "checkpoint", "class_id", "class_name", "warmup"])
def test_yolo_load_failure_clears_model_and_gpu_state(yolo_detector, monkeypatch, stage) -> None:
    detector, weights, factory, _, torch = yolo_detector
    detector.load()
    torch.cuda.empty_cache.reset_mock()
    if stage == "constructor":
        factory.side_effect = RuntimeError("constructor failed")
        message = "constructor failed"
    elif stage == "checkpoint":
        factory.return_value.ckpt_path = str(weights.with_name("other.pt"))
        message = "different detector weights"
    elif stage == "class_id":
        factory.return_value.names = {0: "bird"}
        message = "class IDs do not exist"
    elif stage == "class_name":
        factory.return_value.names = {14: "person"}
        message = "not expected bird classes"
    else:
        detector.settings.warmup_on_start = True
        monkeypatch.setattr(detector, "predict", Mock(side_effect=RuntimeError("warmup failed")))
        message = "warmup failed"
    with pytest.raises((RuntimeError, ValueError), match=message):
        detector.load()
    assert not detector.ready
    assert detector._model is None
    assert detector._resolved_model_path is None
    assert detector._model_sha256 is None
    assert torch.cuda.empty_cache.call_count == 2
    with pytest.raises(RuntimeError, match="not loaded"):
        YoloDetector.predict(detector, Image.new("RGB", (8, 8)))


def test_yolo_supports_list_class_metadata(yolo_detector) -> None:
    detector, _, factory, _, _ = yolo_detector
    detector.settings.detection_class_ids = "0"
    factory.return_value.names = ["Bird", "person"]
    detector.load()
    assert detector.ready


def test_yolo_reload_rechecks_hash_and_discards_previous_model(yolo_detector) -> None:
    detector, weights, factory, _, _ = yolo_detector
    detector.settings.model_sha256 = hashlib.sha256(weights.read_bytes()).hexdigest()
    detector.load()
    weights.write_bytes(b"changed weights")
    factory.reset_mock()
    with pytest.raises(RuntimeError, match="SHA-256 mismatch"):
        detector.load()
    factory.assert_not_called()
    assert not detector.ready
    assert detector._model is None


def test_yolo_rejects_filename_rewrites_before_deserialization(yolo_detector, monkeypatch) -> None:
    detector, weights, factory, _, _ = yolo_detector
    rewritten = str(weights.with_name("other.pt"))
    monkeypatch.setitem(
        sys.modules,
        "ultralytics.utils.checks",
        SimpleNamespace(check_yolov5u_filename=lambda path, verbose: rewritten),
    )
    detector.settings.model_sha256 = hashlib.sha256(weights.read_bytes()).hexdigest()
    with pytest.raises(ValueError, match="actual detector checkpoint path"):
        detector.load()
    factory.assert_not_called()
    assert not detector.ready
    assert detector._model is None


def test_bioclip_loads_real_open_clip_local_checkpoint(tmp_path: Path) -> None:
    torch = pytest.importorskip("torch")
    open_clip = pytest.importorskip("open_clip")
    config = {
        "embed_dim": 8,
        "vision_cfg": {"image_size": 16, "patch_size": 8, "width": 64, "layers": 1},
        "text_cfg": {"context_length": 32, "vocab_size": 49408, "width": 8, "heads": 1, "layers": 1},
    }
    # Small deterministic checkpoint exercises the actual factory and tokenizer
    # without downloading BioCLIP's production weights.
    with torch.random.fork_rng():
        torch.manual_seed(17)
        model = open_clip.CLIP(**config).eval()
    (tmp_path / "open_clip_config.json").write_text(json.dumps({"model_cfg": config}), encoding="utf-8")
    torch.save(model.state_dict(), tmp_path / "open_clip_pytorch_model.bin")
    catalog = tmp_path / "catalog.csv"
    catalog.write_text("species_id,scientific_name\na,Avis alpha\nb,Avis beta\n", encoding="utf-8")
    provider = BioClipSpeciesProvider(
        Settings(
            environment="test",
            species_backend="bioclip",
            bioclip_model=f"local-dir:{tmp_path}",
            bioclip_expected_fingerprint=_directory_fingerprint(tmp_path),
            species_catalog_path=catalog,
            species_text_cache_dir=tmp_path / "feature-cache",
            species_warmup_on_start=True,
            device="cpu",
        )
    )
    provider.load()
    assert provider.ready
    assert provider._text_features.shape == (2, 8)
    assert torch.equal(provider._model.text_projection, model.text_projection)
    features = provider._text_features.clone()
    provider.load()
    assert provider._text_cache_hit
    assert torch.equal(provider._text_features, features)
    predictions = provider.classify([Image.new("RGB", (20, 20))], top_k=2)
    assert len(predictions) == 1
    assert len(predictions[0].candidates) == 2
    assert predictions[0].top_similarity is not None
    provider.close()
    assert not provider.ready
