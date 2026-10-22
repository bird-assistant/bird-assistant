"""Shared helpers: unicode-safe paths, device info, timing stats, video IO."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import platform
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


# --------------------------------------------------------------------------- #
# Unicode-safe file access
# Windows OpenCV (VideoCapture/VideoWriter) fails silently on non-ASCII paths,
# so anything crossing cv2 goes through an ASCII scratch copy.
# --------------------------------------------------------------------------- #
SCRATCH_ROOT = Path(tempfile.gettempdir()) / "birdlab"


def _scratch_path(src: Path) -> Path:
    digest = hashlib.sha1(str(src).encode("utf-8")).hexdigest()[:10]
    SCRATCH_ROOT.mkdir(parents=True, exist_ok=True)
    return SCRATCH_ROOT / f"{digest}_{src.name}"


def to_ascii_input(path: str | Path) -> tuple[Path, Path | None]:
    """Return a cv2-safe path for reading. Second value is a temp copy to delete."""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(p)
    if all(ord(ch) < 128 for ch in str(p)):
        return p, None
    tmp = _scratch_path(p)
    if not tmp.exists() or tmp.stat().st_size != p.stat().st_size:
        shutil.copy2(p, tmp)
    return tmp, tmp


@dataclass
class AsciiOutput:
    """Write to an ASCII scratch path, then move into place on commit()."""

    target: Path
    temp: Path

    def commit(self) -> Path:
        self.target.parent.mkdir(parents=True, exist_ok=True)
        if self.target.exists():
            self.target.unlink()
        shutil.move(str(self.temp), str(self.target))
        return self.target

    def discard(self) -> None:
        if self.temp.exists():
            self.temp.unlink()


def to_ascii_output(path: str | Path) -> AsciiOutput:
    p = Path(path).expanduser().resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    if all(ord(ch) < 128 for ch in str(p)):
        return AsciiOutput(target=p, temp=p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = _scratch_path(p)
    return AsciiOutput(target=p, temp=tmp)


# --------------------------------------------------------------------------- #
# Device / environment info
# --------------------------------------------------------------------------- #
def _cpu_name() -> str:
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
        )
        return str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
    except Exception:
        return platform.processor() or "unknown"


def _total_ram_gb() -> float:
    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        return round(stat.ullTotalPhys / 1024**3, 1)
    return 0.0


def device_info() -> dict:
    import torch

    info = {
        "hostname": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "cpu": _cpu_name(),
        "cpu_cores_physical": os.cpu_count(),
        "ram_gb": _total_ram_gb(),
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "torch_threads": torch.get_num_threads(),
        "torch_cuda_available": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "cv2": cv2.__version__,
    }
    try:
        import ultralytics

        info["ultralytics"] = ultralytics.__version__
    except Exception:
        pass
    try:
        info["numpy"] = np.__version__
    except Exception:
        pass
    return info


# --------------------------------------------------------------------------- #
# Stats
# --------------------------------------------------------------------------- #
def pct(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    return float(np.percentile(np.asarray(values, dtype=np.float64), q))


def summarize(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    arr = np.asarray(values, dtype=np.float64)
    return {
        "n": int(arr.size),
        "mean": round(float(arr.mean()), 2),
        "p50": round(pct(values, 50), 2),
        "p95": round(pct(values, 95), 2),
        "p99": round(pct(values, 99), 2),
        "min": round(float(arr.min()), 2),
        "max": round(float(arr.max()), 2),
    }


def write_json(path: str | Path, payload: dict) -> Path:
    p = Path(path).expanduser().resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


# --------------------------------------------------------------------------- #
# Video IO
# --------------------------------------------------------------------------- #
def open_video(source: str):
    """Open a video path or webcam index. Returns (capture, cleanup_path)."""
    if str(source).isdigit():
        cap = cv2.VideoCapture(int(source))
        return cap, None
    safe_path, tmp = to_ascii_input(source)
    cap = cv2.VideoCapture(str(safe_path))
    return cap, tmp


def video_meta(cap: cv2.VideoCapture) -> dict:
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    return {
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps": round(fps, 3),
        "frames": n,
        "duration_s": round(n / fps, 2) if fps else None,
    }


def make_writer(out: AsciiOutput, size: tuple[int, int], fps: float) -> cv2.VideoWriter:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out.temp), fourcc, fps if fps > 0 else 25.0, size)
    if not writer.isOpened():
        raise RuntimeError(f"cannot open video writer at {out.temp}")
    return writer


def probe_video(path: str) -> dict:
    cap, tmp = open_video(path)
    meta = video_meta(cap)
    cap.release()
    if tmp is not None:
        tmp.unlink(missing_ok=True)
    return meta
