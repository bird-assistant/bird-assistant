#!/usr/bin/env python3
"""Evaluate BioCLIP ranking and unknown rejection on labeled bird crops."""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from contextlib import ExitStack
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps
from runtime_support import prepare_runtime

from bird_vision.config import Settings
from bird_vision.inference.species import build_species_provider

UNKNOWN_ID = "__unknown__"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="CSV: image_path,expected_species_id[,region_code]")
    parser.add_argument("--output", type=Path, help="optional JSON report path")
    parser.add_argument("--similarity-grid", nargs="+", type=float, default=[0.10, 0.15, 0.20, 0.25, 0.30])
    parser.add_argument("--margin-grid", nargs="+", type=float, default=[0.0, 0.005, 0.01, 0.02, 0.05])
    parser.add_argument("--max-unknown-false-accept-rate", type=float, default=0.05)
    args = parser.parse_args()
    values = [*args.similarity_grid, *args.margin_grid, args.max_unknown_false_accept_rate]
    if any(not -1 <= value <= 1 for value in args.similarity_grid):
        parser.error("similarity thresholds must be in [-1,1]")
    if any(not 0 <= value <= 2 for value in args.margin_grid):
        parser.error("margin thresholds must be in [0,2]")
    if not 0 <= args.max_unknown_false_accept_rate <= 1 or any(value != value for value in values):
        parser.error("thresholds must be finite and the false-accept limit must be in [0,1]")
    return args


def load_manifest(path: Path, default_region: str | None) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"image_path", "expected_species_id"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"manifest missing columns: {sorted(missing)}")
        records = []
        for line_number, row in enumerate(reader, start=2):
            image_path = (path.parent / (row.get("image_path") or "")).resolve()
            expected = (row.get("expected_species_id") or "").strip()
            if not image_path.is_file() or not expected:
                raise ValueError(f"invalid manifest row {line_number}")
            records.append(
                {
                    "image_path": image_path,
                    "expected_species_id": expected,
                    "region_code": (row.get("region_code") or default_region or "").strip().upper() or None,
                }
            )
    if not records:
        raise ValueError("manifest is empty")
    return records


def open_image(path: Path) -> Image.Image:
    with Image.open(path) as source:
        return ImageOps.exif_transpose(source).convert("RGB")


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    known = [record for record in records if record["expected_species_id"] != UNKNOWN_ID]
    unknown = [record for record in records if record["expected_species_id"] == UNKNOWN_ID]
    top1 = sum(
        bool(record["candidates"]) and record["candidates"][0]["species_id"] == record["expected_species_id"]
        for record in known
    )
    top3 = sum(
        record["expected_species_id"] in {candidate["species_id"] for candidate in record["candidates"][:3]}
        for record in known
    )
    accepted_correct = sum(
        record["accepted"]
        and bool(record["candidates"])
        and record["candidates"][0]["species_id"] == record["expected_species_id"]
        for record in known
    )
    unknown_rejected = sum(not record["accepted"] for record in unknown)
    unknown_classified = [record for record in unknown if record.get("classified", True)]
    unknown_classified_rejected = sum(not record["accepted"] for record in unknown_classified)

    def ratio(numerator: int, denominator: int) -> float | None:
        return round(numerator / denominator, 6) if denominator else None

    return {
        "images": len(records),
        "known_images": len(known),
        "unknown_images": len(unknown),
        "known_classification_coverage": ratio(
            sum(record.get("classified", True) for record in known), len(known)
        ),
        "top1_accuracy": ratio(top1, len(known)),
        "top3_accuracy": ratio(top3, len(known)),
        "accepted_correct_rate": ratio(accepted_correct, len(known)),
        "known_false_reject_rate": ratio(sum(not record["accepted"] for record in known), len(known)),
        "unknown_rejection_rate": ratio(unknown_rejected, len(unknown)),
        "unknown_false_accept_rate": ratio(len(unknown) - unknown_rejected, len(unknown)),
        "classified_unknown_images": len(unknown_classified),
        "classified_unknown_rejection_rate": ratio(unknown_classified_rejected, len(unknown_classified)),
        "classified_unknown_false_accept_rate": ratio(
            len(unknown_classified) - unknown_classified_rejected, len(unknown_classified)
        ),
    }


def threshold_sweep(
    records: list[dict[str, Any]],
    similarity_grid: list[float],
    margin_grid: list[float],
    max_unknown_false_accept_rate: float,
) -> dict[str, Any]:
    known = [record for record in records if record["expected_species_id"] != UNKNOWN_ID]
    unknown = [record for record in records if record["expected_species_id"] == UNKNOWN_ID]

    def ratio(numerator: int, denominator: int) -> float | None:
        return round(numerator / denominator, 6) if denominator else None

    rows = []
    for similarity in sorted(set(similarity_grid)):
        for margin in sorted(set(margin_grid)):
            accepted = [
                record
                for record in records
                if record["top_similarity"] is not None
                and record["margin"] is not None
                and record["top_similarity"] >= similarity
                and record["margin"] >= margin
            ]
            accepted_ids = {id(record) for record in accepted}
            correct = sum(
                id(record) in accepted_ids
                and bool(record["candidates"])
                and record["candidates"][0]["species_id"] == record["expected_species_id"]
                for record in known
            )
            false_known = sum(
                id(record) in accepted_ids
                and (
                    not record["candidates"]
                    or record["candidates"][0]["species_id"] != record["expected_species_id"]
                )
                for record in known
            )
            false_unknown = sum(id(record) in accepted_ids for record in unknown)
            row = {
                "min_similarity": similarity,
                "min_margin": margin,
                "accepted": len(accepted),
                "accepted_precision": ratio(correct, len(accepted)),
                "known_accepted_correct_rate": ratio(correct, len(known)),
                "known_false_accept_rate": ratio(false_known, len(known)),
                "unknown_false_accept_rate": ratio(false_unknown, len(unknown)),
            }
            rows.append(row)
    eligible = [
        row
        for row in rows
        if row["unknown_false_accept_rate"] is not None
        and row["unknown_false_accept_rate"] <= max_unknown_false_accept_rate
    ]
    recommended = max(
        eligible,
        key=lambda row: (
            row["known_accepted_correct_rate"] or 0.0,
            row["accepted_precision"] or 0.0,
            -row["min_similarity"],
            -row["min_margin"],
        ),
        default=None,
    )
    return {
        "selection_constraint": {
            "max_unknown_false_accept_rate": max_unknown_false_accept_rate,
            "requires_unknown_examples": True,
        },
        "recommended": recommended,
        "grid": rows,
    }


def main() -> int:
    args = parse_args()
    settings = Settings()
    if settings.species_backend != "bioclip":
        raise RuntimeError("set BIRD_VISION_SPECIES_BACKEND=bioclip before evaluation")
    # This evaluator only loads the classifier, regardless of the detector setting.
    prepare_runtime(settings.model_copy(update={"detector_backend": "mock"}), require_gpu=False)
    records = load_manifest(args.manifest.resolve(), settings.species_default_region_code)
    provider = build_species_provider(settings)
    try:
        provider.load()
        enabled_ids = {taxon.species_id for taxon in provider.taxa if taxon.enabled}
        unknown_expected_ids = sorted(
            {
                record["expected_species_id"]
                for record in records
                if record["expected_species_id"] != UNKNOWN_ID
                and record["expected_species_id"] not in enabled_ids
            }
        )
        if unknown_expected_ids:
            raise ValueError(
                "manifest contains IDs absent from the enabled catalog: "
                + ", ".join(unknown_expected_ids[:10])
            )
        groups: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
        for record in records:
            groups[record["region_code"]].append(record)
        for region_code, group in groups.items():
            for start in range(0, len(group), settings.species_batch_size):
                chunk = group[start : start + settings.species_batch_size]
                with ExitStack() as stack:
                    images = [stack.enter_context(open_image(record["image_path"])) for record in chunk]
                    predictions = provider.classify(images, max(3, settings.species_top_k), region_code)
                for record, prediction in zip(chunk, predictions, strict=True):
                    record["accepted"] = prediction.accepted
                    record["reason"] = prediction.reason
                    record["top_similarity"] = prediction.top_similarity
                    record["margin"] = prediction.margin
                    record["candidates"] = [
                        {
                            "species_id": candidate.species_id,
                            "score": candidate.score,
                            "similarity": candidate.similarity,
                        }
                        for candidate in prediction.candidates
                    ]
                    record["image_path"] = str(record["image_path"])
        report = {
            "model": provider.metadata(),
            "metrics": summarize(records),
            "threshold_calibration": threshold_sweep(
                records,
                args.similarity_grid,
                args.margin_grid,
                args.max_unknown_false_accept_rate,
            ),
            "records": records,
        }
        rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding="utf-8")
        print(rendered, end="")
        return 0
    finally:
        provider.close()


if __name__ == "__main__":
    raise SystemExit(main())
