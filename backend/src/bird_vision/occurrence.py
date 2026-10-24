from __future__ import annotations

import hashlib
import json
import math
import random
import sqlite3
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


class _CorruptOccurrenceCache(sqlite3.DatabaseError):
    pass


class OccurrenceCacheStore:
    """Persist completed regional GBIF queries across service restarts."""

    SCHEMA_VERSION = 1

    def __init__(self, path: Path, *, max_entries: int) -> None:
        self.path = path.expanduser().resolve()
        self.max_entries = max_entries
        self._lock = RLock()
        self._connection: sqlite3.Connection | None = None
        self._hits = 0
        self._misses = 0
        self._writes = 0
        self._evictions = 0
        self._invalid_rows = 0
        self._last_error: str | None = None
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._open()
        except sqlite3.DatabaseError as exc:
            if not isinstance(exc, _CorruptOccurrenceCache) and getattr(
                exc, "sqlite_errorcode", None
            ) not in {
                sqlite3.SQLITE_CORRUPT,
                sqlite3.SQLITE_NOTADB,
            }:
                raise
            self._recover_corrupt_database()
            self._open()

    def _open(self) -> None:
        connection = sqlite3.connect(self.path, timeout=0.25, check_same_thread=False)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.execute("PRAGMA busy_timeout=250")
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if version not in {0, self.SCHEMA_VERSION}:
                raise ValueError(f"unsupported occurrence cache schema {version}")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS occurrence_cache (
                    cache_key TEXT PRIMARY KEY,
                    payload_json TEXT,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    last_accessed REAL NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS occurrence_cache_expiry "
                "ON occurrence_cache(expires_at)"
            )
            connection.execute(f"PRAGMA user_version={self.SCHEMA_VERSION}")
            check = connection.execute("PRAGMA quick_check").fetchone()
            if not check or check[0] != "ok":
                raise _CorruptOccurrenceCache(
                    f"occurrence cache integrity check failed: {check}"
                )
            connection.commit()
        except Exception:
            connection.close()
            raise
        self._connection = connection

    def _recover_corrupt_database(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None
        suffix = f".corrupt-{time.time_ns()}"
        for path in (self.path, Path(f"{self.path}-wal"), Path(f"{self.path}-shm")):
            if path.exists():
                path.replace(Path(f"{path}{suffix}"))
        self._last_error = "recovered corrupt occurrence cache"

    def get(self, cache_key: str, *, ttl_seconds: int) -> tuple[bool, dict[str, int] | None]:
        found, payload, _ = self.get_entry(cache_key, ttl_seconds=ttl_seconds)
        return found, payload

    def get_entry(
        self, cache_key: str, *, ttl_seconds: int
    ) -> tuple[bool, dict[str, int] | None, float]:
        now = time.time()
        with self._lock:
            connection = self._require_connection()
            row = connection.execute(
                "SELECT payload_json, created_at, expires_at FROM occurrence_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            if row is None:
                self._misses += 1
                return False, None, 0.0
            payload_json, created_at, expires_at = row
            if now >= min(float(expires_at), float(created_at) + ttl_seconds):
                try:
                    connection.execute(
                        "DELETE FROM occurrence_cache WHERE cache_key = ?", (cache_key,)
                    )
                    connection.commit()
                except sqlite3.Error as exc:
                    connection.rollback()
                    self._last_error = f"{type(exc).__name__}: {exc}"
                self._misses += 1
                return False, None, 0.0
            try:
                payload = None if payload_json is None else json.loads(payload_json)
                if payload is not None and (
                    not isinstance(payload, dict)
                    or any(
                        not isinstance(name, str)
                        or not name
                        or not isinstance(count, int)
                        or isinstance(count, bool)
                        or count < 1
                        for name, count in payload.items()
                    )
                ):
                    raise ValueError("invalid occurrence cache payload")
            except (TypeError, ValueError, json.JSONDecodeError):
                try:
                    connection.execute(
                        "DELETE FROM occurrence_cache WHERE cache_key = ?", (cache_key,)
                    )
                    connection.commit()
                except sqlite3.Error as exc:
                    connection.rollback()
                    self._last_error = f"{type(exc).__name__}: {exc}"
                self._invalid_rows += 1
                self._misses += 1
                return False, None, 0.0
            try:
                connection.execute(
                    "UPDATE occurrence_cache SET last_accessed = ? WHERE cache_key = ?",
                    (now, cache_key),
                )
                connection.commit()
            except sqlite3.Error as exc:
                connection.rollback()
                self._last_error = f"{type(exc).__name__}: {exc}"
            self._hits += 1
            remaining = min(float(expires_at), float(created_at) + ttl_seconds) - now
            return True, payload, max(0.0, remaining)

    def put(self, cache_key: str, payload: dict[str, int] | None, *, ttl_seconds: int) -> None:
        now = time.time()
        payload_json = (
            json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
            if payload is not None
            else None
        )
        with self._lock:
            connection = self._require_connection()
            try:
                connection.execute(
                    """
                    INSERT INTO occurrence_cache (
                        cache_key, payload_json, created_at, expires_at, last_accessed
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(cache_key) DO UPDATE SET
                        payload_json = excluded.payload_json,
                        created_at = excluded.created_at,
                        expires_at = excluded.expires_at,
                        last_accessed = excluded.last_accessed
                    """,
                    (cache_key, payload_json, now, now + ttl_seconds, now),
                )
                connection.execute("DELETE FROM occurrence_cache WHERE expires_at <= ?", (now,))
                count = int(
                    connection.execute("SELECT COUNT(*) FROM occurrence_cache").fetchone()[0]
                )
                excess = max(0, count - self.max_entries)
                if excess:
                    connection.execute(
                        "DELETE FROM occurrence_cache WHERE cache_key IN ("
                        "SELECT cache_key FROM occurrence_cache ORDER BY last_accessed ASC LIMIT ?)",
                        (excess,),
                    )
                connection.commit()
            except sqlite3.Error:
                connection.rollback()
                raise
            self._evictions += excess
            self._writes += 1

    def metadata(self) -> dict[str, Any]:
        with self._lock:
            connection = self._require_connection()
            now = time.time()
            entries = int(
                connection.execute(
                    "SELECT COUNT(*) FROM occurrence_cache WHERE expires_at > ?", (now,)
                ).fetchone()[0]
            )
            files = (self.path, Path(f"{self.path}-wal"), Path(f"{self.path}-shm"))
            return {
                "backend": "sqlite",
                "persistent": True,
                "path": str(self.path),
                "schema_version": self.SCHEMA_VERSION,
                "max_entries": self.max_entries,
                "entries": entries,
                "bytes": sum(path.stat().st_size for path in files if path.exists()),
                "hits": self._hits,
                "misses": self._misses,
                "writes": self._writes,
                "evictions": self._evictions,
                "invalid_rows": self._invalid_rows,
                "last_error": self._last_error,
            }

    def merge_from(self, source_path: Path) -> int:
        source = source_path.expanduser().resolve()
        if source == self.path:
            return 0
        source_connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=0.25)
        try:
            version = int(source_connection.execute("PRAGMA user_version").fetchone()[0])
            if version != self.SCHEMA_VERSION:
                raise ValueError(f"unsupported source occurrence cache schema {version}")
            now = time.time()
            rows = source_connection.execute(
                "SELECT cache_key, payload_json, created_at, expires_at, last_accessed "
                "FROM occurrence_cache WHERE expires_at > ?",
                (now,),
            ).fetchall()
        finally:
            source_connection.close()
        if not rows:
            return 0
        with self._lock:
            connection = self._require_connection()
            try:
                connection.execute("DELETE FROM occurrence_cache WHERE expires_at <= ?", (now,))
                connection.executemany(
                    """
                    INSERT INTO occurrence_cache (
                        cache_key, payload_json, created_at, expires_at, last_accessed
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(cache_key) DO UPDATE SET
                        payload_json = excluded.payload_json,
                        created_at = excluded.created_at,
                        expires_at = excluded.expires_at,
                        last_accessed = excluded.last_accessed
                    WHERE excluded.created_at >= occurrence_cache.created_at
                    """,
                    rows,
                )
                count = int(
                    connection.execute("SELECT COUNT(*) FROM occurrence_cache").fetchone()[0]
                )
                excess = max(0, count - self.max_entries)
                if excess:
                    connection.execute(
                        "DELETE FROM occurrence_cache WHERE cache_key IN ("
                        "SELECT cache_key FROM occurrence_cache ORDER BY last_accessed ASC LIMIT ?)",
                        (excess,),
                    )
                connection.commit()
            except sqlite3.Error:
                connection.rollback()
                raise
            self._evictions += excess
        return len(rows)

    def snapshot(self, destination: Path) -> Path:
        destination = destination.expanduser().resolve()
        if destination == self.path:
            raise ValueError("occurrence cache snapshot must not replace its source")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{time.time_ns()}.tmp")
        with self._lock:
            connection = self._require_connection()
            snapshot = sqlite3.connect(temporary)
            try:
                connection.backup(snapshot)
                snapshot.commit()
            except Exception:
                temporary.unlink(missing_ok=True)
                raise
            finally:
                snapshot.close()
        temporary.replace(destination)
        return destination

    def record_error(self, error: Exception) -> None:
        with self._lock:
            self._last_error = f"{type(error).__name__}: {error}"

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                try:
                    self._connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                except sqlite3.Error as exc:
                    self._last_error = f"{type(exc).__name__}: {exc}"
                finally:
                    self._connection.close()
                    self._connection = None

    def _require_connection(self) -> sqlite3.Connection:
        if self._connection is None:
            raise RuntimeError("occurrence cache is closed")
        return self._connection


class DynamicOccurrenceResolver:
    """Look up birds around arbitrary coordinates through GBIF and cache the result."""

    def __init__(
        self,
        *,
        api_url: str = "https://api.gbif.org/v1",
        radius_km: float = 100.0,
        facet_limit: int = 300,
        cache_ttl_seconds: int = 2_592_000,
        cache_path: Path | None = None,
        cache_max_entries: int = 2048,
        allowed_names: set[str] | frozenset[str] | None = None,
        request_timeout_seconds: float = 8.0,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.radius_km = radius_km
        self.facet_limit = facet_limit
        self.cache_ttl_seconds = cache_ttl_seconds
        self.request_timeout_seconds = request_timeout_seconds
        self.allowed_names = frozenset(allowed_names) if allowed_names is not None else None
        self._allowed_names_by_genus: dict[str, tuple[str, ...]] = {}
        if self.allowed_names is not None:
            names_by_genus: dict[str, list[str]] = {}
            for name in self.allowed_names:
                parts = name.split()
                names_by_genus.setdefault(parts[0].casefold(), []).append(name)
            self._allowed_names_by_genus = {
                genus: tuple(sorted(names, key=len, reverse=True))
                for genus, names in names_by_genus.items()
            }
        self._allowed_names_sha256 = (
            hashlib.sha256("\n".join(sorted(self.allowed_names)).encode()).hexdigest()
            if self.allowed_names is not None
            else None
        )
        self._cache_store = (
            OccurrenceCacheStore(cache_path, max_entries=cache_max_entries)
            if cache_path is not None
            else None
        )
        self._cache: dict[
            str, tuple[float, OccurrenceSelection | OccurrenceLookupError | None]
        ] = {}
        self._pending: dict[str, Future[OccurrenceSelection | None]] = {}
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
        query_months = self._query_months(observed_at.month, window_months)
        latitude, longitude = self._cache_coordinates(latitude, longitude)
        cache_key = self._cache_key(latitude, longitude, query_months)
        with self._lock:
            if self._closed.is_set():
                raise OccurrenceLookupError("GBIF resolver is closed")
            cached = self._cache.get(cache_key)
            if cached is not None and time.monotonic() < cached[0]:
                if isinstance(cached[1], OccurrenceLookupError):
                    raise OccurrenceLookupError(str(cached[1]))
                return cached[1]
            persisted = self._persistent_result(
                cache_key,
                latitude=latitude,
                longitude=longitude,
                observed_at=observed_at,
                window_months=window_months,
            )
            if persisted[0]:
                return persisted[1]
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
        latitude, longitude = self._cache_coordinates(latitude, longitude)
        cache_key = self._cache_key(latitude, longitude, query_months)
        with self._lock:
            if self._closed.is_set():
                raise OccurrenceLookupError("GBIF resolver is closed")
            cached = self._cache.get(cache_key)
            if cached is not None and time.monotonic() < cached[0]:
                if isinstance(cached[1], OccurrenceLookupError):
                    raise OccurrenceLookupError(str(cached[1]))
                return cached[1]
            persisted = self._persistent_result(
                cache_key,
                latitude=latitude,
                longitude=longitude,
                observed_at=observed_at,
                window_months=window_months,
            )
            if persisted[0]:
                return persisted[1]

        try:
            occurrence_counts: dict[str, int] = {}
            for month in query_months:
                for scientific_name, count in self._facet(latitude, longitude, month).items():
                    name = self._catalog_name(scientific_name)
                    if name is not None:
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
    ) -> str:
        payload = json.dumps(
            {
                "version": 6,
                "latitude": latitude,
                "longitude": longitude,
                "months": query_months,
                "radius_km": self.radius_km,
                "api_url": self.api_url,
                "taxon_key": 212,
                "facet": "scientificName",
                "allowed_names_sha256": self._allowed_names_sha256,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode()).hexdigest()

    def _cache_coordinates(self, latitude: float, longitude: float) -> tuple[float, float]:
        target_degrees = min(0.1, self.radius_km / 1110.0)
        precision = max(0, min(3, round(-math.log10(target_degrees))))
        return round(latitude, precision), round(longitude, precision)

    def _persistent_result(
        self,
        cache_key: str,
        *,
        latitude: float,
        longitude: float,
        observed_at: datetime,
        window_months: int | None,
    ) -> tuple[bool, OccurrenceSelection | None]:
        if self._cache_store is None:
            return False, None
        try:
            found, counts, remaining = self._cache_store.get_entry(
                cache_key, ttl_seconds=self.cache_ttl_seconds
            )
        except (OSError, RuntimeError, sqlite3.Error) as exc:
            raise OccurrenceLookupError(f"persistent occurrence cache read failed: {exc}") from exc
        if not found:
            return False, None
        selection = self._selection_from_counts(
            latitude=latitude,
            longitude=longitude,
            observed_at=observed_at,
            window_months=window_months,
            occurrence_counts=counts,
        )
        self._remember(cache_key, time.monotonic() + remaining, selection)
        return True, selection

    def _remember(
        self,
        cache_key: str,
        expires_monotonic: float,
        result: OccurrenceSelection | OccurrenceLookupError | None,
    ) -> None:
        self._cache.pop(cache_key, None)
        self._cache[cache_key] = (expires_monotonic, result)
        if len(self._cache) > 256:
            self._cache.pop(next(iter(self._cache)))

    def _selection_from_counts(
        self,
        *,
        latitude: float,
        longitude: float,
        observed_at: datetime,
        window_months: int | None,
        occurrence_counts: dict[str, int] | None,
    ) -> OccurrenceSelection | None:
        if not occurrence_counts:
            return None
        site = OccurrenceSite(
            site_id=self._site_id(latitude, longitude),
            name=f"GBIF cached radius {self.radius_km:g} km",
            latitude=latitude,
            longitude=longitude,
            radius_km=self.radius_km,
            country_code=None,
            monthly_counts={1: occurrence_counts},
        )
        return OccurrenceSelection(
            site=site,
            distance_km=0.0,
            observation_month=observed_at.month if window_months is not None else None,
            occurrence_counts=occurrence_counts,
            dataset_version="gbif-live",
        )

    def _store_cache(
        self, cache_key: str, result: OccurrenceSelection | OccurrenceLookupError | None
    ) -> None:
        with self._lock:
            if self._closed.is_set():
                return
            ttl = (
                min(30, self.cache_ttl_seconds)
                if isinstance(result, OccurrenceLookupError)
                else self.cache_ttl_seconds
            )
            self._remember(cache_key, time.monotonic() + ttl, result)
            if self._cache_store is not None and not isinstance(result, OccurrenceLookupError):
                try:
                    self._cache_store.put(
                        cache_key,
                        result.occurrence_counts if result is not None else None,
                        ttl_seconds=self.cache_ttl_seconds,
                    )
                except (OSError, RuntimeError, sqlite3.Error) as exc:
                    self._cache_store.record_error(exc)

    def close(self) -> None:
        with self._lock:
            self._closed.set()
            self._cache.clear()
            if self._cache_store is not None:
                self._cache_store.close()
        self._executor.shutdown(wait=False, cancel_futures=True)

    def metadata(self) -> dict[str, Any]:
        with self._lock:
            persistent_cache = (
                self._cache_store.metadata()
                if self._cache_store is not None and not self._closed.is_set()
                else {"backend": "memory", "persistent": False}
            )
            return {
                "enabled": True,
                "api_url": self.api_url,
                "radius_km": self.radius_km,
                "facet_limit": self.facet_limit,
                "cache_ttl_seconds": self.cache_ttl_seconds,
                "cached_coordinate_queries": len(self._cache),
                "pending_coordinate_queries": len(self._pending),
                "coordinate_cache": persistent_cache,
            }

    def persistent_result_available(
        self,
        *,
        latitude: float,
        longitude: float,
        observed_at: datetime,
        window_months: int | None,
    ) -> bool:
        if self._cache_store is None or not _valid_coordinate(latitude, longitude):
            return False
        latitude, longitude = self._cache_coordinates(latitude, longitude)
        cache_key = self._cache_key(
            latitude,
            longitude,
            self._query_months(observed_at.month, window_months),
        )
        found, _, _ = self._cache_store.get_entry(
            cache_key, ttl_seconds=self.cache_ttl_seconds
        )
        return found

    def _query_months(self, month: int, window_months: int | None) -> tuple[int | None, ...]:
        if window_months is None:
            return (None,)
        return tuple(((month - 1 + delta) % 12) + 1 for delta in range(-window_months, window_months + 1))

    def _facet(self, latitude: float, longitude: float, month: int | None) -> dict[str, int]:
        merged: dict[str, int] = {}
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
                "facet": "scientificName",
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
                name = str(item.get("name", "")).strip()
                count = int(item.get("count", 0))
                if count > 0 and not name:
                    raise ValueError("GBIF scientific name facet contains an empty name")
                if name and count > 0:
                    merged[name] = merged.get(name, 0) + count
            if len(counts) < self.facet_limit:
                return merged
            offset += len(counts)

    def _catalog_name(self, scientific_name: str) -> str | None:
        normalized = " ".join(scientific_name.split())
        if self.allowed_names is None:
            parts = normalized.split()
            return " ".join(parts[:2]) if len(parts) >= 2 else None
        genus = normalized.split(maxsplit=1)[0].casefold()
        folded = normalized.casefold()
        for candidate in self._allowed_names_by_genus.get(genus, ()):
            candidate_folded = candidate.casefold()
            if folded == candidate_folded or folded.startswith(f"{candidate_folded} "):
                return candidate
        return None

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
