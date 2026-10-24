from __future__ import annotations

import hashlib
import json
import math
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Event, RLock
from typing import Any


@dataclass(frozen=True, slots=True)
class OccurrenceSite:
    site_id: str
    name: str
    latitude: float
    longitude: float
    radius_km: float
    country_code: str | None
    monthly_counts: dict[int, dict[str, int]]
    min_latitude: float | None = None
    max_latitude: float | None = None
    min_longitude: float | None = None
    max_longitude: float | None = None

    def distance_km(self, latitude: float, longitude: float) -> float:
        """Return great-circle distance from the profile centre."""
        earth_radius_km = 6371.0088
        first_latitude = math.radians(self.latitude)
        second_latitude = math.radians(latitude)
        latitude_delta = math.radians(latitude - self.latitude)
        longitude_delta = math.radians(longitude - self.longitude)
        haversine = (
            math.sin(latitude_delta / 2.0) ** 2
            + math.cos(first_latitude)
            * math.cos(second_latitude)
            * math.sin(longitude_delta / 2.0) ** 2
        )
        return earth_radius_km * 2.0 * math.asin(min(1.0, math.sqrt(haversine)))

    def contains(self, latitude: float, longitude: float) -> bool:
        if self.min_latitude is None:
            return self.distance_km(latitude, longitude) <= self.radius_km
        return (
            self.min_latitude <= latitude <= self.max_latitude
            and self.min_longitude <= longitude <= self.max_longitude
        )

    def counts_for(self, month: int, window_months: int | None) -> dict[str, int]:
        counts: dict[str, int] = {}
        if window_months is None:
            selected_months = range(1, 13)
        else:
            selected_months = (
                ((month - 1 + delta) % 12) + 1
                for delta in range(-window_months, window_months + 1)
            )
        for selected_month in selected_months:
            for scientific_name, count in self.monthly_counts.get(selected_month, {}).items():
                counts[scientific_name] = counts.get(scientific_name, 0) + count
        return counts


@dataclass(frozen=True, slots=True)
class OccurrenceSelection:
    site: OccurrenceSite
    distance_km: float
    observation_month: int | None
    occurrence_counts: dict[str, int]
    dataset_version: str | None = None


class OccurrenceLookupError(RuntimeError):
    """Raised when a live occurrence lookup cannot provide a usable result."""


class OccurrenceLookupPending(OccurrenceLookupError):
    """Raised while a background lookup is preparing local candidates."""


class OccurrenceIndex:
    """Validated, offline geographic and seasonal occurrence profiles."""

    def __init__(
        self,
        *,
        path: Path,
        dataset: dict[str, Any],
        sites: tuple[OccurrenceSite, ...],
    ) -> None:
        self.path = path
        self.dataset = dataset
        self.sites = sites
        self.checksum_sha256 = _sha256(path)

    @classmethod
    def load(cls, path: Path) -> OccurrenceIndex:
        resolved = path.expanduser().resolve()
        if not resolved.is_file():
            raise FileNotFoundError(f"occurrence profile not found: {resolved}")
        try:
            payload = json.loads(resolved.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"occurrence profile is not valid JSON: {resolved}") from exc
        if not isinstance(payload, dict) or payload.get("schema_version") != 1:
            raise ValueError("occurrence profile schema_version must be 1")
        dataset = payload.get("dataset")
        if not isinstance(dataset, dict) or not _non_empty_string(dataset.get("version")):
            raise ValueError("occurrence profile dataset.version is required")
        raw_sites = payload.get("sites")
        if not isinstance(raw_sites, list) or not raw_sites:
            raise ValueError("occurrence profile must contain at least one site")

        sites: list[OccurrenceSite] = []
        identifiers: set[str] = set()
        for raw_site in raw_sites:
            site = _load_site(raw_site)
            if site.site_id in identifiers:
                raise ValueError(f"duplicate occurrence site_id: {site.site_id}")
            identifiers.add(site.site_id)
            sites.append(site)
        return cls(path=resolved, dataset=dataset, sites=tuple(sites))

    def select(
        self,
        *,
        latitude: float,
        longitude: float,
        observed_at: datetime,
        window_months: int | None,
    ) -> OccurrenceSelection | None:
        matching: list[tuple[float, OccurrenceSite]] = []
        for site in self.sites:
            distance = site.distance_km(latitude, longitude)
            if site.contains(latitude, longitude):
                matching.append((distance, site))
        if not matching:
            return None
        distance, site = min(matching, key=lambda item: (item[0], item[1].site_id))
        return OccurrenceSelection(
            site=site,
            distance_km=distance,
            observation_month=observed_at.month if window_months is not None else None,
            occurrence_counts=site.counts_for(observed_at.month, window_months),
            dataset_version=str(self.dataset.get("version")),
        )

    def metadata(self) -> dict[str, Any]:
        return {
            "available": True,
            "path": str(self.path),
            "checksum_sha256": self.checksum_sha256,
            "dataset": dict(self.dataset),
            "sites": [
                {
                    "site_id": site.site_id,
                    "name": site.name,
                    "latitude": site.latitude,
                    "longitude": site.longitude,
                    "radius_km": site.radius_km,
                    "country_code": site.country_code,
                    "bounds": {
                        "min_latitude": site.min_latitude,
                        "max_latitude": site.max_latitude,
                        "min_longitude": site.min_longitude,
                        "max_longitude": site.max_longitude,
                    },
                    "months": sorted(site.monthly_counts),
                    "species": len(
                        {
                            scientific_name
                            for counts in site.monthly_counts.values()
                            for scientific_name in counts
                        }
                    ),
                }
                for site in self.sites
            ],
        }


class DynamicOccurrenceResolver:
    """Look up birds around arbitrary coordinates through GBIF and cache the result."""

    def __init__(
        self,
        *,
        api_url: str = "https://api.gbif.org/v1",
        radius_km: float = 100.0,
        facet_limit: int = 100,
        cache_ttl_seconds: int = 86_400,
        request_timeout_seconds: float = 8.0,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.radius_km = radius_km
        self.facet_limit = facet_limit
        self.cache_ttl_seconds = cache_ttl_seconds
        self.request_timeout_seconds = request_timeout_seconds
        self._cache: dict[
            tuple[Any, ...], tuple[float, OccurrenceSelection | OccurrenceLookupError | None]
        ] = {}
        self._name_cache: dict[int, tuple[str, ...]] = {}
        self._pending: dict[tuple[Any, ...], Future[OccurrenceSelection | None]] = {}
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="gbif-occurrence")
        self._closed = Event()
        self._lock = RLock()

    def select_cached(
        self,
        *,
        latitude: float,
        longitude: float,
        observed_at: datetime,
        window_months: int | None,
    ) -> OccurrenceSelection | None:
        """Return cached candidates or start one bounded background lookup."""
        if not _valid_coordinate(latitude, longitude):
            return None
        cache_key = self._cache_key(latitude, longitude, self._query_months(observed_at.month, window_months))
        with self._lock:
            if self._closed.is_set():
                raise OccurrenceLookupError("GBIF resolver is closed")
            cached = self._cache.get(cache_key)
            if cached is not None and time.monotonic() < cached[0]:
                if isinstance(cached[1], OccurrenceLookupError):
                    raise OccurrenceLookupError(str(cached[1]))
                return cached[1]
            if cache_key not in self._pending:
                if len(self._pending) >= 8:
                    raise OccurrenceLookupError("GBIF background lookup capacity reached")
                future = self._executor.submit(
                    self.select,
                    latitude=latitude,
                    longitude=longitude,
                    observed_at=observed_at,
                    window_months=window_months,
                )
                self._pending[cache_key] = future

                def completed(lookup: Future[OccurrenceSelection | None]) -> None:
                    try:
                        lookup.result()
                    except Exception as exc:
                        # Retry failures soon rather than caching an incomplete set for a day.
                        self._store_cache(cache_key, OccurrenceLookupError(str(exc)))
                    finally:
                        with self._lock:
                            self._pending.pop(cache_key, None)

                future.add_done_callback(completed)
        raise OccurrenceLookupPending("GBIF local candidates are being prepared")

    def select(
        self,
        *,
        latitude: float,
        longitude: float,
        observed_at: datetime,
        window_months: int | None,
    ) -> OccurrenceSelection | None:
        if not _valid_coordinate(latitude, longitude):
            return None
        query_months = self._query_months(observed_at.month, window_months)
        cache_key = self._cache_key(latitude, longitude, query_months)
        with self._lock:
            if self._closed.is_set():
                raise OccurrenceLookupError("GBIF resolver is closed")
            cached = self._cache.get(cache_key)
            if cached is not None and time.monotonic() < cached[0]:
                if isinstance(cached[1], OccurrenceLookupError):
                    raise OccurrenceLookupError(str(cached[1]))
                return cached[1]

        try:
            key_counts: dict[int, int] = {}
            for month in query_months:
                for species_key, count in self._facet(latitude, longitude, month).items():
                    key_counts[species_key] = key_counts.get(species_key, 0) + count
            names = self._scientific_names(key_counts)
            occurrence_counts: dict[str, int] = {}
            for species_key, count in key_counts.items():
                for name in names.get(species_key, ()):
                    occurrence_counts[name] = occurrence_counts.get(name, 0) + count
            selection = None
            if occurrence_counts:
                site = OccurrenceSite(
                    site_id=self._site_id(latitude, longitude),
                    name=f"GBIF live radius {self.radius_km:g} km",
                    latitude=latitude,
                    longitude=longitude,
                    radius_km=self.radius_km,
                    country_code=None,
                    monthly_counts={1: occurrence_counts},
                )
                selection = OccurrenceSelection(
                    site=site,
                    distance_km=0.0,
                    observation_month=observed_at.month if window_months is not None else None,
                    occurrence_counts=occurrence_counts,
                    dataset_version="gbif-live",
                )
        except (OSError, RuntimeError, ValueError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            raise OccurrenceLookupError(f"GBIF live occurrence lookup failed: {exc}") from exc

        self._store_cache(cache_key, selection)
        return selection

    def _cache_key(
        self, latitude: float, longitude: float, query_months: tuple[int | None, ...]
    ) -> tuple[Any, ...]:
        return (round(latitude, 3), round(longitude, 3), query_months, self.radius_km)

    def _store_cache(
        self, cache_key: tuple[Any, ...], result: OccurrenceSelection | OccurrenceLookupError | None
    ) -> None:
        with self._lock:
            if self._closed.is_set():
                return
            ttl = (
                min(30, self.cache_ttl_seconds)
                if isinstance(result, OccurrenceLookupError)
                else self.cache_ttl_seconds
            )
            self._cache.pop(cache_key, None)
            self._cache[cache_key] = (time.monotonic() + ttl, result)
            if len(self._cache) > 256:
                self._cache.pop(next(iter(self._cache)))

    def close(self) -> None:
        with self._lock:
            self._closed.set()
            self._cache.clear()
            self._name_cache.clear()
        self._executor.shutdown(wait=False, cancel_futures=True)

    def metadata(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": True,
                "api_url": self.api_url,
                "radius_km": self.radius_km,
                "facet_limit": self.facet_limit,
                "cache_ttl_seconds": self.cache_ttl_seconds,
                "cached_coordinate_queries": len(self._cache),
                "cached_species_names": len(self._name_cache),
                "pending_coordinate_queries": len(self._pending),
            }

    def _query_months(self, month: int, window_months: int | None) -> tuple[int | None, ...]:
        if window_months is None:
            return (None,)
        return tuple(((month - 1 + delta) % 12) + 1 for delta in range(-window_months, window_months + 1))

    def _facet(self, latitude: float, longitude: float, month: int | None) -> dict[int, int]:
        merged: dict[int, int] = {}
        offset = 0
        seen_pages: set[tuple[tuple[str, str], ...]] = set()
        while True:
            if self._closed.is_set():
                raise OccurrenceLookupError("GBIF resolver is closed")
            params: dict[str, Any] = {
                "taxon_key": 212,
                "has_coordinate": "true",
                "occurrence_status": "PRESENT",
                "geometry": _circle_wkts(latitude, longitude, self.radius_km),
                "limit": 0,
                "facet": "speciesKey",
                "facetLimit": self.facet_limit,
                "facetOffset": offset,
            }
            if month is not None:
                params["month"] = month
            payload = _request_json(
                f"{self.api_url}/occurrence/search?{urllib.parse.urlencode(params, doseq=True)}",
                timeout=self.request_timeout_seconds,
                stop_event=self._closed,
            )
            facets = payload.get("facets") or []
            if not facets and payload.get("count") == 0:
                return merged
            if not isinstance(facets, list) or not facets or not isinstance(facets[0], dict):
                raise ValueError("GBIF species facet is missing")
            counts = facets[0].get("counts")
            if not isinstance(counts, list) or any(not isinstance(item, dict) for item in counts):
                raise ValueError("GBIF species facet counts are invalid")
            page_signature = tuple(
                (str(item.get("name", "")), str(item.get("count", ""))) for item in counts
            )
            if page_signature in seen_pages:
                raise ValueError("GBIF species facet pagination returned a repeated page")
            seen_pages.add(page_signature)
            for item in counts:
                name = str(item.get("name", ""))
                count = int(item.get("count", 0))
                if name.isdigit() and count > 0:
                    key = int(name)
                    merged[key] = merged.get(key, 0) + count
            if len(counts) < self.facet_limit:
                return merged
            offset += len(counts)

    def _scientific_names(self, key_counts: dict[int, int]) -> dict[int, tuple[str, ...]]:
        names: dict[int, tuple[str, ...]] = {}
        missing: list[int] = []
        with self._lock:
            for species_key in key_counts:
                cached = self._name_cache.get(species_key)
                if cached is None:
                    missing.append(species_key)
                else:
                    names[species_key] = cached
        # Resolve every page so record frequency never excludes a local species.
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(missing)))) as executor:
            resolved = executor.map(self._species_names, missing)
            for species_key, candidates in zip(missing, resolved, strict=True):
                names[species_key] = candidates
            with self._lock:
                if not self._closed.is_set():
                    self._name_cache.update(names)
        return names

    def _species_names(self, species_key: int) -> tuple[str, ...]:
        if self._closed.is_set():
            raise OccurrenceLookupError("GBIF resolver is closed")
        payload = _request_json(
            f"{self.api_url}/species/{species_key}",
            timeout=self.request_timeout_seconds,
            stop_event=self._closed,
        )
        candidates: list[str] = []
        for value in (
            payload.get("acceptedScientificName"),
            payload.get("canonicalName"),
            payload.get("scientificName"),
            payload.get("species"),
        ):
            if isinstance(value, str) and value.strip() and value.strip() not in candidates:
                candidates.append(value.strip())
        if not candidates:
            raise ValueError(f"GBIF species {species_key} has no scientific name")
        return tuple(candidates)

    @staticmethod
    def _site_id(latitude: float, longitude: float) -> str:
        value = f"{latitude:.3f},{longitude:.3f}".encode()
        return f"gbif-live-{hashlib.sha1(value).hexdigest()[:12]}"


def _load_site(raw_site: Any) -> OccurrenceSite:
    if not isinstance(raw_site, dict):
        raise ValueError("each occurrence site must be an object")
    site_id = raw_site.get("site_id")
    name = raw_site.get("name")
    if not _non_empty_string(site_id) or not _non_empty_string(name):
        raise ValueError("occurrence site_id and name are required")
    latitude = _number(raw_site.get("latitude"), "site latitude", -90.0, 90.0)
    longitude = _number(raw_site.get("longitude"), "site longitude", -180.0, 180.0)
    radius_km = _number(raw_site.get("radius_km"), "site radius_km", 0.1, 1000.0)
    country_code = raw_site.get("country_code")
    if country_code is not None:
        if not _non_empty_string(country_code) or len(country_code) != 2 or not country_code.isalpha():
            raise ValueError(f"invalid country_code for occurrence site {site_id}")
        country_code = country_code.upper()

    bounds = raw_site.get("bounds")
    if bounds is None:
        min_latitude = max_latitude = min_longitude = max_longitude = None
    else:
        if not isinstance(bounds, dict):
            raise ValueError(f"occurrence site bounds must be an object: {site_id}")
        min_latitude = _number(bounds.get("min_latitude"), "site minimum latitude", -90.0, 90.0)
        max_latitude = _number(bounds.get("max_latitude"), "site maximum latitude", -90.0, 90.0)
        min_longitude = _number(bounds.get("min_longitude"), "site minimum longitude", -180.0, 180.0)
        max_longitude = _number(bounds.get("max_longitude"), "site maximum longitude", -180.0, 180.0)
        if min_latitude >= max_latitude or min_longitude >= max_longitude:
            raise ValueError(f"occurrence site bounds are invalid: {site_id}")

    raw_months = raw_site.get("months")
    if not isinstance(raw_months, dict) or not raw_months:
        raise ValueError(f"occurrence site {site_id} has no monthly data")
    monthly_counts: dict[int, dict[str, int]] = {}
    for raw_month, raw_counts in raw_months.items():
        try:
            month = int(raw_month)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid month {raw_month!r} in occurrence site {site_id}") from exc
        if not 1 <= month <= 12 or month in monthly_counts:
            raise ValueError(f"invalid or duplicate month {month} in occurrence site {site_id}")
        if not isinstance(raw_counts, dict):
            raise ValueError(f"month {month} in occurrence site {site_id} must be an object")
        counts: dict[str, int] = {}
        for scientific_name, raw_count in raw_counts.items():
            if not _non_empty_string(scientific_name):
                raise ValueError(f"month {month} in occurrence site {site_id} has an empty species name")
            if isinstance(raw_count, bool) or not isinstance(raw_count, int) or raw_count < 1:
                raise ValueError(
                    f"invalid occurrence count for {scientific_name!r} in site {site_id}, month {month}"
                )
            counts[scientific_name] = raw_count
        monthly_counts[month] = counts
    return OccurrenceSite(
        site_id=site_id,
        name=name,
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
        country_code=country_code,
        monthly_counts=monthly_counts,
        min_latitude=min_latitude,
        max_latitude=max_latitude,
        min_longitude=min_longitude,
        max_longitude=max_longitude,
    )


def _valid_coordinate(latitude: float, longitude: float) -> bool:
    return (
        math.isfinite(latitude)
        and math.isfinite(longitude)
        and -90 <= latitude <= 90
        and -180 <= longitude <= 180
    )


def _circle_wkts(latitude: float, longitude: float, radius_km: float, points: int = 32) -> tuple[str, ...]:
    angular_distance = radius_km / 6371.0088
    latitude_radians = math.radians(latitude)
    longitude_radians = math.radians(longitude)
    coordinates: list[tuple[float, float]] = []
    for index in range(points):
        # GBIF requires counter-clockwise exterior rings.
        bearing = -2.0 * math.pi * index / points
        sine_latitude = (
            math.sin(latitude_radians) * math.cos(angular_distance)
            + math.cos(latitude_radians) * math.sin(angular_distance) * math.cos(bearing)
        )
        target_latitude = math.asin(max(-1.0, min(1.0, sine_latitude)))
        target_longitude = longitude_radians + math.atan2(
            math.sin(bearing) * math.sin(angular_distance) * math.cos(latitude_radians),
            math.cos(angular_distance) - math.sin(latitude_radians) * math.sin(target_latitude),
        )
        point_longitude = (math.degrees(target_longitude) + 540.0) % 360.0 - 180.0
        if abs(latitude) == 90.0:
            target_latitude = math.copysign(math.pi / 2.0 - angular_distance, latitude)
            point_longitude = (
                longitude
                + (180.0 if latitude > 0 else 0.0)
                - (1.0 if latitude > 0 else -1.0) * math.degrees(bearing)
            )
        if coordinates:
            while point_longitude - coordinates[-1][0] > 180.0:
                point_longitude -= 360.0
            while point_longitude - coordinates[-1][0] < -180.0:
                point_longitude += 360.0
        coordinates.append((point_longitude, math.degrees(target_latitude)))

    contains_pole = abs(latitude_radians) + angular_distance >= math.pi / 2.0
    if contains_pole:
        first_longitude, first_latitude = coordinates[0]
        final_longitude = first_longitude + math.copysign(360.0, latitude)
        pole_latitude = math.copysign(90.0, latitude)
        coordinates.extend(
            [
                (final_longitude, first_latitude),
                (final_longitude, pole_latitude),
                (first_longitude, pole_latitude),
            ]
        )

    # Clip the unwrapped ring into longitude bands so no edge crosses the date line.
    band_width = 180.0 if contains_pole else 360.0
    min_band = math.floor((min(point[0] for point in coordinates) + 180.0) / band_width)
    max_band = math.floor((max(point[0] for point in coordinates) + 180.0) / band_width)
    rings: list[str] = []
    for band in range(min_band, max_band + 1):
        clipped = coordinates
        for boundary, keep_greater in [
            (-180.0 + band_width * band, True),
            (-180.0 + band_width * (band + 1), False),
        ]:
            output: list[tuple[float, float]] = []
            if not clipped:
                break
            previous = clipped[-1]
            previous_inside = previous[0] >= boundary if keep_greater else previous[0] <= boundary
            for current in clipped:
                current_inside = current[0] >= boundary if keep_greater else current[0] <= boundary
                if current_inside != previous_inside:
                    fraction = (boundary - previous[0]) / (current[0] - previous[0])
                    output.append((boundary, previous[1] + fraction * (current[1] - previous[1])))
                if current_inside:
                    output.append(current)
                previous, previous_inside = current, current_inside
            clipped = output
        if len(clipped) < 3:
            continue
        signed_area = sum(
            first[0] * second[1] - second[0] * first[1]
            for first, second in zip(clipped, clipped[1:] + clipped[:1], strict=True)
        )
        if abs(signed_area) < 1e-12:
            continue
        if signed_area < 0:
            clipped.reverse()
        clipped.append(clipped[0])
        longitude_shift = 360.0 * math.floor(band * band_width / 360.0)
        body = ",".join(f"{lon - longitude_shift:.6f} {lat:.6f}" for lon, lat in clipped)
        rings.append(f"POLYGON(({body}))")
    # Repeated GBIF geometry parameters form a union without double-counting boundaries.
    return tuple(rings)


def _request_json(
    url: str, *, timeout: float, attempts: int = 2, stop_event: Event | None = None
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "bird-assistant-live-occurrence/1"},
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        if stop_event is not None and stop_event.is_set():
            raise RuntimeError("GBIF resolver is closed")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise ValueError("GBIF response is not a JSON object")
            return payload
        except (OSError, ValueError) as exc:
            last_error = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code < 500 and exc.code != 429:
                break
            if attempt + 1 < attempts:
                delay = 0.25 * (2**attempt) + random.random() * 0.1
                if stop_event is None:
                    time.sleep(delay)
                elif stop_event.wait(delay):
                    raise RuntimeError("GBIF resolver is closed") from exc
    raise RuntimeError(f"GBIF request failed: {url}: {last_error}")


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
