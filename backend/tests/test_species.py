from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import pytest
from PIL import Image

from bird_vision.config import Settings
from bird_vision.inference.species import (
    BioClipSpeciesProvider,
    DisabledSpeciesProvider,
    _directory_fingerprint,
    load_catalog,
)


def test_load_catalog(tmp_path: Path) -> None:
    catalog = tmp_path / "species.csv"
    catalog.write_text(
        "species_id,scientific_name,common_name_zh,common_name_en,order,family\n"
        "egretta_garzetta,Egretta garzetta,白鹭,Little egret,Pelecaniformes,Ardeidae\n",
        encoding="utf-8",
    )
    taxa = load_catalog(catalog)
    assert taxa[0].species_id == "egretta_garzetta"
    assert taxa[0].common_name_zh == "白鹭"


def test_load_extended_catalog_and_search(tmp_path: Path) -> None:
    catalog = tmp_path / "species.csv"
    catalog.write_text(
        "species_id,scientific_name,common_name_zh,common_name_en,order,family,ebird_code,"
        "avibase_id,region_codes,extinction_status,iucn_status,taxon_source,taxon_version,"
        "license,enabled\n"
        "avibase-F2858F9F,Egretta garzetta,白鹭,Little Egret,Pelecaniformes,Ardeidae,"
        "litegr,avibase-F2858F9F,CN;JP,,LC,AviList,v2026,CC BY 4.0,true\n"
        "avibase-DEAD0001,Avis extincta,,Extinct Bird,Passeriformes,Avidae,,"
        "avibase-DEAD0001,,Extinct,EX,AviList,v2026,CC BY 4.0,false\n",
        encoding="utf-8",
    )
    provider = DisabledSpeciesProvider(
        Settings(environment="test", species_backend="disabled", species_catalog_path=catalog)
    )
    provider.load()
    info = provider.catalog_info()
    assert info["total_species"] == 2
    assert info["enabled_species"] == 1
    assert info["region_counts"] == {"CN": 1, "JP": 1}
    total, matches = provider.search_catalog(
        query="白鹭",
        region_code="CN",
        enabled_only=True,
        offset=0,
        limit=10,
    )
    assert total == 1
    assert matches[0].ebird_code == "litegr"


def test_open_set_decision_rejects_weak_or_ambiguous_result(tmp_path: Path) -> None:
    catalog = tmp_path / "species.csv"
    catalog.write_text("species_id,scientific_name\nbird_a,Avis alpha\n", encoding="utf-8")
    provider = BioClipSpeciesProvider(
        Settings(
            environment="test",
            species_backend="bioclip",
            species_catalog_path=catalog,
            species_min_similarity=0.2,
            species_min_margin=0.01,
        )
    )
    assert provider._decision(0.19, 0.5) == (False, "below_similarity_threshold")
    assert provider._decision(0.5, 0.009) == (False, "ambiguous_candidates")
    assert provider._decision(0.5, 0.02) == (True, "accepted")


def test_catalog_rejects_duplicate_ids(tmp_path: Path) -> None:
    catalog = tmp_path / "species.csv"
    catalog.write_text(
        "species_id,scientific_name\nbird_a,Avis alpha\nbird_a,Avis beta\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="duplicate species_id"):
        load_catalog(catalog)


def test_repository_catalog_is_complete_and_versioned() -> None:
    catalog_dir = Path(__file__).resolve().parents[1] / "config" / "catalog"
    global_taxa = load_catalog(catalog_dir / "avilist_v2026_global.csv")
    china_taxa = load_catalog(catalog_dir / "avilist_v2026_cn.csv")
    metadata = json.loads((catalog_dir / "catalog_metadata.json").read_text(encoding="utf-8"))

    assert len(global_taxa) == 11_172
    assert sum(taxon.enabled for taxon in global_taxa) == 10_970
    assert len(china_taxa) == 1_420
    assert sum("CN" in taxon.region_codes for taxon in global_taxa) == 1_420
    assert metadata["canonical_taxonomy"]["version"] == "v2026"
    assert metadata["catalogs"]["avilist_v2026_global.csv"]["species"] == 11_172
    assert (
        hashlib.sha256((catalog_dir / "avilist_v2026_global.csv").read_bytes()).hexdigest()
        == metadata["catalogs"]["avilist_v2026_global.csv"]["sha256"]
    )

    by_scientific_name = {taxon.scientific_name: taxon for taxon in global_taxa}
    assert by_scientific_name["Passer montanus"].common_name_zh == "麻雀 (树麻雀)"
    assert by_scientific_name["Egretta garzetta"].species_id == "avibase-F2858F9F"


@pytest.fixture
def bioclip_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Any, ...]:
    torch = pytest.importorskip("torch")
    snapshot = tmp_path / ".cache" / "huggingface" / "snapshots" / ("a" * 40)
    snapshot.mkdir(parents=True)
    (snapshot / "open_clip_config.json").write_text('{"model_cfg": {}}', encoding="utf-8")
    (snapshot / "open_clip_model.safetensors").write_bytes(b"model weights")
    catalog = tmp_path / "species.csv"
    catalog.write_text("species_id,scientific_name\nbird_a,Avis alpha\nbird_b,Avis beta\n", encoding="utf-8")
    model = Mock()
    model.to.return_value = model
    model.eval.return_value = model
    model.encode_text.side_effect = lambda tokens: torch.tensor([[3.0, 4.0, 0.0]]).repeat(len(tokens), 1)
    model.encode_image.side_effect = lambda batch: torch.tensor([[3.0, 4.0, 0.0]]).repeat(len(batch), 1)
    open_clip = SimpleNamespace(
        create_model_and_transforms=Mock(return_value=(model, None, lambda image: torch.ones(3, 2, 2))),
        get_tokenizer=Mock(return_value=lambda prompts: torch.ones(len(prompts), 2, dtype=torch.int64)),
    )
    hub = SimpleNamespace(snapshot_download=Mock(return_value=str(snapshot)))
    monkeypatch.setitem(sys.modules, "open_clip", open_clip)
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    provider = BioClipSpeciesProvider(
        Settings(
            environment="test",
            species_backend="bioclip",
            species_catalog_path=catalog,
            species_text_cache_dir=tmp_path / "text-cache",
            species_warmup_on_start=False,
            device="cpu",
        )
    )
    return provider, snapshot, open_clip, hub


@pytest.mark.parametrize("revision", [None, "main", "a" * 40])
def test_bioclip_resolves_same_snapshot_for_model_and_tokenizer(bioclip_provider, revision) -> None:
    provider, snapshot, open_clip, hub = bioclip_provider
    provider.settings.bioclip_model_revision = revision
    provider.load()

    hub.snapshot_download.assert_called_once_with(repo_id="imageomics/bioclip-2", revision=revision)
    source = f"local-dir:{snapshot}"
    open_clip.create_model_and_transforms.assert_called_once_with(
        source, require_pretrained=True, weights_only=True
    )
    open_clip.get_tokenizer.assert_called_once_with(source)
    assert provider.ready
    assert provider.metadata()["resolved_revision"] == snapshot.name
    assert provider.metadata()["artifact_fingerprint_sha256"] == _directory_fingerprint(snapshot)


@pytest.mark.parametrize("revision", [None, "main", "v1.0", "abcdef0"])
def test_bioclip_production_requires_full_commit(bioclip_provider, revision) -> None:
    provider, _, open_clip, hub = bioclip_provider
    # Exercise provider validation independently of Settings startup validation.
    provider.settings = provider.settings.model_copy(
        update={"environment": "production", "bioclip_model_revision": revision}
    )
    with pytest.raises(ValueError, match="full 40-character HF commit SHA"):
        provider.load()
    hub.snapshot_download.assert_not_called()
    open_clip.create_model_and_transforms.assert_not_called()
    assert not provider.ready


def test_bioclip_rejects_wrong_resolved_commit(bioclip_provider) -> None:
    provider, _, open_clip, _ = bioclip_provider
    provider.settings.bioclip_model_revision = "b" * 40
    with pytest.raises(ValueError, match="does not match the requested commit"):
        provider.load()
    open_clip.create_model_and_transforms.assert_not_called()


def test_bioclip_checks_fingerprint_before_model_load(bioclip_provider) -> None:
    provider, snapshot, open_clip, _ = bioclip_provider
    provider.settings.bioclip_expected_fingerprint = "0" * 64
    with pytest.raises(RuntimeError, match="artifact fingerprint mismatch"):
        provider.load()
    open_clip.create_model_and_transforms.assert_not_called()
    assert provider._model is None
    provider.settings.bioclip_expected_fingerprint = _directory_fingerprint(snapshot).upper()
    provider.load()
    assert provider.ready


def test_bioclip_local_source_is_hashed_without_hub_access(bioclip_provider) -> None:
    provider, snapshot, open_clip, hub = bioclip_provider
    provider.settings.bioclip_model = f"local-dir:{snapshot}"
    provider.load()
    hub.snapshot_download.assert_not_called()
    open_clip.get_tokenizer.assert_called_once_with(f"local-dir:{snapshot}")
    assert provider.metadata()["resolved_revision"] is None
    provider.settings.bioclip_model_revision = "main"
    with pytest.raises(ValueError, match="revision applies only to hf-hub"):
        provider.load()


def test_bioclip_rejects_sources_without_pretrained_artifacts(bioclip_provider) -> None:
    provider, _, open_clip, _ = bioclip_provider
    provider.settings.bioclip_model = "ViT-B-32"
    with pytest.raises(ValueError, match="pretrained model source"):
        provider.load()
    open_clip.create_model_and_transforms.assert_not_called()


def test_directory_fingerprint_hashes_weights_and_tokenizer_under_cache(tmp_path: Path) -> None:
    model_dir = tmp_path / ".cache" / "models"
    model_dir.mkdir(parents=True)
    config = model_dir / "open_clip_config.json"
    config.write_text('{"model_cfg": {}}', encoding="utf-8")
    weights = model_dir / "open_clip_model.safetensors"
    weights.write_bytes(b"first weights")
    fingerprint = _directory_fingerprint(model_dir)
    weights.write_bytes(b"other weights")
    changed_weights = _directory_fingerprint(model_dir)
    assert changed_weights != fingerprint
    (model_dir / "vocab.txt").write_text("bird", encoding="utf-8")
    assert _directory_fingerprint(model_dir) != changed_weights
    fingerprint = _directory_fingerprint(model_dir)
    (model_dir / ".cache").mkdir()
    (model_dir / ".cache" / "download.json").write_text("{}", encoding="utf-8")
    assert _directory_fingerprint(model_dir) == fingerprint
    (model_dir / "text-feature-cache.pt").write_bytes(b"cached features")
    assert _directory_fingerprint(model_dir) == fingerprint


def test_directory_fingerprint_requires_config_and_checkpoint(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="configuration not found"):
        _directory_fingerprint(tmp_path)
    (tmp_path / "open_clip_config.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="no OpenCLIP checkpoint"):
        _directory_fingerprint(tmp_path)


def test_bioclip_cache_round_trip_and_model_identity(bioclip_provider) -> None:
    provider, snapshot, open_clip, _ = bioclip_provider
    provider.load()
    first_path = provider._text_cache_path
    first_features = provider._text_features.clone()
    assert not provider._text_cache_hit
    provider.load()
    assert provider._text_cache_hit
    assert provider._torch.equal(first_features, provider._text_features)
    # The second load probes the encoder width, but skips catalog encoding.
    model = open_clip.create_model_and_transforms.return_value[0]
    assert model.encode_text.call_count == 3
    payload = provider._torch.load(first_path, weights_only=True)
    assert payload["metadata"]["model_revision"] == snapshot.name
    assert payload["metadata"]["feature_dim"] == 3
    assert payload["metadata"]["model_fingerprint"] == _directory_fingerprint(snapshot)
    fingerprint = provider._model_fingerprint
    (snapshot / "open_clip_model.safetensors").write_bytes(b"updated weights")
    provider.load()
    assert provider._model_fingerprint != fingerprint
    assert provider._text_cache_path != first_path
    assert not provider._text_cache_hit


def test_bioclip_cache_key_includes_resolved_revision(bioclip_provider) -> None:
    provider, snapshot, _, hub = bioclip_provider
    provider.load()
    first_path = provider._text_cache_path
    first_fingerprint = provider._model_fingerprint
    other_snapshot = snapshot.with_name("b" * 40)
    other_snapshot.mkdir()
    for artifact in snapshot.iterdir():
        (other_snapshot / artifact.name).write_bytes(artifact.read_bytes())
    hub.snapshot_download.return_value = str(other_snapshot)
    provider.load()
    assert provider._model_fingerprint == first_fingerprint
    assert provider._text_cache_path != first_path
    assert not provider._text_cache_hit


@pytest.mark.parametrize(
    "corruption",
    [
        "unpickling_error",
        "truncated",
        "non_dict",
        "metadata",
        "revision",
        "fingerprint",
        "non_tensor",
        "rank",
        "rows",
        "width",
        "integer",
        "float16",
        "sparse",
        "nan",
        "inf",
        "zero",
        "unnormalized",
    ],
)
def test_bioclip_rebuilds_invalid_feature_cache(bioclip_provider, corruption) -> None:
    provider, _, _, _ = bioclip_provider
    provider.load()
    torch = provider._torch
    cache_path = provider._text_cache_path
    payload = torch.load(cache_path, weights_only=True)
    valid = payload["features"].clone()
    if corruption == "unpickling_error":
        cache_path.write_bytes(b"not a torch archive")
    elif corruption == "truncated":
        cache_path.write_bytes(b"PK\x03\x04")
    else:
        if corruption == "non_dict":
            payload = []
        elif corruption == "metadata":
            payload["metadata"] = {}
        elif corruption == "revision":
            payload["metadata"]["model_revision"] = "wrong revision"
        elif corruption == "fingerprint":
            payload["metadata"]["model_fingerprint"] = "0" * 64
        elif corruption == "non_tensor":
            payload["features"] = valid.tolist()
        elif corruption == "rank":
            payload["features"] = valid.unsqueeze(0)
        elif corruption == "rows":
            payload["features"] = valid[:1]
        elif corruption == "width":
            payload["features"] = torch.ones(2, 4)
        elif corruption == "integer":
            payload["features"] = valid.long()
        elif corruption == "float16":
            payload["features"] = valid.half()
        elif corruption == "sparse":
            payload["features"] = valid.to_sparse()
        else:
            value = {"nan": float("nan"), "inf": float("inf"), "zero": 0.0, "unnormalized": 2.0}
            payload["features"] = torch.full_like(valid, value[corruption])
        torch.save(payload, cache_path)
    provider.load()
    assert not provider._text_cache_hit
    assert torch.equal(provider._text_features, valid)
    assert torch.equal(torch.load(cache_path, weights_only=True)["features"], valid)
    provider.load()
    assert provider._text_cache_hit
    assert not list(cache_path.parent.glob("*.tmp"))


@pytest.mark.parametrize("stage", ["save", "replace"])
def test_bioclip_cache_write_failure_cleans_temporary_files(bioclip_provider, monkeypatch, stage) -> None:
    provider, _, _, _ = bioclip_provider
    provider.load()
    cache_path = provider._text_cache_path
    # Keep the corrupt cache in place until an atomic replacement succeeds.
    cache_path.write_bytes(b"corrupt")
    if stage == "save":
        monkeypatch.setattr(provider._torch, "save", Mock(side_effect=OSError("disk full")))
    else:
        monkeypatch.setattr(Path, "replace", Mock(side_effect=OSError("read only")))
    provider.load()
    assert provider.ready
    assert not provider._text_cache_hit
    assert cache_path.read_bytes() == b"corrupt"
    assert not list(cache_path.parent.glob("*.tmp"))


@pytest.mark.parametrize("stage", ["move", "tokenizer", "encode", "warmup"])
def test_bioclip_load_failure_clears_model_state(bioclip_provider, monkeypatch, stage) -> None:
    provider, _, open_clip, _ = bioclip_provider
    provider.load()
    provider._region_masks["CN"] = provider._torch.ones(2)
    model = open_clip.create_model_and_transforms.return_value[0]
    if stage == "move":
        model.to.side_effect = RuntimeError("load failed")
    elif stage == "tokenizer":
        open_clip.get_tokenizer.side_effect = RuntimeError("load failed")
    elif stage == "encode":
        model.encode_text.side_effect = RuntimeError("load failed")
    else:
        provider.settings.species_warmup_on_start = True
        monkeypatch.setattr(provider, "classify", Mock(side_effect=RuntimeError("load failed")))
    with pytest.raises(RuntimeError, match="load failed"):
        provider.load()
    assert not provider.ready
    assert provider._model is None
    assert provider._preprocess is None
    assert provider._tokenizer is None
    assert provider._text_features is None
    assert provider._region_masks == {}
    assert provider._model_fingerprint is None
    assert not provider._text_cache_hit


@pytest.mark.parametrize("invalid", ["shape", "nan", "zero", "catalog_width"])
def test_bioclip_rejects_invalid_encoder_features(bioclip_provider, invalid) -> None:
    provider, _, open_clip, _ = bioclip_provider
    torch = pytest.importorskip("torch")
    model = open_clip.create_model_and_transforms.return_value[0]
    if invalid == "catalog_width":
        model.encode_text.side_effect = [torch.ones(1, 3), torch.ones(2, 4)]
    else:
        value = {"shape": torch.ones(3), "nan": torch.full((1, 3), float("nan")), "zero": torch.zeros(1, 3)}
        model.encode_text.side_effect = lambda tokens: value[invalid]
    with pytest.raises(ValueError, match="invalid feature"):
        provider.load()
    assert not provider.ready
    assert provider._text_features is None
    assert not list(provider.settings.species_text_cache_dir.glob("*.pt"))


def test_bioclip_can_classify_after_cache_hit(bioclip_provider) -> None:
    provider, _, _, _ = bioclip_provider
    provider.load()
    provider.load()
    assert provider._text_cache_hit
    predictions = provider.classify([Image.new("RGB", (8, 8))], top_k=1, region_code="CN")
    assert len(predictions) == 1
    assert predictions[0].candidate_count == 2
    assert predictions[0].top_similarity == 1.0
    assert predictions[0].reason == "ambiguous_candidates"
