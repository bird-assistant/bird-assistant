"""BirdNET v2.4 runtime on top of LiteRT (no birdnetlib / pydub / librosa).

Why not birdnetlib: its import chain needs pydub+audioop (gone in Python 3.13)
and it shells out to ffmpeg; the TFLite loader also chokes on non-ASCII paths.
Here the model is loaded from bytes, so any working directory is fine.

Model: BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite (CC BY-NC-SA 4.0, Cornell Lab).
Input: raw 48 kHz mono waveform, 3 s (144000 samples) is the trained window.
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter, OpResolverType

SAMPLE_RATE = 48000
WINDOW_SAMPLES = 3 * SAMPLE_RATE

_REPO = Path(__file__).resolve().parent.parent
_MODEL_DIR = Path(os.environ.get("BIRDLAB_MODEL_DIR") or (_REPO / "models" / "birdnet"))
_MODEL_NAME = "BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite"
_LABEL_NAME = "BirdNET_GLOBAL_6K_V2.4_Labels.txt"


def _find_packaged() -> Path | None:
    """Locate the model shipped inside the birdnetlib wheel, without importing it."""
    import importlib.util

    try:
        spec = importlib.util.find_spec("birdnetlib")
    except Exception:
        return None
    if not spec or not spec.origin:
        return None
    p = Path(spec.origin).parent / "models" / "analyzer" / _MODEL_NAME
    return p if p.exists() else None


def ensure_model_assets(model_dir: Path = _MODEL_DIR) -> tuple[Path, Path]:
    model_dir.mkdir(parents=True, exist_ok=True)
    model, labels = model_dir / _MODEL_NAME, model_dir / _LABEL_NAME
    if model.exists() and labels.exists():
        return model, labels
    src = _find_packaged()
    if src is None:
        raise FileNotFoundError(
            f"BirdNET weights not found. Put {_MODEL_NAME} and {_LABEL_NAME} in {model_dir} "
            "(download from github.com/kahst/BirdNET-Analyzer) or pip install birdnetlib."
        )
    shutil.copy2(src, model)
    shutil.copy2(src.parent / _LABEL_NAME, labels)
    return model, labels


def load_labels(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def split_label(label: str) -> tuple[str, str]:
    """'Turdus merula_Common Blackbird' -> ('Turdus merula', 'Common Blackbird')."""
    if "_" in label:
        sci, common = label.split("_", 1)
        return sci.strip(), common.strip()
    return label.strip(), ""


class BirdNet:
    def __init__(
        self,
        threads: int = 4,
        model_path: Path | None = None,
        labels_path: Path | None = None,
        no_delegate: bool = False,
    ):
        model, labels = (model_path, labels_path) if model_path and labels_path else ensure_model_assets()
        self.model_path = Path(model)
        self.labels = load_labels(Path(labels))
        self.threads = threads
        self.no_delegate = no_delegate
        self._build()

    def _build(self) -> None:
        kwargs = {"num_threads": self.threads}
        if self.no_delegate:
            # XNNPACK cannot reshape to windows other than the trained 3 s.
            kwargs["experimental_op_resolver_type"] = OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES
        self.interpreter = Interpreter(model_content=self.model_path.read_bytes(), **kwargs)
        self.interpreter.allocate_tensors()
        self.in_detail = self.interpreter.get_input_details()[0]
        self.out_detail = self.interpreter.get_output_details()[0]
        self._alloc_len: int | None = None

    def predict(self, samples: np.ndarray, sensitivity: float = 1.0) -> np.ndarray:
        x = np.asarray(samples, dtype=np.float32).reshape(1, -1)
        try:
            return self._invoke(x, sensitivity)
        except RuntimeError:
            if self.no_delegate:
                raise
            self.no_delegate = True
            self._build()
            return self._invoke(x, sensitivity)

    def _invoke(self, x: np.ndarray, sensitivity: float) -> np.ndarray:
        if self._alloc_len != x.shape[1]:
            self.interpreter.resize_tensor_input(self.in_detail["index"], list(x.shape))
            self.interpreter.allocate_tensors()
            self._alloc_len = x.shape[1]
        self.interpreter.set_tensor(self.in_detail["index"], x)
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self.out_detail["index"])[0]
        return 1.0 / (1.0 + np.exp(-sensitivity * np.clip(logits, -15, 15)))

    def topk(self, samples: np.ndarray, k: int = 5, sensitivity: float = 1.0) -> list[tuple[str, float]]:
        probs = self.predict(samples, sensitivity=sensitivity)
        idx = np.argpartition(-probs, min(k, len(probs) - 1))[:k]
        idx = idx[np.argsort(-probs[idx])]
        return [(self.labels[i], float(probs[i])) for i in idx]

    def timed_predict(self, samples: np.ndarray) -> tuple[np.ndarray, float]:
        t0 = time.perf_counter()
        probs = self.predict(samples)
        return probs, (time.perf_counter() - t0) * 1000.0


if __name__ == "__main__":
    net = BirdNet()
    print(f"model   : {net.model_path}")
    print(f"labels  : {len(net.labels)}")
    print(f"input   : {net.in_detail['shape']} {net.in_detail['dtype']}")
    print(f"output  : {net.out_detail['shape']} {net.out_detail['dtype']}")
    dummy = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
    probs, ms = net.timed_predict(dummy)
    print(f"silence predict: {ms:.1f} ms, mean p={probs.mean():.4f}, max p={probs.max():.4f}")
