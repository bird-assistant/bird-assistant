"""Measurement and offline model checks shared by the command-line evaluators."""

from __future__ import annotations

import importlib
import json
import math
import os
import re
from pathlib import Path
from typing import Any

from bird_vision.config import Settings


def prepare_runtime(settings: Settings, *, require_gpu: bool) -> None:
    # Acceptance must use provisioned artifacts, never silently fetch model weights.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    if require_gpu and (
        settings.device != "cuda"
        or settings.detector_backend != "yolo"
        or settings.species_backend != "bioclip"
    ):
        raise ValueError(
            "GPU acceptance requires DEVICE=cuda, DETECTOR_BACKEND=yolo, SPECIES_BACKEND=bioclip"
        )
    if settings.detector_backend == "yolo" and not settings.model_path.expanduser().is_file():
        raise FileNotFoundError("provide existing local detector weights; automatic downloads are disabled")
    if settings.species_backend == "bioclip":
        source = settings.bioclip_model
        if source.startswith("local-dir:"):
            if not Path(source.removeprefix("local-dir:")).expanduser().is_dir():
                raise FileNotFoundError("BioCLIP local model directory does not exist")
        elif not (source.startswith("hf-hub:") and settings.bioclip_model_revision):
            raise ValueError("use local-dir: BioCLIP artifacts or a pinned, already cached HF revision")
        elif not re.fullmatch(r"[a-fA-F0-9]{40,64}", settings.bioclip_model_revision):
            raise ValueError("HF revision must be an immutable commit hash, not a moving branch or tag")


class CudaMeasurements:
    def __init__(self, device: str, *, required: bool = False) -> None:
        self.torch: Any = None
        self.peak_allocated = 0
        self.peak_reserved = 0
        if device != "cpu":
            try:
                torch = importlib.import_module("torch")
            except ImportError:
                if required or device == "cuda":
                    raise RuntimeError(
                        "CUDA measurement requires an installed CUDA-enabled PyTorch"
                    ) from None
            else:
                if torch.cuda.is_available():
                    self.torch = torch
                    torch.cuda.synchronize(0)
                    torch.cuda.reset_peak_memory_stats(0)
        if self.torch is None and (required or device == "cuda"):
            raise RuntimeError("CUDA is unavailable; GPU acceptance was not performed")

    def synchronize(self) -> None:
        if self.torch is not None:
            self.torch.cuda.synchronize(0)

    def reset_peaks(self) -> None:
        if self.torch is not None:
            self.snapshot()
            self.torch.cuda.reset_peak_memory_stats(0)

    def snapshot(self) -> dict[str, Any] | None:
        if self.torch is None:
            return None
        self.synchronize()
        torch = self.torch
        allocated = torch.cuda.max_memory_allocated(0)
        reserved = torch.cuda.max_memory_reserved(0)
        self.peak_allocated = max(self.peak_allocated, allocated)
        self.peak_reserved = max(self.peak_reserved, reserved)
        free, total = torch.cuda.mem_get_info(0)
        mib = 1024**2
        return {
            "torch_version": str(torch.__version__),
            "cuda_version": torch.version.cuda,
            "gpu_name": torch.cuda.get_device_name(0),
            "allocated_mib": round(torch.cuda.memory_allocated(0) / mib, 3),
            "reserved_mib": round(torch.cuda.memory_reserved(0) / mib, 3),
            "peak_allocated_mib": round(self.peak_allocated / mib, 3),
            "peak_reserved_mib": round(self.peak_reserved / mib, 3),
            "interval_peak_allocated_mib": round(allocated / mib, 3),
            "interval_peak_reserved_mib": round(reserved / mib, 3),
            "device_used_mib": round((total - free) / mib, 3),
            "device_total_mib": round(total / mib, 3),
            "scope": "torch lifetime and reset interval peaks; device_used is a device-wide point sample",
        }


def latency_summary(values: list[float]) -> dict[str, float | int | None]:
    ordered = sorted(values)
    return {
        "samples": len(values),
        "mean_ms": round(sum(values) / len(values), 3) if values else None,
        **{
            f"p{percentile}_ms": round(ordered[math.ceil(len(values) * percentile / 100) - 1], 3)
            if values
            else None
            for percentile in (50, 95, 99)
        },
        "max_ms": round(max(values), 3) if values else None,
    }


def positive_float(value: str) -> float:
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise ValueError("must be a finite positive number")
    return result


def write_report(report: dict[str, Any], output: Path | None) -> None:
    rendered = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
