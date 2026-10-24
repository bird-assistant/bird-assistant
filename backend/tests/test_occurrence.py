from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from datetime import datetime
from io import BytesIO
from pathlib import Path
from threading import Event
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest

from bird_vision.config import Settings
from bird_vision.domain import ObservationContext
from bird_vision.inference.species import BioClipSpeciesProvider, Taxon
from bird_vision.occurrence import (
    DynamicOccurrenceResolver,
    OccurrenceCacheStore,
    OccurrenceIndex,
    OccurrenceLookupError,
    OccurrenceLookupPending,
    OccurrenceSelection,
    OccurrenceSite,
    _circle_wkts,
    _request_json,
)


def write_profile(path: Path) -> Path:
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "dataset": {"version": "test-v1", "source": "test"},
                "sites": [
                    {
                        "site_id": "hefei-test",
                        "name": "合肥测试点",
                        "latitude": 31.8206,
                        "longitude": 117.2272,
                        "radius_km": 100,
                        "country_code": "CN",
                        "months": {
                            "4": {"Avis spring": 2},
                            "5": {"Hierococcyx hyperythrus": 1},
                            "6": {"Avis summer": 3},
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return path


def test_occurrence_index_uses_nearest_site_and_wraps_month_window(tmp_path: Path) -> None:
    index = OccurrenceIndex.load(write_profile(tmp_path / "occurrence.json"))
    selection = index.select(
        latitude=31.82,
        longitude=117.23,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=1,
    )

    assert selection is not None
    assert selection.site.site_id == "hefei-test"
    assert selection.observation_month == 5
    assert selection.occurrence_counts == {
        "Avis spring": 2,
        "Hierococcyx hyperythrus": 1,
        "Avis summer": 3,
    }
    assert index.select(
        latitude=40.0,
        longitude=117.23,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=1,
    ) is None


def test_occurrence_index_supports_grid_cell_bounds(tmp_path: Path) -> None:
    path = tmp_path / "grid.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "dataset": {"version": "grid-v1", "source": "test"},
                "sites": [
                    {
                        "site_id": "cn-grid-1",
                        "name": "China grid",
                        "latitude": 30.5,
                        "longitude": 116.5,
                        "radius_km": 100,
                        "country_code": "CN",
                        "bounds": {
                            "min_latitude": 30,
                            "max_latitude": 31,
                            "min_longitude": 116,
                            "max_longitude": 117,
                        },
                        "months": {"5": {"Avis grid": 1}},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    index = OccurrenceIndex.load(path)

    selection = index.select(
        latitude=30.75,
        longitude=116.25,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )

    assert selection is not None
    assert selection.site.site_id == "cn-grid-1"
    assert selection.occurrence_counts == {"Avis grid": 1}


def test_candidate_selection_filters_by_place_and_month_without_bonus(tmp_path: Path) -> None:
    profile = write_profile(tmp_path / "occurrence.json")
    settings = Settings(
        _env_file=None,
        environment="test",
        species_backend="bioclip",
        species_catalog_path=tmp_path / "catalog.csv",
        species_occurrence_path=profile,
        species_temporal_window_months=1,
        species_min_local_candidates=2,
    )
    provider = BioClipSpeciesProvider(settings)
    provider._active_taxa = [
        Taxon("spring", "Avis spring", None, None, None, None, region_codes=frozenset({"CN"})),
        Taxon(
            "hawk_cuckoo",
            "Hierococcyx hyperythrus",
            "北棕腹鹰鹃",
            None,
            None,
            None,
            region_codes=frozenset({"CN"}),
        ),
        Taxon("summer", "Avis summer", None, None, None, None, region_codes=frozenset({"CN"})),
        Taxon("foreign", "Avis foreign", None, None, None, None, region_codes=frozenset({"MG"})),
    ]
    provider._active_taxon_indices = {
        taxon.scientific_name.casefold(): index for index, taxon in enumerate(provider._active_taxa)
    }
    provider._occurrence_index = OccurrenceIndex.load(profile)
    context = ObservationContext(
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        time_source="captured_at",
        time_precision="exact",
        latitude=31.8206,
        longitude=117.2272,
        coordinate_source="session",
        region_code="CN",
    )

    local = provider._candidate_selection("CN", context)
    assert local.scope == "local_seasonal"
    assert local.indices == (0, 1, 2)
    assert local.occurrence_counts["Hierococcyx hyperythrus"] == 1
    assert local.coordinates_used
    assert local.fallback_reason is None

    profile_country_wins = provider._candidate_selection("US", context)
    assert profile_country_wins.region_code == "CN"
    assert profile_country_wins.indices == (0, 1, 2)

    unknown_time = provider._candidate_selection("CN", replace(context, time_precision="unknown"))
    assert unknown_time.scope == "local_seasonal"
    assert unknown_time.observation_month is None
    assert unknown_time.temporal_window_months is None

    outside = provider._candidate_selection(
        "CN",
        ObservationContext(
            observed_at=context.observed_at,
            time_source="captured_at",
            time_precision="exact",
            latitude=40.0,
            longitude=117.2272,
            coordinate_source="frame",
            region_code="CN",
        ),
    )
    assert outside.scope == "global"
    assert outside.indices == (0, 1, 2, 3)
    assert outside.fallback_reason == "outside_occurrence_profile_coverage"
    assert not outside.coordinates_used


def test_without_location_or_region_uses_global_candidates(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        environment="test",
        species_backend="bioclip",
        species_catalog_path=tmp_path / "catalog.csv",
        species_occurrence_path=None,
    )
    provider = BioClipSpeciesProvider(settings)
    provider._active_taxa = [
        Taxon("cn", "Avis china", None, None, None, None, region_codes=frozenset({"CN"})),
        Taxon("global", "Avis global", None, None, None, None, region_codes=frozenset()),
    ]
    provider._active_taxon_indices = {
        taxon.scientific_name.casefold(): index for index, taxon in enumerate(provider._active_taxa)
    }

    selection = provider._candidate_selection(None, None)

    assert selection.scope == "global"
    assert selection.indices == (0, 1)
    assert selection.fallback_reason is None


def test_candidate_selection_uses_explicit_region_when_context_has_none(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        environment="test",
        species_backend="bioclip",
        species_catalog_path=tmp_path / "catalog.csv",
        species_occurrence_path=None,
    )
    provider = BioClipSpeciesProvider(settings)
    provider._active_taxa = [
        Taxon("cn", "Avis china", None, None, None, None, region_codes=frozenset({"CN"})),
        Taxon("global", "Avis global", None, None, None, None, region_codes=frozenset()),
    ]
    provider._active_taxon_indices = {
        taxon.scientific_name.casefold(): index for index, taxon in enumerate(provider._active_taxa)
    }

    context = ObservationContext(
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        time_source="captured_at",
        time_precision="exact",
        latitude=None,
        longitude=None,
        coordinate_source=None,
        region_code=None,
    )
    selection = provider._candidate_selection("CN", context)

    assert selection.scope == "country"
    assert selection.region_code == "CN"
    assert selection.indices == (0,)


def test_occurrence_profile_rejects_invalid_counts(tmp_path: Path) -> None:
    path = write_profile(tmp_path / "occurrence.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["sites"][0]["months"]["5"]["Hierococcyx hyperythrus"] = 0
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="invalid occurrence count"):
        OccurrenceIndex.load(path)


def test_dynamic_occurrence_resolver_uses_any_coordinate_and_caches(monkeypatch) -> None:
    calls: list[str] = []

    def request(url, *, timeout, stop_event=None):
        calls.append(url)
        return {"facets": [{"counts": [{"name": "Avis synonym (Test, 2026)", "count": 4}]}]}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver(
        radius_km=50, cache_ttl_seconds=3600, allowed_names={"Avis synonym"}
    )
    observed_at = datetime.fromisoformat("2026-05-28T19:00:00+08:00")

    first = resolver.select(
        latitude=39.9042,
        longitude=116.4074,
        observed_at=observed_at,
        window_months=0,
    )
    second = resolver.select(
        latitude=39.9042,
        longitude=116.4074,
        observed_at=observed_at,
        window_months=0,
    )

    assert first is not None
    assert second is first
    assert first.occurrence_counts == {"Avis synonym": 4}
    assert len([url for url in calls if "/occurrence/search?" in url]) == 1
    assert parse_qs(urlsplit(calls[0]).query)["facet"] == ["scientificName"]
    assert resolver.metadata()["cached_coordinate_queries"] == 1


def test_dynamic_occurrence_maps_gbif_scientific_name_to_catalog_name(monkeypatch) -> None:
    def request(url, *, timeout, stop_event=None):
        return {
            "facets": [
                {"counts": [{"name": "Terpsiphone incei (Gould, 1852)", "count": 6}]}
            ]
        }

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver(
        allowed_names={"Terpsiphone incei", "Terpsiphone paradisi"}
    )
    selection = resolver.select(
        latitude=31.8206,
        longitude=117.2272,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    assert selection is not None
    assert selection.occurrence_counts == {"Terpsiphone incei": 6}


def test_dynamic_occurrence_does_not_guess_cross_genus_taxonomy_mapping() -> None:
    resolver = DynamicOccurrenceResolver(
        allowed_names={"Schoeniclus spodocephalus", "Emberiza citrinella"}
    )
    try:
        assert resolver._catalog_name("Emberiza spodocephala Pallas, 1776") is None
        assert resolver._catalog_name("Emberiza unknown Pallas, 1776") is None
    finally:
        resolver.close()


def test_candidate_selection_falls_back_to_live_arbitrary_coordinate(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        environment="test",
        species_backend="bioclip",
        species_catalog_path=tmp_path / "catalog.csv",
        species_occurrence_path=None,
    )
    provider = BioClipSpeciesProvider(settings)
    provider._active_taxa = [
        Taxon("a", "Avis alpha", None, None, None, None, region_codes=frozenset({"CN"})),
        Taxon("b", "Avis beta", None, None, None, None, region_codes=frozenset({"CN"})),
    ]
    provider._active_taxon_indices = {
        taxon.scientific_name.casefold(): index for index, taxon in enumerate(provider._active_taxa)
    }

    class FakeResolver:
        def select_cached(self, **kwargs):
            site = OccurrenceSite(
                site_id="gbif-live-test",
                name="GBIF live",
                latitude=39.9042,
                longitude=116.4074,
                radius_km=100,
                country_code=None,
                monthly_counts={1: {"Avis alpha": 1}},
            )
            return OccurrenceSelection(
                site=site,
                distance_km=0.0,
                observation_month=5,
                occurrence_counts={"Avis alpha": 3, "Avis beta": 2},
                dataset_version="gbif-live",
            )

    provider._dynamic_occurrence = FakeResolver()
    context = ObservationContext(
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        time_source="captured_at",
        time_precision="exact",
        latitude=39.9042,
        longitude=116.4074,
        coordinate_source="session",
        region_code="CN",
    )

    selection = provider._candidate_selection("CN", context)

    assert selection.scope == "local_seasonal"
    assert selection.indices == (0, 1)
    assert selection.occurrence_dataset_version == "gbif-live"
    assert selection.coordinates_used


def test_live_query_polygon_is_closed_and_counter_clockwise() -> None:
    (geometry,) = _circle_wkts(31.8206, 117.2272, 100)
    coordinates = [
        tuple(map(float, point.split()))
        for point in geometry.removeprefix("POLYGON((").removesuffix("))").split(",")
    ]
    assert coordinates[0] == coordinates[-1]
    signed_area = sum(
        first[0] * second[1] - second[0] * first[1]
        for first, second in zip(coordinates[:-1], coordinates[1:], strict=True)
    )
    assert signed_area > 0


@pytest.mark.parametrize(
    "latitude, longitude",
    [
        (0, 179.9),
        (0, -179.9),
        (89.9, 0),
        (-89.9, 0),
        (89.9, 179.9),
        (-89.9, -179.9),
        (90, 0),
        (-90, 180),
    ],
)
def test_live_query_splits_date_line_and_closes_polar_caps(latitude, longitude) -> None:
    geometries = _circle_wkts(latitude, longitude, 100)
    assert len(geometries) >= 2
    for geometry in geometries:
        ring = geometry.removeprefix("POLYGON((").removesuffix("))")
        coordinates = [tuple(map(float, point.split())) for point in ring.split(",")]
        assert coordinates[0] == coordinates[-1]
        assert all(-180 <= lon <= 180 and -90 <= lat <= 90 for lon, lat in coordinates)
        assert sum(
            first[0] * second[1] - second[0] * first[1]
            for first, second in zip(coordinates[:-1], coordinates[1:], strict=True)
        ) > 0
        if abs(latitude) > 89:
            assert all(abs(lat) > 88 for _, lat in coordinates)
            assert any(abs(lat) == 90 for _, lat in coordinates)
        else:
            assert all(abs(lon) > 178 for lon, _ in coordinates)


def test_live_query_encodes_split_geometries_as_union_parameters(monkeypatch) -> None:
    def request(url, *, timeout, stop_event=None):
        geometries = parse_qs(urlsplit(url).query)["geometry"]
        assert len(geometries) == 2
        assert all(geometry.startswith("POLYGON((") for geometry in geometries)
        return {"count": 0, "facets": []}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver()
    assert resolver._facet(0, 179.9, 1) == {}


def test_live_resolver_resolves_species_from_every_facet_page(monkeypatch) -> None:
    offsets: list[int] = []

    def request(url, *, timeout, stop_event=None):
        if "/occurrence/search?" in url:
            offset = int(parse_qs(urlsplit(url).query)["facetOffset"][0])
            offsets.append(offset)
            names = ["Avis alpha", "Avis beta", "Avis gamma", "Avis delta", "Avis epsilon"][
                offset : offset + 2
            ]
            return {
                "facets": [
                    {"counts": [{"name": f"{name} (Test, 2026)", "count": 5} for name in names]}
                ]
            }

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    names = {"Avis alpha", "Avis beta", "Avis gamma", "Avis delta", "Avis epsilon"}
    resolver = DynamicOccurrenceResolver(facet_limit=2, allowed_names=names)
    selection = resolver.select(
        latitude=51.5074,
        longitude=-0.1278,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )

    assert selection is not None
    assert selection.occurrence_counts == dict.fromkeys(names, 5)
    assert offsets == [0, 2, 4]


@pytest.mark.parametrize("window_months, expected_months", [(None, [None]), (1, ["12", "1", "2"])])
def test_live_resolver_caches_empty_results_and_handles_month_windows(
    monkeypatch, window_months, expected_months
) -> None:
    months: list[str | None] = []

    def request(url, *, timeout, stop_event=None):
        months.append(parse_qs(urlsplit(url).query).get("month", [None])[0])
        return {"facets": [{"counts": []}]}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver()
    for _ in range(2):
        assert resolver.select(
            latitude=0.0,
            longitude=0.0,
            observed_at=datetime.fromisoformat("2026-01-01T00:00:00Z"),
            window_months=window_months,
        ) is None
    assert months == expected_months


def test_live_resolver_does_not_cache_failed_facet_lookup(monkeypatch) -> None:
    attempts = 0

    def request(url, *, timeout, stop_event=None):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("GBIF unavailable")
        return {"facets": [{"counts": [{"name": "Avis alpha (Test, 2026)", "count": 4}]}]}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver(allowed_names={"Avis alpha"})
    query = {
        "latitude": 39.9042,
        "longitude": 116.4074,
        "observed_at": datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        "window_months": 0,
    }
    with pytest.raises(OccurrenceLookupError, match="GBIF unavailable"):
        resolver.select(**query)
    assert resolver.metadata()["cached_coordinate_queries"] == 0
    assert resolver.select(**query).occurrence_counts == {"Avis alpha": 4}
    assert attempts == 2


@pytest.mark.parametrize("status", [400, 429, 503])
def test_gbif_requests_retry_only_transient_http_errors(monkeypatch, status) -> None:
    attempts = 0

    def urlopen(request, *, timeout):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise HTTPError(request.full_url, status, "GBIF error", {}, None)
        return BytesIO(b'{"count": 1}')

    monkeypatch.setattr("bird_vision.occurrence.urllib.request.urlopen", urlopen)
    monkeypatch.setattr("bird_vision.occurrence.time.sleep", lambda _: None)
    if status == 400:
        with pytest.raises(RuntimeError, match="400"):
            _request_json("https://api.gbif.org/v1/occurrence/search", timeout=1)
        assert attempts == 1
    else:
        assert _request_json("https://api.gbif.org/v1/occurrence/search", timeout=1) == {"count": 1}
        assert attempts == 2


@pytest.mark.parametrize("latitude, longitude", [(91, 0), (0, -181), (float("nan"), 0), (0, float("inf"))])
def test_live_resolver_rejects_invalid_coordinates_without_network(monkeypatch, latitude, longitude) -> None:
    def request(url, *, timeout, stop_event=None):
        pytest.fail("invalid coordinates must not issue a GBIF request")

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    assert DynamicOccurrenceResolver().select(
        latitude=latitude,
        longitude=longitude,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    ) is None


@pytest.mark.parametrize("outcome", ["no_candidates", "lookup_failed", "lookup_pending"])
def test_candidate_selection_reports_live_lookup_fallback(tmp_path: Path, outcome: str) -> None:
    profile = write_profile(tmp_path / "occurrence.json")
    provider = BioClipSpeciesProvider(
        Settings(
            _env_file=None,
            environment="test",
            species_backend="bioclip",
            species_catalog_path=tmp_path / "catalog.csv",
        )
    )
    provider._occurrence_index = OccurrenceIndex.load(profile)
    provider._active_taxa = [
        Taxon("a", "Avis spring", None, None, None, None, region_codes=frozenset({"CN"})),
    ]
    provider._active_taxon_indices = {"avis spring": 0}

    class FakeResolver:
        def select_cached(self, **kwargs):
            if outcome == "lookup_failed":
                raise OccurrenceLookupError("GBIF unavailable")
            if outcome == "lookup_pending":
                raise OccurrenceLookupPending("GBIF local candidates are being prepared")
            return None

    provider._dynamic_occurrence = FakeResolver()
    context = ObservationContext(
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        time_source="captured_at",
        time_precision="exact",
        latitude=31.8206,
        longitude=117.2272,
        coordinate_source="session",
        region_code="CN",
    )
    selection = provider._candidate_selection("CN", context)
    assert selection.scope == "global"
    assert not selection.coordinates_used
    assert selection.fallback_reason == f"live_occurrence_{outcome}"


@pytest.mark.parametrize("latitude, longitude", [(91, 0), (0, -181), (float("nan"), 0), (0, float("inf"))])
def test_provider_does_not_advertise_invalid_coordinates(latitude, longitude) -> None:
    provider = BioClipSpeciesProvider(Settings(_env_file=None, environment="test"))
    provider._dynamic_occurrence = DynamicOccurrenceResolver()
    assert provider.coordinates_supported(0, 0)
    assert not provider.coordinates_supported(latitude, longitude)


def test_background_lookup_returns_immediately_deduplicates_and_publishes(monkeypatch) -> None:
    entered, release, finished = Event(), Event(), Event()
    calls: list[str] = []

    def request(url, *, timeout, stop_event=None):
        calls.append(url)
        if "/occurrence/search?" in url:
            entered.set()
            assert release.wait(5)
            return {"facets": [{"counts": [{"name": "Avis alpha (Test, 2026)", "count": 4}]}]}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver(allowed_names={"Avis alpha"})
    query = dict(
        latitude=39.9042,
        longitude=116.4074,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    try:
        with pytest.raises(OccurrenceLookupPending):
            resolver.select_cached(**query)
        assert entered.wait(5)
        with pytest.raises(OccurrenceLookupPending):
            resolver.select_cached(**query)
        assert resolver.metadata()["pending_coordinate_queries"] == 1
        future = next(iter(resolver._pending.values()))
        future.add_done_callback(lambda _: finished.set())
        release.set()
        assert finished.wait(5)
        selection = resolver.select_cached(**query)
        assert selection is not None
        assert selection.occurrence_counts == {"Avis alpha": 4}
        assert resolver.metadata()["pending_coordinate_queries"] == 0
        assert len(calls) == 1
    finally:
        release.set()
        resolver.close()


def test_background_failure_has_short_cooldown_then_retries(monkeypatch) -> None:
    release, finished = Event(), Event()
    clock = [0.0]
    calls = 0

    def request(url, *, timeout, stop_event=None):
        nonlocal calls
        calls += 1
        assert release.wait(5)
        if calls == 1:
            raise RuntimeError("GBIF unavailable")
        return {"count": 0, "facets": []}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    monkeypatch.setattr("bird_vision.occurrence.time.monotonic", lambda: clock[0])
    resolver = DynamicOccurrenceResolver()
    query = dict(
        latitude=39.9042,
        longitude=116.4074,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    try:
        with pytest.raises(OccurrenceLookupPending):
            resolver.select_cached(**query)
        future = next(iter(resolver._pending.values()))
        future.add_done_callback(lambda _: finished.set())
        release.set()
        assert finished.wait(5)
        with pytest.raises(OccurrenceLookupError, match="GBIF unavailable"):
            resolver.select_cached(**query)
        assert calls == 1
        clock[0] = 31.0
        finished.clear()
        release.clear()
        with pytest.raises(OccurrenceLookupPending):
            resolver.select_cached(**query)
        future = next(iter(resolver._pending.values()))
        future.add_done_callback(lambda _: finished.set())
        release.set()
        assert finished.wait(5)
        assert resolver.select_cached(**query) is None
        assert calls == 2
    finally:
        release.set()
        resolver.close()


def test_background_lookups_are_bounded_and_close_cancels_queued_work(monkeypatch) -> None:
    release = Event()

    def request(url, *, timeout, stop_event=None):
        assert release.wait(5)
        return {"count": 0, "facets": []}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver()
    query = dict(
        longitude=116.4074,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    try:
        for latitude in range(8):
            with pytest.raises(OccurrenceLookupPending):
                resolver.select_cached(latitude=latitude, **query)
        with pytest.raises(OccurrenceLookupError, match="capacity"):
            resolver.select_cached(latitude=9, **query)
        pending = list(resolver._pending.values())
        resolver.close()
        assert sum(future.cancelled() for future in pending) >= 6
        with pytest.raises(OccurrenceLookupError, match="closed"):
            resolver.select_cached(latitude=0, **query)
    finally:
        release.set()
        resolver.close()
        resolver._executor.shutdown(wait=True)
    assert resolver.metadata()["pending_coordinate_queries"] == 0
    assert resolver.metadata()["cached_coordinate_queries"] == 0


def test_shutdown_prevents_http_retry(monkeypatch) -> None:
    stopped = Event()
    attempts = 0

    def urlopen(request, *, timeout):
        nonlocal attempts
        attempts += 1
        stopped.set()
        raise OSError("connection lost during shutdown")

    monkeypatch.setattr("bird_vision.occurrence.urllib.request.urlopen", urlopen)
    with pytest.raises(RuntimeError, match="closed"):
        _request_json("https://api.gbif.org/v1/occurrence/search", timeout=1, stop_event=stopped)
    assert attempts == 1


@pytest.mark.parametrize("invalid", ["facet", "name"])
def test_incomplete_gbif_response_is_not_cached_as_a_valid_result(monkeypatch, invalid) -> None:
    def request(url, *, timeout, stop_event=None):
        if "/occurrence/search?" in url and invalid != "facet":
            return {"facets": [{"counts": [{"name": "", "count": 4}]}]}
        return {}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver()
    with pytest.raises(OccurrenceLookupError):
        resolver.select(
            latitude=39.9042,
            longitude=116.4074,
            observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
            window_months=0,
        )
    assert resolver.metadata()["cached_coordinate_queries"] == 0


def test_persistent_cache_survives_restart_and_reuses_nearby_region(tmp_path: Path, monkeypatch) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    network_calls = 0

    def request(url, *, timeout, stop_event=None):
        nonlocal network_calls
        network_calls += 1
        if "/occurrence/search?" in url:
            return {"facets": [{"counts": [{"name": "Avis alpha (Test, 2026)", "count": 4}]}]}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    query = dict(
        latitude=31.8206,
        longitude=117.2272,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    first = DynamicOccurrenceResolver(cache_path=cache_path)
    assert first.select(**query).occurrence_counts == {"Avis alpha": 4}
    assert first.metadata()["coordinate_cache"]["writes"] == 1
    first.close()
    calls_after_first_lookup = network_calls

    second = DynamicOccurrenceResolver(cache_path=cache_path)
    try:
        cached = second.select_cached(**{**query, "latitude": 31.84, "longitude": 117.24})
        assert cached is not None
        assert cached.occurrence_counts == {"Avis alpha": 4}
        assert cached.site.latitude == 31.8
        assert cached.site.longitude == 117.2
        assert network_calls == calls_after_first_lookup
        metadata = second.metadata()["coordinate_cache"]
        assert metadata["persistent"]
        assert metadata["entries"] == 1
        assert metadata["hits"] == 1
    finally:
        second.close()


def test_persistent_cache_stores_empty_result_and_separates_months(tmp_path: Path, monkeypatch) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    calls: list[str | None] = []

    def request(url, *, timeout, stop_event=None):
        calls.append(parse_qs(urlsplit(url).query).get("month", [None])[0])
        return {"count": 0, "facets": []}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver(cache_path=cache_path, allowed_names={"Avis alpha"})
    may = dict(
        latitude=31.8206,
        longitude=117.2272,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    assert resolver.select(**may) is None
    resolver.close()

    restarted = DynamicOccurrenceResolver(cache_path=cache_path, allowed_names={"Avis alpha"})
    try:
        assert restarted.select_cached(**may) is None
        with pytest.raises(OccurrenceLookupPending):
            restarted.select_cached(
                **{
                    **may,
                    "observed_at": datetime.fromisoformat("2026-06-28T19:00:00+08:00"),
                }
            )
        assert calls == ["5"]
    finally:
        restarted.close()


def test_persistent_cache_expiry_forces_refresh(tmp_path: Path, monkeypatch) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    clock = [1_000.0]
    calls = 0

    def request(url, *, timeout, stop_event=None):
        nonlocal calls
        calls += 1
        return {"count": 0, "facets": []}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    monkeypatch.setattr("bird_vision.occurrence.time.time", lambda: clock[0])
    query = dict(
        latitude=31.8206,
        longitude=117.2272,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    resolver = DynamicOccurrenceResolver(cache_path=cache_path, cache_ttl_seconds=60)
    assert resolver.select(**query) is None
    resolver.close()
    clock[0] += 61

    restarted = DynamicOccurrenceResolver(cache_path=cache_path, cache_ttl_seconds=60)
    try:
        assert restarted.select(**query) is None
        assert calls == 2
    finally:
        restarted.close()


def test_persistent_cache_evicts_oldest_and_discards_invalid_row(tmp_path: Path) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    store = OccurrenceCacheStore(cache_path, max_entries=2)
    store.put("oldest", {"Avis alpha": 1}, ttl_seconds=3600)
    store.put("middle", None, ttl_seconds=3600)
    store.put("newest", {"Avis beta": 2}, ttl_seconds=3600)
    assert store.metadata()["entries"] == 2
    assert store.metadata()["evictions"] == 1
    assert store.get("oldest", ttl_seconds=3600) == (False, None)
    store.close()

    connection = sqlite3.connect(cache_path)
    now = __import__("time").time()
    connection.execute(
        "INSERT OR REPLACE INTO occurrence_cache VALUES (?, ?, ?, ?, ?)",
        ("invalid", '{"Avis alpha":0}', now, now + 3600, now),
    )
    connection.commit()
    connection.close()
    reopened = OccurrenceCacheStore(cache_path, max_entries=2)
    try:
        assert reopened.get("invalid", ttl_seconds=3600) == (False, None)
        assert reopened.metadata()["invalid_rows"] == 1
    finally:
        reopened.close()


def test_persistent_cache_recovers_corrupt_database(tmp_path: Path) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    cache_path.write_bytes(b"not a sqlite database")
    store = OccurrenceCacheStore(cache_path, max_entries=16)
    try:
        store.put("valid", {"Avis alpha": 1}, ttl_seconds=3600)
        assert store.get("valid", ttl_seconds=3600) == (True, {"Avis alpha": 1})
        assert store.metadata()["last_error"] == "recovered corrupt occurrence cache"
        assert list(tmp_path.glob("occurrence.sqlite3.corrupt-*"))
    finally:
        store.close()


def test_persistent_cache_merges_newer_regions_without_overwriting_newer_target(
    tmp_path: Path, monkeypatch
) -> None:
    clock = [1_000.0]
    monkeypatch.setattr("bird_vision.occurrence.time.time", lambda: clock[0])
    source_path = tmp_path / "source.sqlite3"
    target_path = tmp_path / "target.sqlite3"
    source = OccurrenceCacheStore(source_path, max_entries=16)
    source.put("shared", {"Avis old": 1}, ttl_seconds=3600)
    source.put("source-only", {"Avis source": 2}, ttl_seconds=3600)
    source.close()
    clock[0] += 10
    target = OccurrenceCacheStore(target_path, max_entries=16)
    target.put("shared", {"Avis current": 3}, ttl_seconds=3600)
    assert target.merge_from(source_path) == 2
    assert target.get("shared", ttl_seconds=3600) == (True, {"Avis current": 3})
    assert target.get("source-only", ttl_seconds=3600) == (True, {"Avis source": 2})
    target.close()


def test_persistent_cache_lock_is_not_treated_as_corruption_and_transaction_recovers(
    tmp_path: Path,
) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    store = OccurrenceCacheStore(cache_path, max_entries=16)
    blocker = sqlite3.connect(cache_path)
    blocker.execute("BEGIN IMMEDIATE")
    try:
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            store.put("blocked", {"Avis alpha": 1}, ttl_seconds=3600)
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            OccurrenceCacheStore(cache_path, max_entries=16)
        assert not list(tmp_path.glob("occurrence.sqlite3.corrupt-*"))
    finally:
        blocker.rollback()
        blocker.close()
    store.put("recovered", {"Avis beta": 2}, ttl_seconds=3600)
    assert store.get("recovered", ttl_seconds=3600) == (True, {"Avis beta": 2})
    store.close()


def test_successful_lookup_survives_persistent_cache_write_failure(
    tmp_path: Path, monkeypatch
) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"

    def request(url, *, timeout, stop_event=None):
        if "/occurrence/search?" in url:
            return {"facets": [{"counts": [{"name": "Avis alpha (Test, 2026)", "count": 4}]}]}

    monkeypatch.setattr("bird_vision.occurrence._request_json", request)
    resolver = DynamicOccurrenceResolver(cache_path=cache_path, allowed_names={"Avis alpha"})
    blocker = sqlite3.connect(cache_path)
    blocker.execute("BEGIN IMMEDIATE")
    query = dict(
        latitude=31.8206,
        longitude=117.2272,
        observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
        window_months=0,
    )
    try:
        selection = resolver.select(**query)
        assert selection is not None
        assert selection.occurrence_counts == {"Avis alpha": 4}
        assert resolver.select_cached(**query) is selection
        assert not resolver.persistent_result_available(**query)
        assert "locked" in resolver.metadata()["coordinate_cache"]["last_error"]
    finally:
        blocker.rollback()
        blocker.close()
        resolver.close()


def test_persistent_cache_snapshot_includes_uncheckpointed_wal_data(tmp_path: Path) -> None:
    source_path = tmp_path / "source.sqlite3"
    snapshot_path = tmp_path / "snapshot.sqlite3"
    source = OccurrenceCacheStore(source_path, max_entries=16)
    source.put("region", {"Avis alpha": 1}, ttl_seconds=3600)
    source.snapshot(snapshot_path)
    snapshot = OccurrenceCacheStore(snapshot_path, max_entries=16)
    try:
        assert snapshot.get("region", ttl_seconds=3600) == (True, {"Avis alpha": 1})
    finally:
        snapshot.close()
        source.close()


def test_persistent_cache_snapshot_rejects_source_path(tmp_path: Path) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    store = OccurrenceCacheStore(cache_path, max_entries=16)
    try:
        with pytest.raises(ValueError, match="must not replace"):
            store.snapshot(cache_path)
    finally:
        store.close()


def test_persistent_hits_keep_memory_cache_bounded(tmp_path: Path) -> None:
    cache_path = tmp_path / "occurrence.sqlite3"
    resolver = DynamicOccurrenceResolver(cache_path=cache_path, cache_max_entries=512)
    try:
        for index in range(300):
            key = f"region-{index}"
            resolver._cache_store.put(key, {"Avis alpha": 1}, ttl_seconds=3600)
            found, selection = resolver._persistent_result(
                key,
                latitude=float(index % 90),
                longitude=float(index % 180),
                observed_at=datetime.fromisoformat("2026-05-28T19:00:00+08:00"),
                window_months=0,
            )
            assert found and selection is not None
        assert len(resolver._cache) == 256
    finally:
        resolver.close()


def test_persistent_cache_merge_removes_expired_rows_before_eviction(
    tmp_path: Path, monkeypatch
) -> None:
    clock = [1_000.0]
    monkeypatch.setattr("bird_vision.occurrence.time.time", lambda: clock[0])
    target_path = tmp_path / "target.sqlite3"
    source_path = tmp_path / "source.sqlite3"
    target = OccurrenceCacheStore(target_path, max_entries=2)
    target.put("valid", {"Avis valid": 1}, ttl_seconds=3600)
    connection = sqlite3.connect(target_path)
    connection.execute(
        "INSERT INTO occurrence_cache VALUES (?, ?, ?, ?, ?)",
        ("expired", None, 0, 999, 2_000),
    )
    connection.commit()
    connection.close()
    source = OccurrenceCacheStore(source_path, max_entries=2)
    source.put("fresh", {"Avis fresh": 2}, ttl_seconds=3600)
    source.close()
    assert target.merge_from(source_path) == 1
    assert target.get("valid", ttl_seconds=3600)[0]
    assert target.get("fresh", ttl_seconds=3600)[0]
    assert target.metadata()["entries"] == 2
    target.close()
