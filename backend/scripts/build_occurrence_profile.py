#!/usr/bin/env python3
"""Build an offline, month-aware site profile from GBIF occurrence facets."""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import json
import math
import os
import random
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

GBIF_API = "https://api.gbif.org/v1"
AVES_KEY = 212


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--country-code", required=True)
    parser.add_argument("--latitude", required=True, type=float)
    parser.add_argument("--longitude", required=True, type=float)
    parser.add_argument("--radius-km", type=float, default=100.0)
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=8)
    return parser.parse_args()


def request_json(url: str, attempts: int = 5) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "bird-assistant-occurrence-builder/1"},
    )
    error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise ValueError(f"unexpected JSON response from {url}")
            return payload
        except (OSError, ValueError, urllib.error.HTTPError) as exc:
            if isinstance(exc, urllib.error.HTTPError):
                try:
                    detail = exc.read().decode("utf-8", errors="replace")[:1000]
                except OSError:
                    detail = ""
                error = RuntimeError(f"{exc}; response={detail}")
            else:
                error = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code < 500 and exc.code != 429:
                break
            if attempt + 1 < attempts:
                time.sleep((2**attempt) + random.random())
    raise RuntimeError(f"GBIF request failed after {attempts} attempts: {url}: {error}")


def destination(latitude: float, longitude: float, radius_km: float, bearing: float) -> tuple[float, float]:
    angular_distance = radius_km / 6371.0088
    latitude_radians = math.radians(latitude)
    longitude_radians = math.radians(longitude)
    bearing_radians = math.radians(bearing)
    target_latitude = math.asin(
        math.sin(latitude_radians) * math.cos(angular_distance)
        + math.cos(latitude_radians) * math.sin(angular_distance) * math.cos(bearing_radians)
    )
    target_longitude = longitude_radians + math.atan2(
        math.sin(bearing_radians) * math.sin(angular_distance) * math.cos(latitude_radians),
        math.cos(angular_distance) - math.sin(latitude_radians) * math.sin(target_latitude),
    )
    normalized_longitude = (math.degrees(target_longitude) + 540.0) % 360.0 - 180.0
    return math.degrees(target_latitude), normalized_longitude


def circle_wkt(latitude: float, longitude: float, radius_km: float, points: int = 48) -> str:
    coordinates = [
        # GBIF/JTS requires the exterior ring to be counter-clockwise.
        destination(latitude, longitude, radius_km, -360.0 * index / points)
        for index in range(points)
    ]
    coordinates.append(coordinates[0])
    body = ",".join(
        f"{point_longitude:.6f} {point_latitude:.6f}"
        for point_latitude, point_longitude in coordinates
    )
    return f"POLYGON(({body}))"


def occurrence_facet(
    geometry: str, month: int, *, country_code: str | None = None
) -> tuple[int, dict[int, int]]:
    facet_limit = 1000
    base_params = {
        "taxon_key": AVES_KEY,
        "has_coordinate": "true",
        "occurrence_status": "PRESENT",
        "geometry": geometry,
        "month": month,
        "limit": 0,
        # speciesKey keeps the index at terminal species rather than mixing in
        # higher taxa and interpreted synonyms from the taxonKey facet.
        "facet": "speciesKey",
        "facetLimit": facet_limit,
    }
    if country_code is not None:
        base_params["country"] = country_code

    total: int | None = None
    merged_counts: dict[int, int] = {}
    offset = 0
    seen_pages: set[tuple[tuple[str, str], ...]] = set()
    while True:
        params = {**base_params, "facetOffset": offset}
        query = urllib.parse.urlencode(params)
        payload = request_json(f"{GBIF_API}/occurrence/search?{query}")
        if total is None:
            total = int(payload.get("count", 0))
        facets = payload.get("facets") or []
        counts = facets[0].get("counts", []) if facets else []
        page_signature = tuple(
            (str(item.get("name", "")), str(item.get("count", ""))) for item in counts
        )
        if page_signature in seen_pages:
            raise RuntimeError("GBIF species facet pagination returned a repeated page")
        seen_pages.add(page_signature)
        for item in counts:
            name = str(item.get("name", ""))
            count = int(item.get("count", 0))
            if name.isdigit() and count > 0:
                species_key = int(name)
                merged_counts[species_key] = merged_counts.get(species_key, 0) + count
        if len(counts) < facet_limit:
            break
        offset += len(counts)
    return total or 0, merged_counts


def gbif_scientific_names(species_key: int) -> tuple[int, tuple[str, ...]]:
    payload = request_json(f"{GBIF_API}/species/{species_key}")
    names: list[str] = []
    for value in (payload.get("canonicalName"), payload.get("species")):
        if isinstance(value, str) and value.strip() and value.strip() not in names:
            names.append(value.strip())
    return species_key, tuple(names)


def catalog_names(path: Path) -> set[str]:
    with path.expanduser().resolve().open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        return {
            row["scientific_name"].strip()
            for row in reader
            if row.get("scientific_name", "").strip()
            and row.get("enabled", "true").strip().casefold() not in {"false", "no", "0"}
        }


def build(args: argparse.Namespace) -> dict[str, Any]:
    if not -90 <= args.latitude <= 90 or not -180 <= args.longitude <= 180:
        raise ValueError("invalid site coordinates")
    if not 1 <= args.radius_km <= 1000:
        raise ValueError("radius-km must be between 1 and 1000")
    if not 1 <= args.workers <= 32:
        raise ValueError("workers must be between 1 and 32")
    country_code = args.country_code.strip().upper()
    if len(country_code) != 2 or not country_code.isascii() or not country_code.isalpha():
        raise ValueError("country-code must be an ISO 3166-1 alpha-2 code")

    geometry = circle_wkt(args.latitude, args.longitude, args.radius_km)
    monthly_keys: dict[int, dict[int, int]] = {}
    monthly_totals: dict[int, int] = {}
    for month in range(1, 13):
        total, counts = occurrence_facet(geometry, month)
        monthly_totals[month] = total
        monthly_keys[month] = counts
        print(f"month={month:02d} records={total} species_keys={len(counts)}", flush=True)

    all_keys = sorted({key for counts in monthly_keys.values() for key in counts})
    allowed_names = catalog_names(args.catalog)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        names = dict(executor.map(gbif_scientific_names, all_keys))
    matched_keys = {
        key: next(name for name in candidates if name in allowed_names)
        for key, candidates in names.items()
        if any(name in allowed_names for name in candidates)
    }
    months: dict[str, dict[str, int]] = {}
    for month, key_counts in monthly_keys.items():
        resolved: dict[str, int] = {}
        for key, count in key_counts.items():
            name = matched_keys.get(key)
            if name is not None:
                resolved[name] = resolved.get(name, 0) + count
        months[str(month)] = dict(sorted(resolved.items()))

    generated_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    return {
        "schema_version": 1,
        "dataset": {
            "id": "gbif-occurrence-search",
            "version": generated_at[:10],
            "generated_at": generated_at,
            "source": "GBIF occurrence search API",
            "source_url": f"{GBIF_API}/occurrence/search",
            "taxon_key": AVES_KEY,
            "occurrence_status": "PRESENT",
            "has_coordinate": True,
            "usage": "presence-only candidate filtering; occurrence counts are not model score bonuses",
            "catalog": str(args.catalog),
        },
        "sites": [
            {
                "site_id": args.site_id,
                "name": args.name,
                "latitude": args.latitude,
                "longitude": args.longitude,
                "radius_km": args.radius_km,
                "country_code": country_code,
                "geometry_wkt": geometry,
                "source_record_counts": {str(month): monthly_totals[month] for month in range(1, 13)},
                "source_species_keys": len(all_keys),
                "catalog_matched_species": len(set(matched_keys.values())),
                "catalog_unmatched_species_keys": len(all_keys) - len(matched_keys),
                "months": months,
            }
        ],
    }


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
    print(f"wrote {output}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
