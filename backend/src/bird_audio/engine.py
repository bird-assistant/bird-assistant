"""BirdNET v2.4 inference engines.

The real engine is the same LiteRT path validated in the issue #6 pre-research:
the TFLite graph is loaded from bytes (so non-ASCII working directories work) and
only ever receives the exact 144000-sample window it was trained on. numpy and
``ai_edge_litert`` are imported lazily so the API, business and test layers do not
need the 49 MB runtime installed.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Sequence
from typing import Any, Protocol

from bird_audio.audio import frame_energy
from bird_audio.config import AudioSettings
from bird_audio.labels import ModelLabel
from bird_common.catalog import sha256_file

LOGGER = logging.getLogger(__name__)


class AudioEngine(Protocol):
    name: str
    backend: str
    device: str
    score_type: str
    ready: bool

    def load(self) -> None: ...

    def predict(self, window: Sequence[float]) -> list[float]: ...

    def metadata(self) -> dict[str, Any]: ...

    def close(self) -> None: ...


class MockAudioEngine:
    """Deterministic engine for local API development and tests.

    Scores follow the window energy, so a silent clip yields ``unknown`` and a
    loud clip yields candidates. It never claims to be a real classifier.
    """

    name = "mock-birdnet"
    backend = "mock"
    device = "cpu"
    score_type = "mock"

    def __init__(self, labels: Sequence[ModelLabel]) -> None:
        self.labels = list(labels)
        self.ready = False

    def load(self) -> None:
        self.ready = True

    def predict(self, window: Sequence[float]) -> list[float]:
        scores = [0.0] * len(self.labels)
        if not scores:
            return scores
        energy = frame_energy(window)
        primary = min(0.99, energy * 6.0)
        scores[0] = primary
        if len(scores) > 1:
            scores[1] = primary * 0.55
        if len(scores) > 2:
            scores[2] = primary * 0.30
        return scores

    def metadata(self) -> dict[str, Any]:
        return {
            "purpose": "development-only deterministic output",
            "labels": len(self.labels),
        }

    def close(self) -> None:
        self.ready = False


class BirdNetEngine:
    """BirdNET v2.4 through LiteRT/XNNPACK on CPU."""

    backend = "ai-edge-litert"
    device = "cpu"
    score_type = "birdnet_confidence"

    def __init__(self, settings: AudioSettings, labels: Sequence[ModelLabel]) -> None:
        self.settings = settings
        self.labels = list(labels)
        self.name = settings.model_name
        self.ready = False
        self._lock = threading.Lock()
        self._interpreter: Any = None
        self._np: Any = None
        self._input_index: int | None = None
        self._output_index: int | None = None

    def load(self) -> None:
        try:
            import numpy as np
            from ai_edge_litert.interpreter import Interpreter
        except ImportError as exc:  # pragma: no cover - exercised only without the extra
            raise RuntimeError(
                "the birdnet engine requires the 'audio' extra (ai-edge-litert, numpy)"
            ) from exc
        model_path = self.settings.model_path.expanduser()
        if not model_path.is_file():
            raise FileNotFoundError(f"BirdNET model not found: {model_path}")
        interpreter = Interpreter(
            model_content=model_path.read_bytes(),
            num_threads=self.settings.inference_threads,
        )
        interpreter.allocate_tensors()
        input_detail = interpreter.get_input_details()[0]
        output_detail = interpreter.get_output_details()[0]
        shape = [int(value) for value in input_detail["shape"]]
        if shape != [1, self.settings.window_samples]:
            raise RuntimeError(
                f"BirdNET input shape {shape} does not match [1, {self.settings.window_samples}]"
            )
        if input_detail["dtype"] != np.float32:
            raise RuntimeError(f"BirdNET input dtype {input_detail['dtype']} is not float32")
        output_size = int(np.prod(output_detail["shape"]))
        if output_size != len(self.labels):
            raise RuntimeError(f"BirdNET output size {output_size} does not match {len(self.labels)} labels")
        self._np = np
        self._interpreter = interpreter
        self._input_index = int(input_detail["index"])
        self._output_index = int(output_detail["index"])
        self.ready = True
        if self.settings.warmup_on_start:
            self.predict([0.0] * self.settings.window_samples)

    def predict(self, window: Sequence[float]) -> list[float]:
        if not self.ready or self._interpreter is None:
            raise RuntimeError("BirdNET engine is not loaded")
        np = self._np
        samples = np.asarray(window, dtype=np.float32)
        if samples.size != self.settings.window_samples:
            raise ValueError(f"expected {self.settings.window_samples} samples, got {samples.size}")
        with self._lock:
            self._interpreter.set_tensor(self._input_index, samples.reshape(1, -1))
            self._interpreter.invoke()
            logits = self._interpreter.get_tensor(self._output_index)[0]
            scaled = np.clip(logits, -15.0, 15.0) * self.settings.sensitivity
            probabilities = 1.0 / (1.0 + np.exp(-scaled))
        return [float(value) for value in probabilities]

    def metadata(self) -> dict[str, Any]:
        return {
            "model_path": str(self.settings.model_path),
            "model_sha256": self.settings.model_sha256,
            "labels_sha256": self.settings.labels_sha256,
            "window_samples": self.settings.window_samples,
            "sample_rate": self.settings.sample_rate,
            "inference_threads": self.settings.inference_threads,
            "sensitivity": self.settings.sensitivity,
            "runtime": self.backend,
        }

    def close(self) -> None:
        with self._lock:
            self._interpreter = None
            self.ready = False


def build_engine(settings: AudioSettings, labels: Sequence[ModelLabel]) -> AudioEngine:
    if settings.engine_backend == "mock":
        return MockAudioEngine(labels)
    return BirdNetEngine(settings, labels)


def verify_assets(settings: AudioSettings) -> dict[str, str | None]:
    """Recompute the on-disk digests a deployment pins; fail loudly on drift."""
    model_path = settings.model_path.expanduser()
    labels_path = settings.labels_path.expanduser()
    if not model_path.is_file():
        raise FileNotFoundError(f"BirdNET model not found: {model_path}")
    if not labels_path.is_file():
        raise FileNotFoundError(f"BirdNET label file not found: {labels_path}")
    if not settings.verify_asset_hashes:
        return {"model_sha256": settings.model_sha256, "labels_sha256": settings.labels_sha256}
    model_sha = sha256_file(model_path)
    labels_sha = sha256_file(labels_path)
    if settings.model_sha256 and settings.model_sha256.lower() != model_sha:
        raise RuntimeError(
            f"BirdNET model hash mismatch: configured {settings.model_sha256}, on disk {model_sha}"
        )
    if settings.labels_sha256 and settings.labels_sha256.lower() != labels_sha:
        raise RuntimeError(
            f"BirdNET label hash mismatch: configured {settings.labels_sha256}, on disk {labels_sha}"
        )
    return {"model_sha256": model_sha, "labels_sha256": labels_sha}
