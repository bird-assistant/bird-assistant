from __future__ import annotations

import asyncio
import csv
import importlib
import json
import sys
import zipfile
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from bird_vision.config import Settings
from bird_vision.domain import Box, DetectorOutput, RawDetection, SpeciesCandidate, SpeciesPrediction
from bird_vision.inference.detectors import MockDetector
from bird_vision.inference.species import MockSpeciesProvider

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


@pytest.fixture
def scripts(monkeypatch):
    monkeypatch.syspath_prepend(str(SCRIPTS))
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "1")
    return SimpleNamespace(
        catalog=importlib.import_module("build_species_catalog"),
        runtime=importlib.import_module("check_runtime"),
        support=importlib.import_module("runtime_support"),
        species=importlib.import_module("evaluate_species"),
        pipeline=importlib.import_module("evaluate_pipeline"),
        lock=importlib.import_module("lock_dependencies"),
        prepare=importlib.import_module("prepare_model_artifacts"),
        occurrence_profile=importlib.import_module("build_occurrence_profile"),
        occurrence_grid=importlib.import_module("build_occurrence_grid"),
        occurrence_cache=importlib.import_module("warm_occurrence_cache"),
        cloud_images=importlib.import_module("test_cloud_images"),
    )


def test_catalog_release_and_offline_provenance(scripts, tmp_path, monkeypatch):
    taxon = dict.fromkeys(scripts.catalog.AVILIST_FIELDS)
    taxon.update(rank="species", sciName="Avis test", avibaseId="id-1", cornellCode="test", name="Test Bird")
    inputs = {"avilist.json": [list(taxon.values())], "taxonomy.json": [], "region.json": ["test"]}
    for name, data in inputs.items():
        (tmp_path / name).write_text(json.dumps(data))
    output = tmp_path / "output"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "build_species_catalog.py",
            "--taxon-version",
            "2025.1",
            "--avilist",
            str(tmp_path / "avilist.json"),
            "--ebird-taxonomy",
            str(tmp_path / "taxonomy.json"),
            "--ebird-region",
            str(tmp_path / "region.json"),
            "--released",
            "2025-06-01",
            "--output-dir",
            str(output),
        ],
    )
    scripts.catalog.main()
    with (output / "avilist_v2025.1_global.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    assert rows[0]["taxon_version"] == "v2025.1"
    assert rows[0]["region_codes"] == "CN"  # Region mapping survives a missing localized name.
    metadata = json.loads((output / "catalog_metadata.json").read_text())
    canonical = metadata["canonical_taxonomy"]
    assert canonical["source"] == str(tmp_path / "avilist.json")
    assert canonical["released"] == "2025-06-01"
    assert canonical["doi"] is None and canonical["citation"] is None
    assert len(canonical["canonical_json_sha256"]) == 64
    assert metadata["catalogs"]["avilist_v2025.1_global.csv"]["sha256"] == scripts.catalog.sha256(
        output / "avilist_v2025.1_global.csv"
    )
    assert metadata["common_names_and_region_enrichment"]["taxonomy_endpoint"] == str(
        tmp_path / "taxonomy.json"
    )


def test_cloud_image_test_defaults_to_hefei_and_validates_session_location(scripts, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["test_cloud_images.py"])
    args = scripts.cloud_images.parse_args()
    assert args.latitude == 31.8206
    assert args.longitude == 117.2272
    assert args.region_code == "CN"

    session = {
        "latitude": 31.8206,
        "longitude": 117.2272,
        "region_code": "CN",
        "coordinates_used_for_inference": True,
    }
    scripts.cloud_images.validate_session_location(
        session,
        latitude=args.latitude,
        longitude=args.longitude,
        region_code=args.region_code,
    )
    with pytest.raises(scripts.cloud_images.TestFailure, match="未采用测试位置"):
        scripts.cloud_images.validate_session_location(
            {**session, "latitude": None},
            latitude=args.latitude,
            longitude=args.longitude,
            region_code=args.region_code,
        )
    with pytest.raises(scripts.cloud_images.TestFailure, match="没有启用坐标候选解析"):
        scripts.cloud_images.validate_session_location(
            {**session, "coordinates_used_for_inference": False},
            latitude=args.latitude,
            longitude=args.longitude,
            region_code=args.region_code,
        )


def test_cloud_image_test_detects_pending_local_candidates(scripts):
    pending = {
        "tracks": [
            {
                "species": {
                    "decision": {"fallback_reason": "live_occurrence_lookup_pending"},
                }
            }
        ]
    }
    assert scripts.cloud_images.has_pending_local_candidates(pending)
    pending["tracks"][0]["species"]["decision"]["fallback_reason"] = None
    assert not scripts.cloud_images.has_pending_local_candidates(pending)

    cache = {"backend": "sqlite", "persistent": True, "entries": 3}
    models = [{"details": {"live_occurrence": {"coordinate_cache": cache}}}]
    assert scripts.cloud_images.persistent_occurrence_cache(models) == cache
    with pytest.raises(scripts.cloud_images.TestFailure, match="持久化 SQLite"):
        scripts.cloud_images.persistent_occurrence_cache([])


def test_cloud_image_summary_counts_confirmed_birds_separately_from_raw_tracks(scripts):
    summary = scripts.cloud_images.summarize_result(
        {
            "tracks": [
                {"track_id": 1, "state": "confirmed", "recognizable": True, "species": {}},
                {"track_id": 2, "state": "tentative", "recognizable": True, "species": {}},
            ]
        }
    )
    assert summary["track_count"] == 2
    assert summary["confirmed_bird_count"] == 1
    assert summary["confirmed_tracks"] == 1
    assert summary["raw_track_count"] == 2
    assert summary["recognizable_tracks"] == 2
    assert scripts.cloud_images.resolved_frame_count(1, 3) == 3
    assert scripts.cloud_images.resolved_frame_count(5, 3) == 5
    assert scripts.cloud_images.detection_badge(summary) == ("确认鸟体", "found")
    assert scripts.cloud_images.detection_badge(
        {"confirmed_bird_count": 0, "track_count": 1}
    ) == ("仅原始检测", "empty")
    assert scripts.cloud_images.detection_badge(
        {"confirmed_bird_count": 0, "track_count": 0}
    ) == ("未检测到鸟体", "empty")


def test_cloud_image_test_prepares_unique_month_and_unknown_cache_keys(scripts):
    prepared = [
        {
            "captured_at": "2026-05-28T19:06:51+08:00",
            "capture_time_source": "filename",
        },
        {
            "captured_at": "2026-05-29T10:00:00+08:00",
            "capture_time_source": "filename",
        },
        {
            "captured_at": "2026-10-24T11:45:00+08:00",
            "capture_time_source": "exif",
        },
        {
            "captured_at": "2026-10-24T11:45:00+08:00",
            "capture_time_source": "file_mtime",
        },
    ]
    args = SimpleNamespace(
        capture_time_precision="auto",
        latitude=31.8206,
        longitude=117.2272,
    )
    requests = scripts.cloud_images.occurrence_cache_requests(prepared, args)
    assert len(requests) == 3
    assert {(item["time_precision"], item["observed_at"][5:7]) for item in requests} == {
        ("exact", "05"),
        ("exact", "10"),
        ("unknown", "10"),
    }


async def test_cloud_image_cache_preflight_limits_concurrency(scripts):
    active = 0
    maximum = 0

    class Response:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"status": "ready", "source": "gbif", "candidate_count": 100}

    class Client:
        async def post(self, path, json):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            await asyncio.sleep(0.01)
            active -= 1
            return Response()

    prepared = [
        {
            "captured_at": f"2026-{month:02d}-15T12:00:00+08:00",
            "capture_time_source": "filename",
        }
        for month in range(1, 13)
    ]
    prepared.append(
        {
            "captured_at": "2026-01-15T12:00:00+08:00",
            "capture_time_source": "file_mtime",
        }
    )
    args = SimpleNamespace(
        capture_time_precision="auto",
        latitude=31.8206,
        longitude=117.2272,
        local_candidate_timeout=90,
    )
    results = await scripts.cloud_images.prepare_occurrence_caches(Client(), prepared, args)
    assert len(results) == 13
    assert maximum == 2


def test_occurrence_cache_warmer_requires_location_or_merge(scripts, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["warm_occurrence_cache.py"])
    with pytest.raises(SystemExit, match="requires --latitude"):
        scripts.occurrence_cache.main()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "warm_occurrence_cache.py",
            "--latitude",
            "31.8206",
            "--longitude",
            "117.2272",
            "--all-year",
        ],
    )
    args = scripts.occurrence_cache.parse_args()
    assert args.all_year
    assert args.month is None


def test_occurrence_cache_warmer_fails_when_result_was_not_persisted(
    scripts, tmp_path, monkeypatch
):
    class Resolver:
        def __init__(self, **kwargs):
            pass

        def select(self, **kwargs):
            return SimpleNamespace(occurrence_counts={"Avis alpha": 1})

        def persistent_result_available(self, **kwargs):
            return False

        def metadata(self):
            return {"coordinate_cache": {"last_error": "database is locked"}}

        def close(self):
            pass

    monkeypatch.setattr(scripts.occurrence_cache, "DynamicOccurrenceResolver", Resolver)
    monkeypatch.setattr(scripts.occurrence_cache, "load_catalog", lambda path: [])
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "warm_occurrence_cache.py",
            "--cache",
            str(tmp_path / "cache.sqlite3"),
            "--latitude",
            "31.8206",
            "--longitude",
            "117.2272",
            "--month",
            "5",
        ],
    )
    with pytest.raises(SystemExit, match="not persisted.*database is locked"):
        scripts.occurrence_cache.main()


def test_cloud_image_test_syncs_backend_without_overwriting_remote_state(scripts, monkeypatch):
    completed = SimpleNamespace(returncode=0)
    calls = []

    def execute(command, **kwargs):
        calls.append((command, kwargs))
        return completed

    monkeypatch.setattr(scripts.cloud_images.subprocess, "run", execute)
    args = SimpleNamespace(
        ssh_host="bird-gpu",
        remote_backend="/root/shared-nvme/bird-assistant/backend",
        occurrence_cache_seed=None,
    )
    scripts.cloud_images.sync_backend(args)
    command, kwargs = calls[0]
    assert command[:3] == ["rsync", "-rz", "--links"]
    assert command[-1] == "bird-gpu:/root/shared-nvme/bird-assistant/backend/"
    assert all(name in command for name in (".venv", ".env", "runtime", "results"))
    assert kwargs == {"text": True, "timeout": 120, "check": False}


def test_cloud_image_test_uploads_optional_occurrence_cache_seed(scripts, tmp_path, monkeypatch):
    seed = tmp_path / "seed.sqlite3"
    store = scripts.occurrence_cache.OccurrenceCacheStore(seed, max_entries=16)
    store.put("region", {"Avis alpha": 1}, ttl_seconds=3600)
    calls = []

    def execute(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(scripts.cloud_images.subprocess, "run", execute)
    args = SimpleNamespace(
        ssh_host="bird-gpu",
        remote_backend="/root/shared-nvme/bird-assistant/backend",
        occurrence_cache_seed=seed,
    )
    scripts.cloud_images.sync_backend(args)
    store.close()
    assert len(calls) == 2
    assert calls[1][0][:2] == ["rsync", "-z"]
    assert calls[1][0][2] != str(seed)
    assert Path(calls[1][0][2]).name == "seed.sqlite3"
    assert calls[1][0][3] == (
        "bird-gpu:/root/shared-nvme/bird-assistant/backend/.gbif-occurrence-seed.sqlite3"
    )


def test_catalog_publish_is_immutable_and_cleans_failed_staging(scripts, tmp_path, monkeypatch):
    taxon = dict.fromkeys(scripts.catalog.AVILIST_FIELDS)
    taxon.update(rank="species", sciName="Avis test", avibaseId="id-1", name="Test Bird")
    for name, data in {
        "avilist.json": [list(taxon.values())],
        "taxonomy.json": [],
        "region.json": [],
    }.items():
        (tmp_path / name).write_text(json.dumps(data))
    output = tmp_path / "release"
    arguments = [
        "build_species_catalog.py",
        "--taxon-version",
        "v2029-test",
        "--avilist",
        str(tmp_path / "avilist.json"),
        "--ebird-taxonomy",
        str(tmp_path / "taxonomy.json"),
        "--ebird-region",
        str(tmp_path / "region.json"),
        "--output-dir",
        str(output),
    ]
    monkeypatch.setattr(sys, "argv", arguments)
    original = scripts.catalog.write_csv
    calls = 0

    def fail_second(path, rows):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("disk full")
        original(path, rows)

    monkeypatch.setattr(scripts.catalog, "write_csv", fail_second)
    with pytest.raises(OSError, match="disk full"):
        scripts.catalog.main()
    assert not output.exists()
    assert not list(tmp_path.glob(".release-*"))

    output.mkdir()
    monkeypatch.setattr(scripts.catalog, "write_csv", original)
    with pytest.raises(FileExistsError, match="immutable"):
        scripts.catalog.main()


def test_prepare_model_artifacts_resolves_immutable_snapshot(scripts, tmp_path, monkeypatch):
    weights = tmp_path / "bird.pt"
    weights.write_bytes(b"detector")
    commit = "a" * 40
    snapshot = tmp_path / commit
    snapshot.mkdir()
    (snapshot / "open_clip_config.json").write_text('{"model_cfg": {}}', encoding="utf-8")
    (snapshot / "open_clip_model.safetensors").write_bytes(b"classifier")

    class Api:
        def model_info(self, repository, revision):
            assert repository == "imageomics/bioclip-2" and revision == "main"
            return SimpleNamespace(sha=commit)

    hub = SimpleNamespace(HfApi=Api, snapshot_download=lambda **kwargs: str(snapshot))
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    report = scripts.prepare.prepare(weights, "imageomics/bioclip-2", "main")
    assert report["BIRD_VISION_BIOCLIP_MODEL_REVISION"] == commit
    assert len(report["BIRD_VISION_MODEL_SHA256"]) == 64
    assert len(report["BIRD_VISION_BIOCLIP_EXPECTED_FINGERPRINT"]) == 64


def test_catalog_default_source_follows_version(scripts, tmp_path, monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "build_species_catalog.py",
            "--taxon-version",
            "v2025",
            "--ebird-api-key",
            "test-key",
            "--output-dir",
            str(tmp_path),
        ],
    )
    locations = []

    def load(location, **kwargs):
        locations.append(location)
        raise RuntimeError("stop before network")

    monkeypatch.setattr(scripts.catalog, "load_json", load)
    with pytest.raises(RuntimeError, match="stop before network"):
        scripts.catalog.main()
    assert locations == ["https://explore.avilist.org/data/avilist-2025.json"]


def test_catalog_does_not_label_alternate_english_as_chinese(scripts):
    taxon = {"name": "Test Bird", "nameClements": "Test Bird", "nameBirdLife": "Test Bird"}
    assert not scripts.catalog.is_chinese_name("Different English Name", taxon)
    assert scripts.catalog.is_chinese_name("\u767d\u9e6d", taxon)


def test_occurrence_facet_paginates_terminal_species_keys(scripts, monkeypatch):
    calls = []

    def request(url):
        from urllib.parse import parse_qs, urlparse

        query = parse_qs(urlparse(url).query)
        offset = int(query["facetOffset"][0])
        calls.append(query)
        if offset == 0:
            counts = [{"name": str(key), "count": 1} for key in range(1000)]
        else:
            counts = [{"name": "9001", "count": 4}]
        return {"count": 1234, "facets": [{"field": "SPECIES_KEY", "counts": counts}]}

    monkeypatch.setattr(scripts.occurrence_profile, "request_json", request)
    total, counts = scripts.occurrence_profile.occurrence_facet("POLYGON(())", 5, country_code="CN")

    assert total == 1234
    assert len(counts) == 1001
    assert counts[9001] == 4
    assert [int(query["facetOffset"][0]) for query in calls] == [0, 1000]
    assert all(query["facet"] == ["speciesKey"] for query in calls)
    assert all(query["country"] == ["CN"] for query in calls)


def test_occurrence_facet_rejects_repeated_page(scripts, monkeypatch):
    counts = [{"name": str(key), "count": 1} for key in range(1000)]
    monkeypatch.setattr(
        scripts.occurrence_profile,
        "request_json",
        lambda url: {"count": 10, "facets": [{"counts": counts}]},
    )
    with pytest.raises(RuntimeError, match="repeated page"):
        scripts.occurrence_profile.occurrence_facet("POLYGON(())", 5)


def test_occurrence_grid_builds_bounded_sites_and_reconciles_catalog(scripts, tmp_path, monkeypatch):
    catalog = tmp_path / "catalog.csv"
    catalog.write_text(
        "species_id,scientific_name,enabled\n"
        "bird-a,Avis alpha,true\n"
        "bird-b,Avis beta,true\n",
        encoding="utf-8",
    )
    args = Namespace(
        country_code="cn",
        name="China test grid",
        min_latitude=30.0,
        max_latitude=32.0,
        min_longitude=116.0,
        max_longitude=118.0,
        cell_size_degrees=1.0,
        catalog=catalog,
        output=tmp_path / "grid.json",
        occurrence_file=None,
        workers=1,
    )

    def facet(geometry, month, *, country_code=None):
        assert country_code == "CN"
        return 10, {101: month, 202: 1 if month == 5 else 0}

    monkeypatch.setattr(scripts.occurrence_grid, "occurrence_facet", facet)
    monkeypatch.setattr(
        scripts.occurrence_grid,
        "gbif_scientific_names",
        lambda key: (key, ("Avis alpha",) if key == 101 else ("Avis beta",)),
    )

    payload = scripts.occurrence_grid.build(args)

    assert payload["dataset"]["country_code"] == "CN"
    assert len(payload["sites"]) == 4
    site = payload["sites"][0]
    assert site["bounds"] == {
        "min_latitude": 30.0,
        "max_latitude": 31.0,
        "min_longitude": 116.0,
        "max_longitude": 117.0,
    }
    assert site["months"]["5"] == {"Avis alpha": 5, "Avis beta": 1}
    assert site["geometry_wkt"].startswith("POLYGON((116.000000 30.000000,")


def test_occurrence_grid_aggregates_local_tsv_and_zip_without_gbif_requests(scripts, tmp_path, monkeypatch):
    catalog = tmp_path / "catalog.csv"
    catalog.write_text(
        "species_id,scientific_name,enabled\n"
        "bird-a,Avis alpha,true\n"
        "bird-b,Avis beta,true\n",
        encoding="utf-8",
    )
    rows = (
        "speciesKey\tdecimalLatitude\tdecimalLongitude\tmonth\tcountryCode\t"
        "scientificName\toccurrenceCount\n"
        "101\t30.25\t116.25\t5\tCN\tAvis alpha\t2\n"
        "101\t30.25\t116.25\t5\tCN\tAvis alpha\t1\n"
        "202\t31.25\t117.25\t6\tCN\tAvis beta\t\n"
        "101\t30.25\t116.25\t5\tUS\tAvis alpha\t20\n"
        "101\t40.25\t116.25\t5\tCN\tAvis alpha\t20\n"
    )
    occurrence_file = tmp_path / "occurrences.tsv"
    occurrence_file.write_text(rows, encoding="utf-8")
    args = Namespace(
        country_code="CN",
        name="China test grid",
        min_latitude=30.0,
        max_latitude=32.0,
        min_longitude=116.0,
        max_longitude=118.0,
        cell_size_degrees=1.0,
        catalog=catalog,
        output=tmp_path / "grid.json",
        occurrence_file=occurrence_file,
        source_doi="10.15468/dl.example",
        source_query_file=tmp_path / "query.sql",
        source_downloaded_at="2026-10-24T00:00:00Z",
        workers=1,
    )
    args.source_query_file.write_text("SELECT ...", encoding="utf-8")
    monkeypatch.setattr(
        scripts.occurrence_grid,
        "gbif_scientific_names",
        lambda key: pytest.fail("local scientific names should avoid GBIF species requests"),
    )

    payload = scripts.occurrence_grid.build(args)
    sites = {site["site_id"]: site for site in payload["sites"]}
    assert payload["dataset"]["source"] == "GBIF SQL occurrence download"
    assert len(payload["dataset"]["occurrence_file_sha256"]) == 64
    assert payload["dataset"]["source_doi"] == "10.15468/dl.example"
    assert payload["dataset"]["source_query_file"] == str(args.source_query_file.resolve())
    assert len(payload["dataset"]["source_query_sha256"]) == 64
    assert payload["dataset"]["source_downloaded_at"] == "2026-10-24T00:00:00Z"
    assert sites["cn-grid-000-000"]["months"] == {"5": {"Avis alpha": 2}}
    assert sites["cn-grid-001-001"]["months"] == {"6": {"Avis beta": 1}}

    zipped = tmp_path / "occurrences.zip"
    with zipfile.ZipFile(zipped, "w") as archive:
        archive.writestr("download.tsv", rows)
    args.occurrence_file = zipped
    zipped_payload = scripts.occurrence_grid.build(args)
    assert len(zipped_payload["sites"]) == 2


def test_occurrence_grid_prefers_accepted_scientific_name(scripts, tmp_path):
    catalog = tmp_path / "catalog.csv"
    catalog.write_text(
        "species_id,scientific_name,enabled\n"
        "bird-a,Avis accepted,true\n"
        "bird-b,Avis synonym,true\n",
        encoding="utf-8",
    )
    occurrence_file = tmp_path / "occurrences.tsv"
    occurrence_file.write_text(
        "speciesKey\tdecimalLatitude\tdecimalLongitude\tmonth\tcountryCode\t"
        "scientificName\tacceptedScientificName\n"
        "101\t30.25\t116.25\t5\tCN\tAvis synonym\tAvis accepted\n",
        encoding="utf-8",
    )
    args = Namespace(
        country_code="CN",
        name="China test grid",
        min_latitude=30.0,
        max_latitude=31.0,
        min_longitude=116.0,
        max_longitude=117.0,
        cell_size_degrees=1.0,
        catalog=catalog,
        output=tmp_path / "grid.json",
        occurrence_file=occurrence_file,
        workers=1,
    )

    payload = scripts.occurrence_grid.build(args)

    assert payload["sites"][0]["months"] == {"5": {"Avis accepted": 1}}


def test_occurrence_grid_requires_country_and_scientific_name_columns(scripts, tmp_path):
    path = tmp_path / "invalid.tsv"
    path.write_text(
        "speciesKey\tdecimalLatitude\tdecimalLongitude\tmonth\n"
        "101\t30.25\t116.25\t5\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="countryCode"):
        list(scripts.occurrence_grid.occurrence_rows(path))


def test_occurrence_grid_main_writes_output_atomically(scripts, tmp_path, monkeypatch):
    catalog = tmp_path / "catalog.csv"
    catalog.write_text("species_id,scientific_name,enabled\nbird-a,Avis alpha,true\n", encoding="utf-8")
    occurrence_file = tmp_path / "occurrences.tsv"
    occurrence_file.write_text(
        "speciesKey\tdecimalLatitude\tdecimalLongitude\tmonth\tcountryCode\tscientificName\n"
        "101\t30.25\t116.25\t5\tCN\tAvis alpha\n",
        encoding="utf-8",
    )
    output = tmp_path / "nested" / "grid.json"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "build_occurrence_grid.py",
            "--country-code",
            "CN",
            "--name",
            "China",
            "--min-latitude",
            "30",
            "--max-latitude",
            "31",
            "--min-longitude",
            "116",
            "--max-longitude",
            "117",
            "--catalog",
            str(catalog),
            "--occurrence-file",
            str(occurrence_file),
            "--output",
            str(output),
            "--workers",
            "1",
        ],
    )
    assert scripts.occurrence_grid.main() == 0
    assert json.loads(output.read_text(encoding="utf-8"))["sites"][0]["months"] == {
        "5": {"Avis alpha": 1}
    }
    assert not list(output.parent.glob("*.tmp"))


def test_catalog_rejects_conflicting_source_version(scripts, monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "build_species_catalog.py",
            "--taxon-version",
            "v2025",
            "--avilist",
            "avilist-2026.json",
        ],
    )
    with pytest.raises(ValueError, match="disagrees"):
        scripts.catalog.main()


@pytest.mark.parametrize("version", ["../2025", "2025/evil", "2025..2"])
def test_catalog_rejects_path_in_version(scripts, monkeypatch, version):
    monkeypatch.setattr(sys, "argv", ["build_species_catalog.py", "--taxon-version", version])
    with pytest.raises(ValueError, match="release label"):
        scripts.catalog.main()


def runtime_args(**overrides):
    return Namespace(
        **{
            "require_gpu": False,
            "batch_sizes": [1, 3],
            "iterations": 2,
            "warmup": 1,
            "max_vram_mib": None,
            "max_p95_ms": None,
            **overrides,
        }
    )


def test_runtime_refuses_mock_gpu_acceptance_and_missing_weights(scripts, tmp_path):
    with pytest.raises(ValueError, match="GPU acceptance requires"):
        scripts.runtime.run_checks(Settings(_env_file=None), runtime_args(require_gpu=True))
    settings = Settings(_env_file=None, detector_backend="yolo", model_path=tmp_path / "missing.pt")
    with pytest.raises(FileNotFoundError, match="automatic downloads are disabled"):
        scripts.support.prepare_runtime(settings, require_gpu=False)


def test_runtime_rejects_moving_hf_revision_and_missing_cuda(scripts, tmp_path, monkeypatch):
    catalog = tmp_path / "catalog.csv"
    settings = Settings(
        _env_file=None,
        species_backend="bioclip",
        species_catalog_path=catalog,
        bioclip_model_revision="main",
    )
    with pytest.raises(ValueError, match="immutable commit hash"):
        scripts.support.prepare_runtime(settings, require_gpu=False)
    monkeypatch.setitem(
        sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
    )
    with pytest.raises(RuntimeError, match="CUDA is unavailable"):
        scripts.support.CudaMeasurements("cuda", required=True)


def test_runtime_batch_checks_and_resource_cleanup(scripts, monkeypatch):
    settings = Settings(_env_file=None, species_backend="mock", species_batch_size=5)
    detector, species = MockDetector(), MockSpeciesProvider(settings)
    monkeypatch.setattr(scripts.runtime, "build_detector", lambda settings: detector)
    monkeypatch.setattr(scripts.runtime, "build_species_provider", lambda settings: species)
    report = scripts.runtime.run_checks(settings, runtime_args())
    assert report["ok"] and report["mode"] == "smoke_only"
    assert not report["accuracy_evaluated"]
    assert report["vram"] is None
    assert [batch["batch_size"] for batch in report["classification_batches"]] == [1, 3]
    assert all(batch["latency"]["samples"] == 2 for batch in report["classification_batches"])
    assert settings.species_batch_size == 5
    assert not detector.ready and not species.ready


def test_runtime_closes_partial_load_and_fails_latency_gate(scripts, monkeypatch):
    detector, species = MockDetector(), MockSpeciesProvider()
    monkeypatch.setattr(scripts.runtime, "build_detector", lambda settings: detector)
    monkeypatch.setattr(scripts.runtime, "build_species_provider", lambda settings: species)
    report = scripts.runtime.run_checks(Settings(_env_file=None), runtime_args(max_p95_ms=1e-12))
    assert not report["ok"]
    assert report["failures"]

    def fail_load():
        species.ready = True
        raise RuntimeError("partial model load")

    monkeypatch.setattr(species, "load", fail_load)
    with pytest.raises(RuntimeError, match="partial model load"):
        scripts.runtime.run_checks(Settings(_env_file=None), runtime_args())
    assert not species.ready and not detector.ready


@pytest.mark.parametrize("peak_stage", ["load", "pipeline", "early_batch"])
@pytest.mark.parametrize("limit,expected_ok", [(500, False), (900, True)])
def test_runtime_vram_gate_keeps_peak_across_batch_resets(
    scripts, monkeypatch, peak_stage, limit, expected_ok
):
    class Measurements:
        torch = object()

        def __init__(self, device, *, required):
            self.stage = "load"
            self.batch = 0

        def synchronize(self):
            pass

        def snapshot(self):
            reserved = 800 if self.stage == peak_stage else 100
            snapshot = {"peak_allocated_mib": reserved - 10, "peak_reserved_mib": reserved}
            if self.stage == "load":
                self.stage = "pipeline"
            return snapshot

        def reset_peaks(self):
            self.batch += 1
            self.stage = "early_batch" if self.batch == 1 else "final_batch"

    settings = Settings(_env_file=None, species_backend="mock")
    monkeypatch.setattr(scripts.runtime, "CudaMeasurements", Measurements)
    report = scripts.runtime.run_checks(settings, runtime_args(max_vram_mib=limit))
    assert report["ok"] is expected_ok
    assert report["vram"]["peak_reserved_mib"] == 800
    assert report["vram"]["peak_allocated_mib"] == 790
    assert report["classification_batches"][-1]["vram"]["peak_reserved_mib"] == 100
    assert bool(report["failures"]) is not expected_ok


def test_cuda_measurement_synchronizes_and_reports_peaks(scripts, monkeypatch):
    calls = []
    cuda = SimpleNamespace(
        is_available=lambda: True,
        synchronize=lambda device: calls.append("sync"),
        reset_peak_memory_stats=lambda device: calls.append("reset"),
        mem_get_info=lambda device: (512 * 1024**2, 1024 * 1024**2),
        memory_allocated=lambda device: 100 * 1024**2,
        memory_reserved=lambda device: 200 * 1024**2,
        max_memory_allocated=lambda device: 300 * 1024**2,
        max_memory_reserved=lambda device: 400 * 1024**2,
        get_device_name=lambda device: "test GPU",
    )
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(cuda=cuda, __version__="test", version=SimpleNamespace(cuda="test")),
    )
    probe = scripts.support.CudaMeasurements("cuda", required=True)
    assert calls == ["sync", "reset"]
    assert probe.snapshot()["peak_reserved_mib"] == 400
    assert probe.snapshot()["device_used_mib"] == 512
    assert scripts.support.latency_summary([1, 2, 3, 4])["p95_ms"] == 4
    probe.reset_peaks()
    cuda.max_memory_reserved = lambda device: 250 * 1024**2
    snapshot = probe.snapshot()
    assert snapshot["peak_reserved_mib"] == 400
    assert snapshot["interval_peak_reserved_mib"] == 250


def test_unknown_metrics_distinguish_classifier_rejection_from_no_crop(scripts):
    records = [
        {"expected_species_id": "__unknown__", "accepted": False, "classified": False, "candidates": []},
        {"expected_species_id": "__unknown__", "accepted": True, "classified": True, "candidates": []},
        {"expected_species_id": "known", "accepted": False, "classified": False, "candidates": []},
    ]
    metrics = scripts.species.summarize(records)
    assert metrics["unknown_rejection_rate"] == 0.5
    assert metrics["classified_unknown_rejection_rate"] == 0
    assert metrics["top1_accuracy"] == 0
    assert metrics["known_false_reject_rate"] == 1


def test_threshold_sweep_selects_gate_under_unknown_constraint(scripts):
    records = [
        {
            "expected_species_id": "known",
            "top_similarity": 0.4,
            "margin": 0.03,
            "candidates": [{"species_id": "known"}],
        },
        {
            "expected_species_id": "__unknown__",
            "top_similarity": 0.25,
            "margin": 0.02,
            "candidates": [{"species_id": "other"}],
        },
    ]
    sweep = scripts.species.threshold_sweep(records, [0.2, 0.3], [0.01], 0.0)
    assert sweep["recommended"]["min_similarity"] == 0.3
    assert sweep["recommended"]["known_accepted_correct_rate"] == 1
    assert sweep["recommended"]["unknown_false_accept_rate"] == 0


def test_crop_evaluation_preserves_region_batching_and_top3(scripts, tmp_path, monkeypatch):
    Image.new("RGB", (20, 20)).save(tmp_path / "crop.png")
    manifest = tmp_path / "crops.csv"
    manifest.write_text(
        "image_path,expected_species_id,region_code\n"
        "crop.png,known,CN\ncrop.png,known,CN\ncrop.png,__unknown__,US\n"
    )
    output = tmp_path / "report.json"
    settings = Settings(
        _env_file=None,
        species_backend="bioclip",
        species_catalog_path=tmp_path / "catalog.csv",
        bioclip_model="local-dir:" + str(tmp_path),
        species_top_k=1,
        species_batch_size=2,
    )
    provider = MockSpeciesProvider(settings)
    batches = []

    def load():
        provider.ready = True
        provider.taxa = [SimpleNamespace(species_id="known", enabled=True)]

    def classify(images, top_k, region_code):
        batches.append((len(images), top_k, region_code))
        return [
            SpeciesPrediction(
                candidates=(SpeciesCandidate("known", "Avis test", None, None, 0.8),),
                accepted=region_code == "CN",
                reason="test",
                top_similarity=0.8,
                margin=0.1,
                candidate_count=1,
                region_code=region_code,
                catalog_version="test",
            )
            for _ in images
        ]

    monkeypatch.setattr(scripts.species, "Settings", lambda: settings)
    monkeypatch.setattr(scripts.species, "build_species_provider", lambda settings: provider)
    monkeypatch.setattr(provider, "load", load)
    monkeypatch.setattr(provider, "classify", classify)
    monkeypatch.setattr(sys, "argv", ["evaluate_species.py", str(manifest), "--output", str(output)])
    assert scripts.species.main() == 0
    assert batches == [(2, 3, "CN"), (1, 3, "US")]
    report = json.loads(output.read_text())
    assert report["metrics"]["top3_accuracy"] == 1
    assert report["metrics"]["unknown_rejection_rate"] == 1
    assert not provider.ready

    def fail_load():
        provider.ready = True
        raise RuntimeError("partial classifier load")

    monkeypatch.setattr(provider, "load", fail_load)
    with pytest.raises(RuntimeError, match="partial classifier load"):
        scripts.species.main()
    assert not provider.ready


def pipeline_args(manifest, **overrides):
    return Namespace(
        **{
            "manifest": manifest,
            "single_frame": False,
            "require_gpu": False,
            "max_vram_mib": None,
            "max_p95_ms": None,
            "warmup": 1,
            "realtime": False,
            "iou": 0.5,
            "min_top1": None,
            "min_top3": None,
            "max_unknown_false_accept_rate": None,
            **overrides,
        }
    )


@pytest.fixture
def pipeline_manifest(tmp_path):
    Image.new("RGB", (200, 200), (255, 0, 0)).save(tmp_path / "known.png")
    Image.new("RGB", (200, 200), (0, 255, 0)).save(tmp_path / "unknown.png")
    Image.new("RGB", (200, 200), (0, 0, 255)).save(tmp_path / "negative.png")
    frames = []
    for sequence, expected in (("known", "known"), ("unknown", "__unknown__")):
        for index in range(3):
            frames.append(
                {
                    "sequence_id": sequence,
                    "frame_id": str(index),
                    "timestamp_ms": index * 100,
                    "image_path": f"{sequence}.png",
                    "objects": [
                        {"track_id": "bird-1", "expected_species_id": expected, "bbox": [50, 40, 150, 160]},
                    ],
                }
            )
    frames.append(
        {
            "sequence_id": "negative",
            "frame_id": "0",
            "timestamp_ms": 0,
            "image_path": "negative.png",
            "objects": [],
        }
    )
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(frames))
    return path


def test_full_pipeline_measures_actual_crops_and_preserves_tracking(scripts, pipeline_manifest, monkeypatch):
    class Detector(MockDetector):
        def predict(self, image):
            if image.getpixel((0, 0))[2] == 255:
                return DetectorOutput(())
            return super().predict(image)

    class Species(MockSpeciesProvider):
        def classify(self, images, top_k, region_code=None, context=None):
            predictions = []
            for image in images:
                known = image.getpixel((0, 0))[0] == 255
                assert image.size == (130, 156)  # Actual padded pipeline crop, not the full image.
                predictions.append(
                    SpeciesPrediction(
                        candidates=(SpeciesCandidate("known", "Avis test", None, None, 0.8),),
                        accepted=known,
                        reason="accepted" if known else "below_similarity_threshold",
                        top_similarity=0.8 if known else 0.1,
                        margin=0.1,
                        candidate_count=1,
                        region_code=region_code,
                        catalog_version="test",
                    )
                )
            return predictions

    settings = Settings(_env_file=None, species_backend="mock", track_confirm_hits=3)
    detector, species = Detector(), Species(settings)

    def load_species():
        species.ready = True
        species.taxa = [SimpleNamespace(species_id="known", enabled=True)]

    monkeypatch.setattr(species, "load", load_species)
    monkeypatch.setattr(scripts.pipeline, "build_detector", lambda settings: detector)
    monkeypatch.setattr(scripts.pipeline, "build_species_provider", lambda settings: species)
    report = scripts.pipeline.evaluate(settings, pipeline_args(pipeline_manifest, warmup=0))
    assert report["ok"] and not report["real_models"]
    assert report["metrics"]["detection"]["recall"] == 1
    assert report["metrics"]["detection"]["negative_frame_false_trigger_rate"] == 0
    assert report["metrics"]["species_objects"]["top1_accuracy"] == pytest.approx(1 / 3, abs=1e-6)
    assert report["metrics"]["species_objects"]["classified_unknown_rejection_rate"] == 1
    assert report["metrics"]["tracking"] == {
        "id_switches": 0,
        "ground_truth_tracks": 2,
        "detected_tracks": 2,
        "accepted_tracks": 1,
    }
    assert [call["crop_count"] for call in report["classification_calls"]] == [1, 1]
    assert report["latency"]["frame"]["samples"] == 7
    assert report["vram"] is None
    assert not species.ready and not detector.ready


def test_full_pipeline_counts_missed_and_duplicate_detections(scripts, pipeline_manifest, monkeypatch):
    detector = MockDetector()
    monkeypatch.setattr(
        detector,
        "predict",
        lambda image: DetectorOutput(
            (
                RawDetection(Box(50, 40, 150, 160), 0.9),
                RawDetection(Box(50, 40, 150, 160), 0.9),
            )
        ),
    )
    settings = Settings(_env_file=None, species_backend="mock")
    species = MockSpeciesProvider(settings)
    monkeypatch.setattr(
        species, "load", lambda: setattr(species, "taxa", [SimpleNamespace(species_id="known", enabled=True)])
    )
    monkeypatch.setattr(scripts.pipeline, "build_detector", lambda settings: detector)
    monkeypatch.setattr(scripts.pipeline, "build_species_provider", lambda settings: species)
    report = scripts.pipeline.evaluate(settings, pipeline_args(pipeline_manifest, min_top1=0.7))
    assert not report["ok"]
    detection = report["metrics"]["detection"]
    assert detection["tp"] == 6 and detection["fp"] == 8 and detection["fn"] == 0
    assert detection["negative_frame_false_trigger_rate"] == 1
    monkeypatch.setattr(detector, "predict", lambda image: DetectorOutput(()))
    report = scripts.pipeline.evaluate(settings, pipeline_args(pipeline_manifest))
    assert report["metrics"]["detection"]["fn"] == 6
    assert report["metrics"]["species_objects"]["classified_unknown_rejection_rate"] is None
    assert report["classification_calls"] == []


def test_full_pipeline_runs_multibird_batch_and_detects_identity_switch(scripts, tmp_path, monkeypatch):
    Image.new("RGB", (400, 200)).save(tmp_path / "birds.png")
    frames = [
        {
            "sequence_id": "birds",
            "frame_id": str(index),
            "timestamp_ms": index * 100,
            "image_path": "birds.png",
            "objects": [
                {"track_id": "left", "expected_species_id": "known", "bbox": [0, 0, 100, 100]},
                {"track_id": "right", "expected_species_id": "known", "bbox": [300, 0, 400, 100]},
            ],
        }
        for index in range(3)
    ]
    manifest = tmp_path / "frames.json"
    manifest.write_text(json.dumps(frames))
    settings = Settings(
        _env_file=None,
        species_backend="mock",
        track_confirm_hits=1,
        classification_cooldown_seconds=0,
        track_center_distance_threshold=0.01,
        track_max_missed_frames=0,
    )
    detector, species = MockDetector(), MockSpeciesProvider(settings)
    detection_calls = 0

    def detect(image):
        nonlocal detection_calls
        detection_calls += 1
        if detection_calls == 2:
            return DetectorOutput(())  # Forces new tracker IDs when the birds return.
        return DetectorOutput(
            (
                RawDetection(Box(0, 0, 100, 100), 0.9),
                RawDetection(Box(300, 0, 400, 100), 0.9),
            )
        )

    monkeypatch.setattr(detector, "predict", detect)
    monkeypatch.setattr(
        species, "load", lambda: setattr(species, "taxa", [SimpleNamespace(species_id="known", enabled=True)])
    )
    monkeypatch.setattr(scripts.pipeline, "build_detector", lambda settings: detector)
    monkeypatch.setattr(scripts.pipeline, "build_species_provider", lambda settings: species)
    report = scripts.pipeline.evaluate(settings, pipeline_args(manifest, warmup=0))
    assert report["metrics"]["tracking"]["id_switches"] == 2
    assert [call["crop_count"] for call in report["classification_calls"]] == [2, 2]
    assert report["metrics"]["detection"]["fn"] == 2


def test_pipeline_cli_writes_failure_report(scripts, tmp_path, monkeypatch):
    output = tmp_path / "failure.json"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "evaluate_pipeline.py",
            str(tmp_path / "missing.json"),
            "--output",
            str(output),
        ],
    )
    assert scripts.pipeline.main() == 1
    report = json.loads(output.read_text())
    assert not report["ok"] and report["error_type"] == "FileNotFoundError"


@pytest.mark.parametrize("mutation", ["duplicate", "timestamp", "box", "species_change", "region_change"])
def test_full_manifest_rejects_invalid_annotations(scripts, pipeline_manifest, mutation):
    frames = json.loads(pipeline_manifest.read_text())
    if mutation == "duplicate":
        frames[1]["frame_id"] = "0"
    elif mutation == "timestamp":
        frames[1]["timestamp_ms"] = float("nan")
    elif mutation == "box":
        frames[0]["objects"][0]["bbox"] = [20, 20, 0, 0]
    elif mutation == "species_change":
        frames[1]["objects"][0]["expected_species_id"] = "changed"
    else:
        frames[1]["region_code"] = "US"
    pipeline_manifest.write_text(json.dumps(frames))
    with pytest.raises(ValueError):
        scripts.pipeline.load_manifest(pipeline_manifest, "CN")


def test_lock_render_uses_actual_hash_and_rejects_unhashed_artifacts(scripts):
    item = {
        "metadata": {"name": "example", "version": "1.2.3+cu126"},
        "download_info": {
            "url": "https://example.invalid/example.whl",
            "archive_info": {"hashes": {"sha256": "a" * 64}},
        },
    }
    rendered = scripts.lock.render_lock({"install": [item]}, "gpu", "test", "test-inputs")
    assert "example==1.2.3+cu126 --hash=sha256:" + "a" * 64 in rendered
    del item["download_info"]["archive_info"]["hashes"]["sha256"]
    with pytest.raises(ValueError, match="SHA-256"):
        scripts.lock.render_lock({"install": [item]}, "gpu", "test", "test-inputs")


def test_gpu_lock_requires_local_wheelhouse_before_any_resolution(scripts, tmp_path, monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("must not invoke pip for unprovisioned GPU lock")

    monkeypatch.setattr(scripts.lock.subprocess, "run", unexpected)
    with pytest.raises(ValueError, match="--wheelhouse"):
        scripts.lock.generate("gpu", tmp_path / "requirements-gpu-lock.txt", None)
    assert not (tmp_path / "requirements-gpu-lock.txt").exists()


def test_lock_input_check_detects_stale_constraints_without_resolving(scripts, tmp_path, monkeypatch):
    lock = tmp_path / "requirements-dev-lock.txt"
    lock.write_text("# stale lock\n")

    def unexpected(*args, **kwargs):
        pytest.fail("lock input check must not invoke pip")

    monkeypatch.setattr(scripts.lock.subprocess, "run", unexpected)
    with pytest.raises(ValueError, match="dependency inputs changed"):
        scripts.lock.generate("dev", lock, None, check=True)
