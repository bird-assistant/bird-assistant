from __future__ import annotations

import csv
import hashlib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Taxon:
    species_id: str
    scientific_name: str
    common_name_zh: str | None
    common_name_en: str | None
    order: str | None
    family: str | None
    ebird_code: str | None = None
    avibase_id: str | None = None
    region_codes: frozenset[str] = frozenset()
    extinction_status: str | None = None
    iucn_status: str | None = None
    taxon_source: str | None = None
    taxon_version: str | None = None
    license: str | None = None
    enabled: bool = True


def optional_text(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def parse_bool(value: str | None, *, default: bool = True) -> bool:
    if value is None or not value.strip():
        return default
    normalized = value.strip().casefold()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    raise ValueError(f"invalid boolean value: {value}")


def parse_regions(value: str | None) -> frozenset[str]:
    return frozenset(part.strip().upper() for part in (value or "").split(";") if part.strip())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_catalog(path: Path) -> list[Taxon]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"species catalog not found: {resolved}")
    with resolved.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"species_id", "scientific_name"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"species catalog missing columns: {sorted(missing)}")
        taxa: list[Taxon] = []
        ids: set[str] = set()
        scientific_names: set[str] = set()
        for line_number, row in enumerate(reader, start=2):
            species_id = (row.get("species_id") or "").strip()
            scientific_name = (row.get("scientific_name") or "").strip()
            if not species_id or not scientific_name:
                raise ValueError(f"catalog line {line_number} has an empty id or scientific name")
            if species_id in ids:
                raise ValueError(f"duplicate species_id in catalog: {species_id}")
            if scientific_name.casefold() in scientific_names:
                raise ValueError(f"duplicate scientific_name in catalog: {scientific_name}")
            ids.add(species_id)
            scientific_names.add(scientific_name.casefold())
            try:
                enabled = parse_bool(row.get("enabled"))
            except ValueError as exc:
                raise ValueError(f"catalog line {line_number}: {exc}") from exc
            taxa.append(
                Taxon(
                    species_id=species_id,
                    scientific_name=scientific_name,
                    common_name_zh=optional_text(row.get("common_name_zh")),
                    common_name_en=optional_text(row.get("common_name_en")),
                    order=optional_text(row.get("order")),
                    family=optional_text(row.get("family")),
                    ebird_code=optional_text(row.get("ebird_code")),
                    avibase_id=optional_text(row.get("avibase_id")),
                    region_codes=parse_regions(row.get("region_codes")),
                    extinction_status=optional_text(row.get("extinction_status")),
                    iucn_status=optional_text(row.get("iucn_status")),
                    taxon_source=optional_text(row.get("taxon_source")),
                    taxon_version=optional_text(row.get("taxon_version")),
                    license=optional_text(row.get("license")),
                    enabled=enabled,
                )
            )
    if not taxa:
        raise ValueError("species catalog is empty")
    return taxa
