"""SQLite persistence for observation records.

The audio and photo analyses are stateless; a record only exists after the user
confirms one candidate. Storage is deliberately tiny and dependency-free so the
service can be deployed as a single process next to the gateway.
"""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from bird_business.config import BusinessSettings
from bird_common.errors import ServiceError

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    observation_id TEXT PRIMARY KEY,
    owner_subject TEXT NOT NULL,
    created_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('audio', 'photo')),
    source_analysis_id TEXT NOT NULL,
    species_id TEXT NOT NULL,
    scientific_name TEXT NOT NULL,
    common_name_zh TEXT,
    common_name_en TEXT,
    score REAL,
    score_type TEXT,
    latitude REAL,
    longitude REAL,
    region_code TEXT,
    note TEXT,
    client_reference TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS observations_unique_source
    ON observations (owner_subject, source_analysis_id, species_id);
CREATE INDEX IF NOT EXISTS observations_owner_created
    ON observations (owner_subject, created_at DESC);
"""

Source = Literal["audio", "photo"]


@dataclass(frozen=True, slots=True)
class Observation:
    observation_id: str
    created_at: datetime
    observed_at: datetime
    source: Source
    source_analysis_id: str
    species_id: str
    scientific_name: str
    common_name_zh: str | None
    common_name_en: str | None
    score: float | None
    score_type: str | None
    latitude: float | None
    longitude: float | None
    region_code: str | None
    note: str | None
    client_reference: str | None


class ObservationStore:
    def __init__(self, settings: BusinessSettings) -> None:
        self.settings = settings
        self.path = settings.database_path.expanduser()
        self._lock = threading.Lock()
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(self.path), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.executescript(SCHEMA)
            self._connection.commit()
        self.ready = True

    def close(self) -> None:
        with self._lock:
            self._connection.close()
        self.ready = False

    def count(self, owner_subject: str | None = None) -> int:
        query = "SELECT COUNT(*) AS total FROM observations"
        params: tuple[object, ...] = ()
        if owner_subject is not None:
            query += " WHERE owner_subject = ?"
            params = (owner_subject,)
        with self._lock:
            row = self._connection.execute(query, params).fetchone()
        return int(row["total"])

    def create(
        self,
        *,
        owner_subject: str,
        observation_id: str,
        observed_at: datetime,
        source: Source,
        source_analysis_id: str,
        species_id: str,
        scientific_name: str,
        common_name_zh: str | None,
        common_name_en: str | None,
        score: float | None,
        score_type: str | None,
        latitude: float | None,
        longitude: float | None,
        region_code: str | None,
        note: str | None,
        client_reference: str | None,
    ) -> tuple[Observation, bool]:
        """Insert once per analysis+species; a retry returns the stored record."""
        created_at = datetime.now(UTC)
        with self._lock:
            existing = self._connection.execute(
                "SELECT * FROM observations WHERE owner_subject = ? AND source_analysis_id = ? "
                "AND species_id = ?",
                (owner_subject, source_analysis_id, species_id),
            ).fetchone()
            if existing is not None:
                return _row_to_observation(existing), False
            try:
                self._connection.execute(
                    "INSERT INTO observations (observation_id, owner_subject, created_at, observed_at,"
                    " source, source_analysis_id, species_id, scientific_name, common_name_zh,"
                    " common_name_en, score, score_type, latitude, longitude, region_code, note,"
                    " client_reference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        observation_id,
                        owner_subject,
                        created_at.isoformat(),
                        observed_at.isoformat(),
                        source,
                        source_analysis_id,
                        species_id,
                        scientific_name,
                        common_name_zh,
                        common_name_en,
                        score,
                        score_type,
                        latitude,
                        longitude,
                        region_code,
                        note,
                        client_reference,
                    ),
                )
                self._connection.commit()
            except sqlite3.IntegrityError as exc:  # pragma: no cover - guarded by the lookup above
                self._connection.rollback()
                raise ServiceError("OBSERVATION_CONFLICT", "observation could not be stored", 409) from exc
            row = self._connection.execute(
                "SELECT * FROM observations WHERE observation_id = ?", (observation_id,)
            ).fetchone()
        return _row_to_observation(row), True

    def get(self, observation_id: str, owner_subject: str) -> Observation:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM observations WHERE observation_id = ? AND owner_subject = ?",
                (observation_id, owner_subject),
            ).fetchone()
        if row is None:
            raise ServiceError(
                "OBSERVATION_NOT_FOUND",
                "observation does not exist",
                404,
                {"observation_id": observation_id},
            )
        return _row_to_observation(row)

    def list(
        self,
        *,
        owner_subject: str,
        limit: int,
        offset: int,
        source: Source | None = None,
    ) -> tuple[int, list[Observation]]:
        where = "WHERE owner_subject = ?"
        params: list[object] = [owner_subject]
        if source is not None:
            where += " AND source = ?"
            params.append(source)
        with self._lock:
            total = int(
                self._connection.execute(
                    f"SELECT COUNT(*) AS total FROM observations {where}", params
                ).fetchone()["total"]
            )
            rows = self._connection.execute(
                f"SELECT * FROM observations {where} ORDER BY created_at DESC, observation_id "
                "LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
        return total, [_row_to_observation(row) for row in rows]

    def delete(self, observation_id: str, owner_subject: str) -> None:
        with self._lock:
            cursor = self._connection.execute(
                "DELETE FROM observations WHERE observation_id = ? AND owner_subject = ?",
                (observation_id, owner_subject),
            )
            self._connection.commit()
        if cursor.rowcount == 0:
            raise ServiceError(
                "OBSERVATION_NOT_FOUND",
                "observation does not exist",
                404,
                {"observation_id": observation_id},
            )


def _row_to_observation(row: sqlite3.Row) -> Observation:
    return Observation(
        observation_id=str(row["observation_id"]),
        created_at=datetime.fromisoformat(str(row["created_at"])),
        observed_at=datetime.fromisoformat(str(row["observed_at"])),
        source=row["source"],
        source_analysis_id=str(row["source_analysis_id"]),
        species_id=str(row["species_id"]),
        scientific_name=str(row["scientific_name"]),
        common_name_zh=row["common_name_zh"],
        common_name_en=row["common_name_en"],
        score=row["score"],
        score_type=row["score_type"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        region_code=row["region_code"],
        note=row["note"],
        client_reference=row["client_reference"],
    )


def memory_store(settings: BusinessSettings | None = None) -> ObservationStore:
    resolved = settings or BusinessSettings(environment="test", database_path=Path(":memory:"))
    return ObservationStore(resolved)
