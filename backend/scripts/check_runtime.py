#!/usr/bin/env python3
"""Offline model smoke check; --require-gpu enables strict CUDA acceptance.

Synthetic inputs test execution only. Use evaluate_pipeline.py for labeled real
image detection/tracking/species metrics. No accuracy is inferred here.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image
from runtime_support import (
    CudaMeasurements,
    latency_summary,
    positive_float,
    prepare_runtime,
    write_report,
)

from bird_vision.config import Settings
from bird_vision.domain import FrameJob
from bird_vision.inference.detectors import build_detector
from bird_vision.inference.pipeline import VisionPipeline
from bird_vision.inference.species import build_species_provider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--require-gpu", action="store_true", help="fail on mock, disabled, CPU or missing CUDA"
    )
    parser.add_argument("--batch-sizes", nargs="+", type=int, default=[1, 8], help="BioCLIP crop batch sizes")
    parser.add_argument("--iterations", type=int, default=10)
    parser.add_argument("--warmup", type=int, default=2, help="unmeasured warmup iterations per batch size")
    parser.add_argument("--max-vram-mib", type=positive_float, help="maximum torch peak reserved VRAM")
    parser.add_argument("--max-p95-ms", type=positive_float, help="maximum pipeline AND crop-batch P95")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.iterations < 1 or args.warmup < 0 or any(not 1 <= size <= 64 for size in args.batch_sizes):
        parser.error("iterations must be positive, warmup nonnegative, and batch sizes in [1, 64]")
    return args


def run_checks(settings: Settings, args: argparse.Namespace) -> dict[str, Any]:
    prepare_runtime(settings, require_gpu=args.require_gpu)
    measurements = CudaMeasurements(settings.device, required=args.require_gpu)
    if args.max_vram_mib is not None and measurements.torch is None:
        raise ValueError("--max-vram-mib requires CUDA measurement")
    detector = build_detector(settings)
    species = build_species_provider(settings)
    try:
        started = time.perf_counter()
        detector.load()
        species.load()
        measurements.synchronize()
        load_ms = (time.perf_counter() - started) * 1000
        load_vram = measurements.snapshot()
        if args.require_gpu and not all(item.device.startswith("cuda") for item in (detector, species)):
            raise RuntimeError("loaded models did not both resolve to CUDA")
        pipeline = VisionPipeline(settings, detector, species)
        image = Image.new("RGB", (1280, 720), (90, 120, 90))
        pipeline_ms = []
        tracker = pipeline.new_tracker()
        for index in range(args.warmup + args.iterations):
            now = datetime.now(UTC)
            measurements.synchronize()
            started = time.perf_counter()
            result = pipeline.process(
                session_id="smoke",
                job=FrameJob(
                    frame_id=f"smoke-{index}",
                    image=image,
                    captured_at=now,
                    received_at=now,
                    received_monotonic=time.monotonic(),
                    region_code=settings.species_default_region_code,
                ),
                tracker=tracker,
                queue_ms=0.0,
                decode_ms=0.0,
            )
            measurements.synchronize()
            if index >= args.warmup:
                pipeline_ms.append((time.perf_counter() - started) * 1000)

        pipeline_vram = measurements.snapshot()
        batches = []
        original_batch_size = settings.species_batch_size
        try:
            for batch_size in dict.fromkeys(args.batch_sizes):
                settings.species_batch_size = batch_size
                measurements.reset_peaks()
                # Runtime classification normally receives crops bounded by this size.
                side = settings.species_max_crop_side_px
                crops = [Image.new("RGB", (side, side), (90, 120, 90)) for _ in range(batch_size)]
                timings = []
                for index in range(args.warmup + args.iterations):
                    measurements.synchronize()
                    started = time.perf_counter()
                    predictions = species.classify(
                        crops, settings.species_top_k, region_code=settings.species_default_region_code
                    )
                    measurements.synchronize()
                    elapsed = (time.perf_counter() - started) * 1000
                    if len(predictions) != batch_size:
                        raise RuntimeError("species prediction count does not match crop batch")
                    if index >= args.warmup:
                        timings.append(elapsed)
                batches.append(
                    {
                        "batch_size": batch_size,
                        "crop_side_px": side,
                        "latency": latency_summary(timings),
                        "images_per_second": round(batch_size * len(timings) * 1000 / sum(timings), 3),
                        "vram": measurements.snapshot(),
                        "vram_scope": "interval includes this batch warmup; allocator cache may persist",
                    }
                )
        finally:
            settings.species_batch_size = original_batch_size

        vram = measurements.snapshot()
        if vram is not None:
            # Keep the gate independent of resets used for per-batch measurements.
            snapshots = [load_vram, pipeline_vram, *(batch["vram"] for batch in batches), vram]
            for key in ("peak_allocated_mib", "peak_reserved_mib"):
                vram[key] = max(snapshot[key] for snapshot in snapshots if snapshot is not None)
        failures = []
        if args.max_vram_mib is not None and vram["peak_reserved_mib"] > args.max_vram_mib:
            failures.append("peak reserved VRAM exceeds --max-vram-mib")
        pipeline_latency = latency_summary(pipeline_ms)
        if args.max_p95_ms is not None and any(
            item["p95_ms"] > args.max_p95_ms for item in [pipeline_latency, *(b["latency"] for b in batches)]
        ):
            failures.append("pipeline or crop batch P95 exceeds --max-p95-ms")
        return {
            "ok": not failures,
            "mode": "gpu_acceptance" if args.require_gpu else "smoke_only",
            "accuracy_evaluated": False,
            "input": "synthetic; no guarantee of detected birds or pipeline classification",
            "detector": {
                "backend": detector.backend,
                "device": detector.device,
                "details": detector.metadata(),
            },
            "species": {"backend": species.backend, "device": species.device, "details": species.metadata()},
            "load_ms": round(load_ms, 3),
            "load_vram": load_vram,
            "warmup_iterations": args.warmup,
            "limits": {"max_vram_mib": args.max_vram_mib, "max_p95_ms": args.max_p95_ms},
            "pipeline_latency": pipeline_latency,
            "pipeline_vram": pipeline_vram,
            "synthetic_frame": result.model_dump(mode="json"),
            "classification_batches": batches,
            "vram": vram,
            "failures": failures,
        }
    finally:
        try:
            species.close()
        finally:
            detector.close()


def main() -> int:
    args = parse_args()
    try:
        report = run_checks(Settings(), args)
    except Exception as exc:
        report = {"ok": False, "error_type": type(exc).__name__, "message": str(exc)}
        if args.output is None:
            print(str(exc), file=sys.stderr)
    write_report(report, args.output)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
