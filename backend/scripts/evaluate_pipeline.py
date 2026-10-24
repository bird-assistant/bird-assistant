#!/usr/bin/env python3
"""Evaluate full images through the actual detector/tracker/crop/species pipeline.

Manifest: JSON array in replay order. Each frame has sequence_id, frame_id,
timestamp_ms, image_path (relative to manifest), optional region_code, and objects.
Each bird object has track_id (ground truth), expected_species_id (or __unknown__
for an out-of-catalog bird),
and bbox [x1,y1,x2,y2] in EXIF-oriented image pixels. objects=[] is a negative frame.
Use --single-frame for independent photos (confirmation hits explicitly set to 1).
Default sequence replay is fast; --realtime honors capture intervals and the
configured wall-clock classification cooldown. HTTP/queue latency is not measured.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from evaluate_species import UNKNOWN_ID, open_image, summarize
from runtime_support import CudaMeasurements, latency_summary, positive_float, prepare_runtime, write_report

from bird_vision.config import Settings
from bird_vision.domain import Box, FrameJob
from bird_vision.inference.detectors import build_detector
from bird_vision.inference.pipeline import VisionPipeline
from bird_vision.inference.species import build_species_provider
from bird_vision.tracking import intersection_over_union


def load_manifest(path: Path, default_region: str | None) -> list[dict[str, Any]]:
    frames = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(frames, list) or not frames:
        raise ValueError("manifest must be a nonempty JSON array")
    seen = set()
    timestamps: dict[str, float] = {}
    labels: dict[tuple[str, str], str] = {}
    regions = {}
    for frame in frames:
        sequence = frame["sequence_id"]
        frame_id = frame["frame_id"]
        if not isinstance(sequence, str) or not sequence or not isinstance(frame_id, str) or not frame_id:
            raise ValueError("sequence_id and frame_id must be nonempty strings")
        key = (sequence, frame_id)
        timestamp = float(frame["timestamp_ms"])
        if key in seen or not math.isfinite(timestamp) or timestamp < 0:
            raise ValueError("duplicate frame or invalid timestamp_ms")
        if timestamp <= timestamps.get(sequence, -1):
            raise ValueError("timestamps must increase within each sequence")
        timestamps[sequence] = timestamp
        seen.add(key)
        frame["timestamp_ms"] = timestamp
        image_path = Path(frame["image_path"])
        if not str(frame["image_path"]).strip() or not (path.parent / image_path).is_file():
            raise ValueError(f"image does not exist: {image_path}")
        frame["image_path"] = (path.parent / image_path).resolve()
        region = (frame.get("region_code") or default_region or "").strip().upper() or None
        if region and (len(region) != 2 or not region.isascii() or not region.isalpha()):
            raise ValueError("region_code must be a two-letter country code")
        if sequence in regions and regions[sequence] != region:
            raise ValueError("region_code must remain constant within a sequence")
        regions[sequence] = region
        frame["region_code"] = region
        if not isinstance(frame["objects"], list):
            raise ValueError("objects must be a list; use [] for a negative frame")
        object_ids = set()
        for obj in frame["objects"]:
            track_id = obj["track_id"]
            expected = obj["expected_species_id"]
            if not isinstance(track_id, str) or not track_id or track_id in object_ids:
                raise ValueError("ground truth track_id must be a unique nonempty string within a frame")
            if not isinstance(expected, str) or not expected.strip():
                raise ValueError("expected_species_id must be nonempty")
            expected = expected.strip()
            obj["expected_species_id"] = expected
            label_key = (sequence, track_id)
            if label_key in labels and labels[label_key] != expected:
                raise ValueError("a ground truth track cannot change species within a sequence")
            labels[label_key] = expected
            object_ids.add(track_id)
            coords = obj["bbox"]
            if len(coords) != 4 or any(not math.isfinite(float(value)) for value in coords):
                raise ValueError("bbox must contain four finite pixel coordinates")
            box = Box(*(float(value) for value in coords))
            if box.x1 < 0 or box.y1 < 0 or box.area <= 0:
                raise ValueError("bbox must have positive area and nonnegative coordinates")
            obj["box"] = box
    return frames


class ModelProbe:
    """Observe actual pipeline calls without changing model or pipeline behavior."""

    def __init__(self, model: Any, measurements: CudaMeasurements) -> None:
        self.model = model
        self.measurements = measurements
        self.calls: list[dict[str, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self.model, name)

    def predict(self, image: Any) -> Any:
        self.measurements.synchronize()
        started = time.perf_counter()
        result = self.model.predict(image)
        self.measurements.synchronize()
        self.calls.append({"elapsed_ms": (time.perf_counter() - started) * 1000})
        return result

    def classify(
        self,
        images: list[Any],
        top_k: int,
        region_code: str | None = None,
        context: Any = None,
    ) -> Any:
        self.measurements.synchronize()
        started = time.perf_counter()
        result = self.model.classify(images, top_k, region_code, context)
        self.measurements.synchronize()
        self.calls.append(
            {
                "elapsed_ms": (time.perf_counter() - started) * 1000,
                "crop_count": len(images),
                "crop_sizes": [list(image.size) for image in images],
            }
        )
        return result


def score_frame(
    frame: dict[str, Any], result: Any, iou_threshold: float
) -> tuple[list[dict[str, Any]], list[int]]:
    predicted = [
        Box(
            track.bbox.x1 * result.image_width,
            track.bbox.y1 * result.image_height,
            track.bbox.x2 * result.image_width,
            track.bbox.y2 * result.image_height,
        )
        for track in result.tracks
    ]
    pairs = sorted(
        (
            (intersection_over_union(obj["box"], box), gt_index, pred_index)
            for gt_index, obj in enumerate(frame["objects"])
            for pred_index, box in enumerate(predicted)
        ),
        reverse=True,
    )
    matches = {}
    used = set()
    for iou, gt_index, pred_index in pairs:
        if iou >= iou_threshold and gt_index not in matches and pred_index not in used:
            matches[gt_index] = pred_index
            used.add(pred_index)
    records = []
    for index, obj in enumerate(frame["objects"]):
        track = result.tracks[matches[index]] if index in matches else None
        classified = bool(track is not None and track.species.decision is not None)
        records.append(
            {
                "sequence_id": frame["sequence_id"],
                "frame_id": frame["frame_id"],
                "expected_track_id": obj["track_id"],
                "expected_species_id": obj["expected_species_id"],
                "short_side_px": obj["box"].short_side,
                "detected": track is not None,
                "predicted_track_id": track.track_id if track is not None else None,
                "classified": classified,
                "accepted": track.species.decision.accepted if classified else False,
                "reason": track.species.decision.reason if classified else "not_classified",
                "candidates": [item.model_dump(mode="json") for item in track.species.candidates]
                if classified
                else [],
            }
        )
    return records, [index for index in range(len(predicted)) if index not in used]


def evaluate(settings: Settings, args: argparse.Namespace) -> dict[str, Any]:
    frames = load_manifest(args.manifest.resolve(), settings.species_default_region_code)
    if settings.species_top_k < 3:
        raise ValueError("full evaluation requires SPECIES_TOP_K>=3 for honest Top-3 metrics")
    if args.single_frame:
        settings = settings.model_copy(update={"track_confirm_hits": 1})
    prepare_runtime(settings, require_gpu=args.require_gpu)
    measurements = CudaMeasurements(settings.device, required=args.require_gpu)
    if args.max_vram_mib is not None and measurements.torch is None:
        raise ValueError("--max-vram-mib requires CUDA measurement")
    detector = ModelProbe(build_detector(settings), measurements)
    species = ModelProbe(build_species_provider(settings), measurements)
    try:
        started = time.perf_counter()
        detector.load()
        species.load()
        measurements.synchronize()
        load_ms = (time.perf_counter() - started) * 1000
        if args.require_gpu and not all(model.device.startswith("cuda") for model in (detector, species)):
            raise RuntimeError("loaded models did not both resolve to CUDA")
        enabled = {taxon.species_id for taxon in species.taxa if taxon.enabled}
        invalid = {
            obj["expected_species_id"]
            for frame in frames
            for obj in frame["objects"]
            if obj["expected_species_id"] != UNKNOWN_ID and obj["expected_species_id"] not in enabled
        }
        if invalid:
            raise ValueError(f"manifest species absent from enabled catalog: {sorted(invalid)}")
        pipeline = VisionPipeline(settings, detector, species)
        # Warm both models independently so an empty first detection cannot skip classifier warmup.
        with open_image(frames[0]["image_path"]) as image:
            for _ in range(args.warmup):
                detector.predict(image)
                species.classify([image], settings.species_top_k, frames[0]["region_code"])
        detector.calls.clear()
        species.calls.clear()
        trackers = {}
        replay_starts = {}
        records = []
        frame_records = []
        gt_to_pred = {}
        first_seen = {}
        first_detection = {}
        first_candidate = {}
        id_switches = 0
        epoch = datetime.now(UTC)
        for frame in frames:
            sequence = frame["sequence_id"]
            origin, first_timestamp = replay_starts.setdefault(
                sequence, (time.monotonic(), frame["timestamp_ms"])
            )
            target = origin + (frame["timestamp_ms"] - first_timestamp) / 1000
            while args.realtime and target > time.monotonic():
                time.sleep(max(0, min(0.05, target - time.monotonic())))
            measurements.synchronize()
            started = time.perf_counter()
            with open_image(frame["image_path"]) as image:
                for obj in frame["objects"]:
                    if obj["box"].x2 > image.width or obj["box"].y2 > image.height:
                        raise ValueError(f"bbox outside oriented image: {frame['frame_id']}")
                decode_ms = (time.perf_counter() - started) * 1000
                if args.single_frame or sequence not in trackers:
                    trackers[sequence] = pipeline.new_tracker()
                calls_before = len(species.calls)
                observed = epoch + timedelta(milliseconds=frame["timestamp_ms"])
                result = pipeline.process(
                    session_id=sequence,
                    job=FrameJob(
                        frame_id=frame["frame_id"],
                        image=image,
                        captured_at=observed,
                        received_at=observed,
                        received_monotonic=time.monotonic(),
                        region_code=frame["region_code"],
                    ),
                    tracker=trackers[sequence],
                    queue_ms=0,
                    decode_ms=decode_ms,
                )
                measurements.synchronize()
                elapsed_ms = (time.perf_counter() - started) * 1000
            objects, unmatched = score_frame(frame, result, args.iou)
            records.extend(objects)
            for obj in objects:
                key = (sequence, obj["expected_track_id"])
                if args.single_frame:
                    key = (*key, frame["frame_id"])
                timestamp = frame["timestamp_ms"]
                first_seen.setdefault(key, timestamp)
                if obj["detected"]:
                    previous = gt_to_pred.get(key)
                    if previous is not None and previous != obj["predicted_track_id"]:
                        id_switches += 1
                    gt_to_pred[key] = obj["predicted_track_id"]
                    first_detection.setdefault(key, timestamp - first_seen[key] + elapsed_ms)
                if obj["accepted"]:
                    first_candidate.setdefault(key, timestamp - first_seen[key] + elapsed_ms)
            frame_records.append(
                {
                    "sequence_id": sequence,
                    "frame_id": frame["frame_id"],
                    "image_path": str(frame["image_path"]),
                    "timestamp_ms": frame["timestamp_ms"],
                    "wall_ms": elapsed_ms,
                    "decode_ms": decode_ms,
                    "negative": not frame["objects"],
                    "false_positives": len(unmatched),
                    "accepted_false_positives": sum(
                        result.tracks[index].species.state == "candidate" for index in unmatched
                    ),
                    "classification_calls": species.calls[calls_before:],
                    "result": result.model_dump(mode="json"),
                }
            )

        tp = sum(record["detected"] for record in records)
        fp = sum(frame["false_positives"] for frame in frame_records)
        eligible = [
            record for record in records if record["short_side_px"] >= settings.min_recognizable_side_px
        ]
        negatives = [frame for frame in frame_records if frame["negative"]]

        def ratio(numerator: int, denominator: int) -> float | None:
            return round(numerator / denominator, 6) if denominator else None

        vram = measurements.snapshot()
        wall = latency_summary([frame["wall_ms"] for frame in frame_records])
        species_metrics = summarize(records)
        failures = []
        if args.require_gpu and (not records or not negatives or not species.calls):
            failures.append(
                "GPU acceptance requires annotated objects, negative frames and actual crop classification"
            )
        known = [record for record in records if record["expected_species_id"] != UNKNOWN_ID]
        unknown = [record for record in records if record["expected_species_id"] == UNKNOWN_ID]
        if args.require_gpu and not (
            any(r["classified"] for r in known) and any(r["classified"] for r in unknown)
        ):
            failures.append("GPU acceptance requires classified known AND unknown objects")
        if args.max_p95_ms is not None and wall["p95_ms"] > args.max_p95_ms:
            failures.append("frame P95 exceeds --max-p95-ms")
        if args.max_vram_mib is not None and vram["peak_reserved_mib"] > args.max_vram_mib:
            failures.append("peak reserved VRAM exceeds --max-vram-mib")
        for metric, minimum in (("top1_accuracy", args.min_top1), ("top3_accuracy", args.min_top3)):
            if minimum is not None and (species_metrics[metric] is None or species_metrics[metric] < minimum):
                failures.append(f"{metric} missing or below required minimum {minimum}")
        unknown_false_accept = species_metrics["classified_unknown_false_accept_rate"]
        if args.max_unknown_false_accept_rate is not None and (
            unknown_false_accept is None or unknown_false_accept > args.max_unknown_false_accept_rate
        ):
            failures.append("classified unknown false accept rate missing or exceeds required maximum")
        return {
            "ok": not failures,
            "scope": "local image decode + production VisionPipeline; excludes HTTP, queue and network",
            "real_models": detector.backend == "ultralytics-yolo" and species.backend == "open-clip",
            "require_gpu": args.require_gpu,
            "single_frame": args.single_frame,
            "realtime_replay": args.realtime,
            "cooldown_clock": "actual wall time; fast replay can skip refresh classifications",
            "iou_matching": {"threshold": args.iou, "method": "greedy descending IoU, one-to-one"},
            "settings": settings.model_dump(mode="json", exclude={"api_keys"}),
            "detector": detector.metadata(),
            "species": species.metadata(),
            "load_ms": round(load_ms, 3),
            "warmup_iterations": args.warmup,
            "limits": {
                "max_vram_mib": args.max_vram_mib,
                "max_p95_ms": args.max_p95_ms,
                "min_top1": args.min_top1,
                "min_top3": args.min_top3,
                "max_classified_unknown_false_accept_rate": args.max_unknown_false_accept_rate,
            },
            "metrics": {
                "detection": {
                    "tp": tp,
                    "fp": fp,
                    "fn": len(records) - tp,
                    "precision": ratio(tp, tp + fp),
                    "recall": ratio(tp, len(records)),
                    "recognizable_objects": len(eligible),
                    "recognizable_recall": ratio(sum(r["detected"] for r in eligible), len(eligible)),
                    "negative_frames": len(negatives),
                    "negative_frame_false_trigger_rate": ratio(
                        sum(frame["false_positives"] > 0 for frame in negatives), len(negatives)
                    ),
                    "negative_frame_false_accept_rate": ratio(
                        sum(frame["accepted_false_positives"] > 0 for frame in negatives), len(negatives)
                    ),
                },
                "species_objects": species_metrics,
                "species_metric_scope": (
                    "image counts denote annotated object observations; unmatched/waiting objects fail known "
                    "accuracy; end-to-end unknown rejection includes undetected/waiting objects; "
                    "classified_unknown_rejection_rate only counts objects with classifier decisions"
                ),
                "tracking": {
                    "id_switches": id_switches,
                    "ground_truth_tracks": len(first_seen),
                    "detected_tracks": len(first_detection),
                    "accepted_tracks": len(first_candidate),
                },
            },
            "latency": {
                "frame": wall,
                "detector_wall": latency_summary([call["elapsed_ms"] for call in detector.calls]),
                "classification_call": latency_summary([call["elapsed_ms"] for call in species.calls]),
                "first_detection_capture_elapsed": latency_summary(list(first_detection.values())),
                "first_candidate_capture_elapsed": latency_summary(list(first_candidate.values())),
                "first_result_scope": "capture offset + processing ms; successful tracks only",
            },
            "classification_batch_size": settings.species_batch_size,
            "classification_calls": species.calls,
            "vram": vram,
            "failures": failures,
            "objects": records,
            "frames": frame_records,
        }
    finally:
        try:
            species.close()
        finally:
            detector.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-gpu", action="store_true")
    parser.add_argument("--single-frame", action="store_true")
    parser.add_argument("--realtime", action="store_true")
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--iou", type=float, default=0.5)
    parser.add_argument("--batch-size", type=int, help="override species microbatch size (1..64)")
    parser.add_argument("--max-vram-mib", type=positive_float)
    parser.add_argument("--max-p95-ms", type=positive_float)
    parser.add_argument("--min-top1", type=float, help="optional known-object Top-1 acceptance gate")
    parser.add_argument("--min-top3", type=float, help="optional known-object Top-3 acceptance gate")
    parser.add_argument(
        "--max-unknown-false-accept-rate", type=float, help="gate on classified unknown objects only"
    )
    args = parser.parse_args()
    if (
        not 0 < args.iou <= 1
        or args.warmup < 0
        or (args.batch_size is not None and not 1 <= args.batch_size <= 64)
    ):
        parser.error("IoU must be in (0,1], warmup nonnegative and batch size in [1,64]")
    if any(
        rate is not None and not 0 <= rate <= 1
        for rate in (args.min_top1, args.min_top3, args.max_unknown_false_accept_rate)
    ):
        parser.error("accuracy/rate gates must be finite values in [0,1]")
    return args


def main() -> int:
    args = parse_args()
    try:
        settings = Settings()
        if args.batch_size is not None:
            settings = settings.model_copy(update={"species_batch_size": args.batch_size})
        report = evaluate(settings, args)
    except Exception as exc:
        report = {"ok": False, "error_type": type(exc).__name__, "message": str(exc)}
    write_report(report, args.output)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
