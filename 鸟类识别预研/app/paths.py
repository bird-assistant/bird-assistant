"""Path and environment resolution that works both from source and from a
PyInstaller build.

Rules:
- app_dir()  : where the user-visible files live (exe folder when frozen).
- resource_dir(): where bundled python modules/data live (_MEIPASS when frozen).
- Models, results and torch hub cache always sit next to the exe, so the folder
  stays portable and the build does not have to embed ~120 MB of weights.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))


def app_dir() -> Path:
    if FROZEN:
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def resource_dir() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    return Path(meipass) if meipass else app_dir()


def setup_env() -> None:
    """Point third-party caches at the portable app folder (must run before imports)."""
    base = app_dir()
    os.environ.setdefault("TORCH_HOME", str(base / "models" / "torch_hub"))
    os.environ.setdefault("BIRDLAB_MODEL_DIR", str(base / "models" / "birdnet"))
    os.environ.setdefault("YOLO_CONFIG_DIR", str(base / "models" / "ultralytics"))
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")


def model_path(name: str = "yolo11n.pt") -> Path:
    return app_dir() / "models" / name


def results_dir() -> Path:
    return app_dir() / "results" / "gui"


def resolve_input(path: str | Path) -> Path:
    """Accept a path relative to CWD, the exe folder, or the bundled resources."""
    p = Path(path)
    if p.exists():
        return p
    for base in (app_dir(), resource_dir()):
        alt = base / p
        if alt.exists():
            return alt
    return p
