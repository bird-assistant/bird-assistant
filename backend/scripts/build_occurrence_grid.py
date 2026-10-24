#!/usr/bin/env python3
"""Build an offline, month-aware GBIF occurrence profile from geographic cells."""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import math
import os
import tempfile
import zipfile
from collections import defaultdict
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from build_occurrence_profile import catalog_names, gbif_scientific_names, occurrence_facet


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--country-code", required=True, help="ISO 3166-1 alpha-2 code, for example CN")
    parser.add_argument("--name", required=True, help="Human-readable profile name")
    parser.add_argument("--min-latitude", required=True, type=float)
    parser.add_argument("--max-latitude", required=True, type=float)
    parser.add_argument("--min-longitude", required=True, type=float)
    parser.add_argument("--max-longitude", required=True, type=float)
    parser.add_argument(
        "--cell-size-degrees",
        type=float,
        default=1.0,
        help="Square cell size; smaller cells improve geographic precision but increase index size",
    )
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--occurrence-file",
        type=Path,
        help=(
            "local GBIF SQL TSV/ZIP download; when omitted, query the Search API "
            "for each grid cell and month"
        ),
    )
    parser.add_argument("--source-doi", help="GBIF SQL download DOI or download key")
    parser.add_argument("--source-query-file", type=Path, help="saved SQL query text used for the download")
    parser.add_argument("--source-downloaded-at", help="UTC timestamp when the source download was created")
    parser.add_argument("--workers", type=int, default=8)
    return parser.parse_args()


def rectangle_wkt(
    min_latitude: float, max_latitude: float, min_longitude: float, max_longitude: float
) -> str:
    return (
        "POLYGON(("
        f"{min_longitude:.6f} {min_latitude:.6f},"
        f"{max_longitude:.6f} {min_latitude:.6f},"
        f"{max_longitude:.6f} {max_latitude:.6f},"
        f"{min_longitude:.6f} {max_latitude:.6f},"
        f"{min_longitude:.6f} {min_latitude:.6f}"
        "))"
    )


def grid_cells(args: argparse.Namespace, country_code: str) -> list[dict[str, float | str]]:
    latitude_count = math.ceil((args.max_latitude - args.min_latitude) / args.cell_size_degrees)
    longitude_count = math.ceil((args.max_longitude - args.min_longitude) / args.cell_size_degrees)
    cells: list[dict[str, float | str]] = []
    for latitude_index in range(latitude_count):
        cell_min_latitude = args.min_latitude + latitude_index * args.cell_size_degrees
        cell_max_latitude = min(args.max_latitude, cell_min_latitude + args.cell_size_degrees)
        for longitude_index in range(longitude_count):
            cell_min_longitude = args.min_longitude + longitude_index * args.cell_size_degrees
            cell_max_longitude = min(args.max_longitude, cell_min_longitude + args.cell_size_degrees)
            cells.append(
                {
                    "site_id": f"{country_code.lower()}-grid-{latitude_index:03d}-{longitude_index:03d}",
                    "name": args.name,
                    "min_latitude": cell_min_latitude,
                    "max_latitude": cell_max_latitude,
                    "min_longitude": cell_min_longitude,
                    "max_longitude": cell_max_longitude,
                }
            )
    return cells


def build_cell(cell: dict[str, float | str], country_code: str) -> dict[str, Any]:
    min_latitude = float(cell["min_latitude"])
    max_latitude = float(cell["max_latitude"])
    min_longitude = float(cell["min_longitude"])
    max_longitude = float(cell["max_longitude"])
    geometry = rectangle_wkt(min_latitude, max_latitude, min_longitude, max_longitude)
    monthly_keys: dict[int, dict[int, int]] = {}
    source_record_counts: dict[str, int] = {}
    for month in range(1, 13):
        total, counts = occurrence_facet(geometry, month, country_code=country_code)
        source_record_counts[str(month)] = total
        monthly_keys[month] = counts

    return {
        **cell,
        "latitude": (min_latitude + max_latitude) / 2.0,
        "longitude": (min_longitude + max_longitude) / 2.0,
        "radius_km": _cell_radius_km(min_latitude, max_latitude, min_longitude, max_longitude),
        "country_code": country_code,
        "geometry_wkt": geometry,
        "source_record_counts": source_record_counts,
        "monthly_keys": monthly_keys,
    }


def _normalized_columns(fieldnames: list[str] | None) -> dict[str, str]:
    if not fieldnames:
        raise ValueError("occurrence file must contain a TSV header")
    return {name.casefold().replace("_", ""): name for name in fieldnames if name}


def _column_name(columns: dict[str, str], *names: str) -> str | None:
    for name in names:
        result = columns.get(name.casefold().replace("_", ""))
        if result is not None:
            return result
    return None


def _occurrence_reader(stream: io.TextIOBase) -> Iterator[dict[str, str]]:
    reader = csv.DictReader(stream, delimiter="\t")
    columns = _normalized_columns(reader.fieldnames)
    required = {
        "speciesKey": ("speciesKey", "species_key"),
        "decimalLatitude": ("decimalLatitude", "decimal_latitude"),
        "decimalLongitude": ("decimalLongitude", "decimal_longitude"),
        "month": ("month",),
        "countryCode": ("countryCode", "country_code"),
    }
    missing = [label for label, names in required.items() if _column_name(columns, *names) is None]
    if missing:
        raise ValueError(f"occurrence file is missing required columns: {', '.join(missing)}")
    if _column_name(columns, "scientificName", "scientific_name") is None and _column_name(
        columns, "acceptedScientificName", "accepted_scientific_name"
    ) is None:
        raise ValueError("occurrence file must contain scientificName or acceptedScientificName")
    yield from reader


def occurrence_rows(path: Path) -> Iterator[dict[str, str]]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"occurrence file not found: {resolved}")
    if resolved.suffix.casefold() == ".zip":
        with zipfile.ZipFile(resolved) as archive:
            members = [
                info
                for info in archive.infolist()
                if not info.is_dir() and Path(info.filename).suffix.casefold() in {".tsv", ".txt"}
            ]
            if len(members) != 1:
                raise ValueError("occurrence ZIP must contain exactly one TSV or TXT member")
            with archive.open(members[0]) as binary_stream, io.TextIOWrapper(
                binary_stream, encoding="utf-8-sig", newline=""
            ) as text_stream:
                yield from _occurrence_reader(text_stream)
        return
    with resolved.open("r", encoding="utf-8-sig", newline="") as stream:
        yield from _occurrence_reader(stream)


def _text_value(row: dict[str, str], columns: dict[str, str], *names: str) -> str:
    column = _column_name(columns, *names)
    return row.get(column, "").strip() if column is not None else ""


def _grid_cell_index(
    latitude: float, longitude: float, args: argparse.Namespace, latitude_count: int, longitude_count: int
) -> tuple[int, int] | None:
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        return None
    if not args.min_latitude <= latitude <= args.max_latitude:
        return None
    if not args.min_longitude <= longitude <= args.max_longitude:
        return None
    latitude_index = min(
        int((latitude - args.min_latitude) / args.cell_size_degrees), latitude_count - 1
    )
    longitude_index = min(
        int((longitude - args.min_longitude) / args.cell_size_degrees), longitude_count - 1
    )
    return latitude_index, longitude_index


def aggregate_occurrence_file(
    path: Path,
    args: argparse.Namespace,
    country_code: str,
    cells: list[dict[str, float | str]],
) -> tuple[list[dict[str, Any]], dict[int, tuple[str, ...]]]:
    latitude_count = math.ceil((args.max_latitude - args.min_latitude) / args.cell_size_degrees)
    longitude_count = math.ceil((args.max_longitude - args.min_longitude) / args.cell_size_degrees)
    monthly_keys: dict[tuple[int, int], dict[int, dict[int, int]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    source_record_counts: dict[tuple[int, int], dict[int, int]] = defaultdict(lambda: defaultdict(int))
    local_names: dict[int, list[str]] = defaultdict(list)
    rows = occurrence_rows(path)
    first_row = next(rows, None)
    if first_row is None:
        raise ValueError("occurrence file contains no records")

    # Re-read the header through a tiny wrapper is not possible after DictReader
    # consumed it, so infer all optional columns from the first row keys and use
    # the same normalized lookup for every record.
    columns = _normalized_columns(list(first_row))

    def consume(row: dict[str, str]) -> None:
        species_key_text = _text_value(row, columns, "speciesKey", "species_key")
        latitude_text = _text_value(row, columns, "decimalLatitude", "decimal_latitude")
        longitude_text = _text_value(row, columns, "decimalLongitude", "decimal_longitude")
        month_text = _text_value(row, columns, "month")
        if not species_key_text or not latitude_text or not longitude_text or not month_text:
            raise ValueError("occurrence rows require speciesKey, coordinates, and month")
        try:
            species_key = int(species_key_text)
            latitude = float(latitude_text)
            longitude = float(longitude_text)
            month = int(month_text)
        except ValueError as exc:
            raise ValueError("occurrence rows contain an invalid species key, coordinate, or month") from exc
        if species_key < 1 or not 1 <= month <= 12:
            raise ValueError("occurrence speciesKey and month are invalid")
        cell_index = _grid_cell_index(latitude, longitude, args, latitude_count, longitude_count)
        if cell_index is None:
            return
        row_country = _text_value(row, columns, "countryCode", "country_code")
        if row_country.upper() != country_code:
            return
        names = (
            _text_value(row, columns, "acceptedScientificName", "accepted_scientific_name"),
            _text_value(row, columns, "scientificName", "scientific_name"),
        )
        if not any(names):
            raise ValueError(f"occurrence row for speciesKey {species_key} has no scientific name")
        monthly_keys[cell_index].setdefault(month, {})[species_key] = (
            monthly_keys[cell_index][month].get(species_key, 0) + 1
        )
        source_record_counts[cell_index][month] += 1
        for name in names:
            if name and name not in local_names[species_key]:
                local_names[species_key].append(name)

    consume(first_row)
    for row in rows:
        consume(row)

    built_cells: list[dict[str, Any]] = []
    for latitude_index in range(latitude_count):
        for longitude_index in range(longitude_count):
            cell = cells[latitude_index * longitude_count + longitude_index]
            key_counts = monthly_keys.get((latitude_index, longitude_index), {})
            built_cells.append(
                {
                    **cell,
                    "latitude": (float(cell["min_latitude"]) + float(cell["max_latitude"])) / 2.0,
                    "longitude": (float(cell["min_longitude"]) + float(cell["max_longitude"])) / 2.0,
                    "radius_km": _cell_radius_km(
                        float(cell["min_latitude"]),
                        float(cell["max_latitude"]),
                        float(cell["min_longitude"]),
                        float(cell["max_longitude"]),
                    ),
                    "country_code": country_code,
                    "geometry_wkt": rectangle_wkt(
                        float(cell["min_latitude"]),
                        float(cell["max_latitude"]),
                        float(cell["min_longitude"]),
                        float(cell["max_longitude"]),
                    ),
                    "source_record_counts": {
                        str(month): source_record_counts[(latitude_index, longitude_index)].get(month, 0)
                        for month in range(1, 13)
                    },
                    "monthly_keys": {
                        month: dict(sorted(counts.items())) for month, counts in key_counts.items()
                    },
                }
            )
    return built_cells, {key: tuple(names) for key, names in local_names.items()}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.expanduser().resolve().open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(args: argparse.Namespace) -> dict[str, Any]:
    country_code = args.country_code.strip().upper()
    if len(country_code) != 2 or not country_code.isascii() or not country_code.isalpha():
        raise ValueError("country-code must be an ISO 3166-1 alpha-2 code")
    if not -90 <= args.min_latitude < args.max_latitude <= 90:
        raise ValueError("latitude bounds are invalid")
    if not -180 <= args.min_longitude < args.max_longitude <= 180:
        raise ValueError("longitude bounds are invalid")
    if not 0.1 <= args.cell_size_degrees <= 10:
        raise ValueError("cell-size-degrees must be between 0.1 and 10")
    if not 1 <= args.workers <= 32:
        raise ValueError("workers must be between 1 and 32")

    allowed_names = catalog_names(args.catalog)
    cells = grid_cells(args, country_code)
    if args.occurrence_file is None:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            built_cells = list(executor.map(lambda cell: build_cell(cell, country_code), cells))
        local_names: dict[int, tuple[str, ...]] = {}
        source = "GBIF occurrence search API"
        source_url = "https://api.gbif.org/v1/occurrence/search"
        source_metadata: dict[str, Any] = {}
    else:
        built_cells, local_names = aggregate_occurrence_file(
            args.occurrence_file, args, country_code, cells
        )
        source = "GBIF SQL occurrence download"
        source_url = "https://techdocs.gbif.org/en/data-use/api-sql-downloads"
        source_metadata = {
            "occurrence_file": str(args.occurrence_file.expanduser().resolve()),
            "occurrence_file_sha256": _sha256(args.occurrence_file),
        }
        source_doi = getattr(args, "source_doi", None)
        query_file = getattr(args, "source_query_file", None)
        downloaded_at = getattr(args, "source_downloaded_at", None)
        if source_doi:
            source_metadata["source_doi"] = source_doi
        if query_file is not None:
            source_metadata["source_query_file"] = str(query_file.expanduser().resolve())
            source_metadata["source_query_sha256"] = _sha256(query_file)
        if downloaded_at:
            source_metadata["source_downloaded_at"] = downloaded_at

    all_keys = sorted(
        {
            key
            for cell in built_cells
            for month_counts in cell["monthly_keys"].values()
            for key in month_counts
        }
    )
    names = dict(local_names)
    unresolved_keys = [key for key in all_keys if key not in names]
    if unresolved_keys and args.occurrence_file is not None:
        raise ValueError(
            "local occurrence file has no scientific name for species keys: "
            + ", ".join(str(key) for key in unresolved_keys[:10])
        )
    if unresolved_keys and args.occurrence_file is None:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            names.update(executor.map(gbif_scientific_names, unresolved_keys))
    matched_keys = {
        key: next(name for name in candidates if name in allowed_names)
        for key, candidates in names.items()
        if any(name in allowed_names for name in candidates)
    }

    sites: list[dict[str, Any]] = []
    for cell in built_cells:
        months: dict[str, dict[str, int]] = {}
        for month, key_counts in cell["monthly_keys"].items():
            resolved: dict[str, int] = {}
            for key, count in key_counts.items():
                name = matched_keys.get(key)
                if name is not None:
                    resolved[name] = resolved.get(name, 0) + count
            months[str(month)] = dict(sorted(resolved.items()))
        if any(months.values()):
            site = {key: value for key, value in cell.items() if key != "monthly_keys"}
            site["bounds"] = {
                "min_latitude": cell["min_latitude"],
                "max_latitude": cell["max_latitude"],
                "min_longitude": cell["min_longitude"],
                "max_longitude": cell["max_longitude"],
            }
            site["months"] = months
            site["catalog_matched_species"] = len({name for month in months.values() for name in month})
            sites.append(site)

    generated_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    return {
        "schema_version": 1,
        "dataset": {
            "id": "gbif-occurrence-grid",
            "version": generated_at[:10],
            "generated_at": generated_at,
            "source": source,
            "source_url": source_url,
            "country_code": country_code,
            "has_coordinate": True,
            "usage": "presence-only candidate filtering; occurrence counts are not model score bonuses",
            "catalog": str(args.catalog),
            **source_metadata,
            "grid": {
                "min_latitude": args.min_latitude,
                "max_latitude": args.max_latitude,
                "min_longitude": args.min_longitude,
                "max_longitude": args.max_longitude,
                "cell_size_degrees": args.cell_size_degrees,
            },
        },
        "sites": sites,
    }


def _cell_radius_km(
    min_latitude: float, max_latitude: float, min_longitude: float, max_longitude: float
) -> float:
    latitude_delta = math.radians(max_latitude - min_latitude)
    longitude_delta = math.radians(max_longitude - min_longitude)
    mean_latitude = math.radians((min_latitude + max_latitude) / 2.0)
    north_south_km = 6371.0088 * latitude_delta
    east_west_km = 6371.0088 * math.cos(mean_latitude) * longitude_delta
    return math.hypot(north_south_km, east_west_km) / 2.0


def main() -> int:
    args = parse_args()
    payload = build(args)
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=output.parent, suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(f"wrote {output} sites={len(payload['sites'])}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
