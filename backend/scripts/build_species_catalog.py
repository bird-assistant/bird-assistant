#!/usr/bin/env python3
"""Build versioned runtime bird catalogs from AviList and optional eBird data."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

AVILIST_URL = "https://explore.avilist.org/data/avilist-{version}.json"
EBIRD_TAXONOMY_URL = "https://api.ebird.org/v2/ref/taxonomy/ebird?locale=zh_SIM&fmt=json&cat=species"
EBIRD_REGION_URL = "https://api.ebird.org/v2/product/spplist/{region_code}"
AVILIST_FIELDS = (
    "sequence",
    "rank",
    "order",
    "family",
    "familyEn",
    "sciName",
    "authority",
    "citation",
    "name",
    "nameClements",
    "nameBirdLife",
    "proposalNumber",
    "decisionSummary",
    "range",
    "extinct",
    "iucn",
    "birdLifeUrl",
    "cornellCode",
    "bowUrl",
    "avibaseId",
    "genusGender",
    "typeSpecies",
    "typeLocality",
    "originalDescriptionTitle",
    "originalDescriptionUrl",
    "protonym",
)
OUTPUT_FIELDS = (
    "species_id",
    "scientific_name",
    "common_name_zh",
    "common_name_en",
    "order",
    "family",
    "ebird_code",
    "avibase_id",
    "region_codes",
    "extinction_status",
    "iucn_status",
    "taxon_source",
    "taxon_version",
    "license",
    "enabled",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--taxon-version", required=True, help="declared source release, e.g. v2025 or v2026")
    parser.add_argument(
        "--avilist", help="AviList explorer JSON path or URL; defaults to the declared release"
    )
    parser.add_argument("--released", type=date.fromisoformat, help="verified release date (YYYY-MM-DD)")
    parser.add_argument("--citation", help="verified source citation; null when not supplied")
    parser.add_argument("--doi", help="verified source DOI; null when not supplied")
    parser.add_argument("--ebird-taxonomy", help="localized eBird taxonomy JSON path")
    parser.add_argument("--ebird-region", help="eBird region species-code JSON path")
    parser.add_argument("--ebird-api-key", default=os.getenv("EBIRD_API_KEY"))
    parser.add_argument("--region-code", default="CN")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="new immutable release directory; defaults to config/catalog/releases/<version>",
    )
    return parser.parse_args()


def load_json(location: str, *, api_key: str | None = None) -> Any:
    if location.startswith(("https://", "http://")):
        headers = {"User-Agent": "bird-assistant-catalog-builder/1.0"}
        if api_key:
            headers["X-eBirdApiToken"] = api_key
        request = urllib.request.Request(location, headers=headers)
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    with Path(location).expanduser().open("r", encoding="utf-8") as handle:
        return json.load(handle)


def avilist_species(raw_rows: list[list[Any]]) -> list[dict[str, Any]]:
    taxa = [dict(zip(AVILIST_FIELDS, row, strict=True)) for row in raw_rows]
    species = [taxon for taxon in taxa if taxon["rank"] == "species"]
    if not species:
        raise ValueError("AviList input contains no species rows")
    ids = [taxon["avibaseId"] for taxon in species]
    if any(not value for value in ids) or len(ids) != len(set(ids)):
        raise ValueError("AviList species must have unique Avibase IDs")
    names = [str(taxon["sciName"] or "").strip().casefold() for taxon in species]
    if any(not value for value in names) or len(names) != len(set(names)):
        raise ValueError("AviList species must have unique, nonempty scientific names")
    return species


def is_chinese_name(name: str | None, avilist: dict[str, Any]) -> bool:
    if not name:
        return False
    known_english = {
        str(avilist.get(field) or "").strip().casefold() for field in ("name", "nameClements", "nameBirdLife")
    }
    return name.strip().casefold() not in known_english and any("\u3400" <= char <= "\u9fff" for char in name)


def is_enabled(extinction_status: str | None) -> bool:
    normalized = (extinction_status or "").casefold()
    return not ("extinct" in normalized and "reintroduced" not in normalized)


def build_rows(
    avilist: list[dict[str, Any]],
    ebird_taxonomy: list[dict[str, Any]],
    region_species_codes: set[str],
    region_code: str,
    taxon_version: str,
) -> list[dict[str, str]]:
    ebird_by_code = {row["speciesCode"]: row for row in ebird_taxonomy if row.get("speciesCode")}
    ebird_by_scientific_name = {
        row["sciName"].casefold(): row for row in ebird_taxonomy if row.get("sciName")
    }
    rows: list[dict[str, str]] = []
    for taxon in avilist:
        ebird = ebird_by_code.get(taxon.get("cornellCode")) or ebird_by_scientific_name.get(
            str(taxon["sciName"]).casefold()
        )
        ebird_code = str((ebird or {}).get("speciesCode") or taxon.get("cornellCode") or "")
        localized_name = str(ebird.get("comName") or "") if ebird else ""
        chinese_name = localized_name if is_chinese_name(localized_name, taxon) else ""
        in_region = ebird_code in region_species_codes
        extinction_status = str(taxon.get("extinct") or "")
        rows.append(
            {
                "species_id": str(taxon["avibaseId"]),
                "scientific_name": str(taxon["sciName"]),
                "common_name_zh": chinese_name,
                "common_name_en": str(taxon.get("name") or ""),
                "order": str(taxon.get("order") or ""),
                "family": str(taxon.get("family") or ""),
                "ebird_code": ebird_code,
                "avibase_id": str(taxon["avibaseId"]),
                "region_codes": region_code if in_region else "",
                "extinction_status": extinction_status,
                "iucn_status": str(taxon.get("iucn") or ""),
                "taxon_source": "AviList",
                "taxon_version": taxon_version,
                "license": "CC BY 4.0 (AviList taxonomy)",
                "enabled": "true" if is_enabled(extinction_status) else "false",
            }
        )
    return rows


def write_csv(path: Path, rows: Iterable[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    version = args.taxon_version.strip()
    if not version.startswith("v"):
        version = "v" + version
    if not re.fullmatch(r"v[0-9][A-Za-z0-9._-]*", version) or ".." in version:
        raise ValueError("taxon version must be a release label such as v2026 or v2026.1")
    avilist_source = args.avilist or AVILIST_URL.format(version=version.removeprefix("v"))
    source_name = Path(urllib.parse.urlsplit(avilist_source).path).name
    source_version = re.fullmatch(r"avilist[-_]v?([0-9][A-Za-z0-9._-]*)\.json", source_name)
    if source_version and source_version.group(1) != version.removeprefix("v"):
        raise ValueError("declared taxon version disagrees with the AviList source filename")
    region_code = args.region_code.strip().upper()
    if len(region_code) != 2 or not region_code.isascii() or not region_code.isalpha():
        raise ValueError("region code must be a two-letter country code")
    offline_ebird_inputs = bool(args.ebird_taxonomy and args.ebird_region)
    if bool(args.ebird_taxonomy) != bool(args.ebird_region):
        raise ValueError("provide both --ebird-taxonomy and --ebird-region for an offline build")
    if not offline_ebird_inputs and not args.ebird_api_key:
        raise RuntimeError(
            "eBird enrichment is required; set EBIRD_API_KEY or provide both offline eBird files"
        )

    avilist_raw = load_json(avilist_source)
    avilist = avilist_species(avilist_raw)
    ebird_taxonomy: list[dict[str, Any]] = []
    region_codes: set[str] = set()
    if args.ebird_taxonomy:
        ebird_taxonomy = load_json(args.ebird_taxonomy)
    elif args.ebird_api_key:
        ebird_taxonomy = load_json(EBIRD_TAXONOMY_URL, api_key=args.ebird_api_key)
    if args.ebird_region:
        region_codes = set(load_json(args.ebird_region))
    elif args.ebird_api_key:
        region_codes = set(
            load_json(EBIRD_REGION_URL.format(region_code=region_code), api_key=args.ebird_api_key)
        )

    rows = build_rows(avilist, ebird_taxonomy, region_codes, region_code, version)
    region_rows = [row for row in rows if row["region_codes"] == region_code]
    output_dir = (
        (args.output_dir or Path(__file__).resolve().parents[1] / "config" / "catalog" / "releases" / version)
        .expanduser()
        .resolve()
    )
    if output_dir.exists():
        raise FileExistsError(f"catalog release directory already exists and is immutable: {output_dir}")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}-", dir=output_dir.parent))
    global_name = f"avilist_{version}_global.csv"
    region_name = f"avilist_{version}_{region_code.lower()}.csv"
    global_path = staging / global_name
    region_path = staging / region_name
    metadata = {
        "generated_at": datetime.now(UTC).isoformat(),
        "canonical_taxonomy": {
            "name": "AviList",
            "version": version,
            "released": args.released.isoformat() if args.released else None,
            "citation": args.citation,
            "doi": args.doi,
            "source": avilist_source,
            "canonical_json_sha256": hashlib.sha256(
                json.dumps(avilist_raw, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
            "license": "CC BY 4.0",
        },
        "common_names_and_region_enrichment": {
            "source": "eBird/Clements taxonomy (zh_SIM) and eBird regional species list",
            "taxonomy_endpoint": args.ebird_taxonomy or EBIRD_TAXONOMY_URL,
            "region_endpoint": args.ebird_region or EBIRD_REGION_URL.format(region_code=region_code),
            "taxonomy_canonical_json_sha256": hashlib.sha256(
                json.dumps(ebird_taxonomy, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
            "region_codes_sha256": hashlib.sha256("\n".join(sorted(region_codes)).encode()).hexdigest(),
            "region_code": region_code,
            "note": (
                "The regional file is an eBird occurrence-derived candidate subset, not an official "
                "national legal checklist. The global file remains the runtime source of truth."
            ),
        },
        "catalogs": {
            global_name: {
                "species": len(rows),
                "enabled_species": sum(row["enabled"] == "true" for row in rows),
                "chinese_names": sum(bool(row["common_name_zh"]) for row in rows),
                "sha256": None,
            },
            region_name: {
                "species": len(region_rows),
                "enabled_species": sum(row["enabled"] == "true" for row in region_rows),
                "chinese_names": sum(bool(row["common_name_zh"]) for row in region_rows),
                "sha256": None,
            },
        },
    }
    try:
        write_csv(global_path, rows)
        write_csv(region_path, region_rows)
        metadata["catalogs"][global_name]["sha256"] = sha256(global_path)
        metadata["catalogs"][region_name]["sha256"] = sha256(region_path)
        (staging / "catalog_metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        # The complete release becomes visible in one same-filesystem rename.
        staging.replace(output_dir)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(json.dumps(metadata["catalogs"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
