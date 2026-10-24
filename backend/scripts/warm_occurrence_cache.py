#!/usr/bin/env python3
"""Warm or merge the persistent regional GBIF occurrence cache."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from bird_vision.inference.species import load_catalog
from bird_vision.occurrence import DynamicOccurrenceResolver, OccurrenceCacheStore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path("runtime/gbif-occurrence-cache.sqlite3"),
        help="SQLite cache to create or update",
    )
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument("--merge", type=Path, help="merge another cache without querying GBIF")
    operation.add_argument("--snapshot", type=Path, help="write a consistent standalone cache snapshot")
    parser.add_argument("--catalog", type=Path, default=Path("config/catalog/avilist_v2026_global.csv"))
    parser.add_argument("--latitude", type=float)
    parser.add_argument("--longitude", type=float)
    time_range = parser.add_mutually_exclusive_group()
    time_range.add_argument("--month", type=int, choices=range(1, 13), metavar="1-12")
    time_range.add_argument("--all-year", action="store_true", help="cache the unknown-month query")
    parser.add_argument("--window-months", type=int, default=1, choices=range(0, 4))
    parser.add_argument("--radius-km", type=float, default=100.0)
    parser.add_argument("--ttl-seconds", type=int, default=2_592_000)
    parser.add_argument("--max-entries", type=int, default=2048)
    parser.add_argument("--request-timeout-seconds", type=float, default=8.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.max_entries < 16:
        raise SystemExit("--max-entries must be at least 16")
    if not 60 <= args.ttl_seconds <= 31_536_000:
        raise SystemExit("--ttl-seconds must be between 60 and 31536000")
    if args.snapshot is not None:
        store = OccurrenceCacheStore(args.cache, max_entries=args.max_entries)
        try:
            snapshot = store.snapshot(args.snapshot)
            print(json.dumps({"cache": str(store.path), "snapshot": str(snapshot)}))
        finally:
            store.close()
        return 0
    if args.merge is not None:
        store = OccurrenceCacheStore(args.cache, max_entries=args.max_entries)
        try:
            merged = store.merge_from(args.merge)
            print(json.dumps({"cache": str(store.path), "merged_entries": merged}))
        finally:
            store.close()
        return 0
    if args.latitude is None or args.longitude is None or (args.month is None and not args.all_year):
        raise SystemExit("warming requires --latitude, --longitude and --month or --all-year")
    if not -90 <= args.latitude <= 90 or not -180 <= args.longitude <= 180:
        raise SystemExit("invalid latitude or longitude")
    if not 1 <= args.radius_km <= 500:
        raise SystemExit("--radius-km must be between 1 and 500")
    taxa = load_catalog(args.catalog)
    resolver = DynamicOccurrenceResolver(
        radius_km=args.radius_km,
        cache_ttl_seconds=args.ttl_seconds,
        cache_path=args.cache,
        cache_max_entries=args.max_entries,
        allowed_names={taxon.scientific_name for taxon in taxa if taxon.enabled},
        request_timeout_seconds=args.request_timeout_seconds,
    )
    try:
        observed_at = datetime(2024, args.month or 1, 15, tzinfo=UTC)
        window_months = None if args.all_year else args.window_months
        selection = resolver.select(
            latitude=args.latitude,
            longitude=args.longitude,
            observed_at=observed_at,
            window_months=window_months,
        )
        if not resolver.persistent_result_available(
            latitude=args.latitude,
            longitude=args.longitude,
            observed_at=observed_at,
            window_months=window_months,
        ):
            error = resolver.metadata()["coordinate_cache"].get("last_error")
            raise SystemExit(f"occurrence result was not persisted: {error or 'unknown error'}")
        print(
            json.dumps(
                {
                    "cache": str(args.cache.expanduser().resolve()),
                    "latitude": args.latitude,
                    "longitude": args.longitude,
                    "month": args.month,
                    "window_months": window_months,
                    "species": len(selection.occurrence_counts) if selection else 0,
                    "cache_metadata": resolver.metadata()["coordinate_cache"],
                }
            )
        )
    finally:
        resolver.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
