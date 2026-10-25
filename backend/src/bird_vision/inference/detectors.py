from __future__ import annotations

import hashlib
import math
import time
from pathlib import Path
from typing import Any, Protocol

from PIL import Image

from bird_vision.config import Settings
from bird_vision.domain import Box, DetectorOutput, RawDetection


class Detector(Protocol):
    name: str
    backend: str
    device: str
    ready: bool

    def load(self) -> None: ...

    def predict(self, image: Image.Image) -> DetectorOutput: ...

    def metadata(self) -> dict[str, Any]: ...

    def close(self) -> None: ...


class MockDetector:
    """Deterministic detector used by local API development and tests."""

    name = "mock-bird-detector"
    backend = "mock"
    device = "cpu"

    def __init__(self) -> None:
        self.ready = False

    def load(self) -> None:
        self.ready = True

    def predict(self, image: Image.Image) -> DetectorOutput:
        width, height = image.size
        box = Box(width * 0.25, height * 0.20, width * 0.75, height * 0.80)
        return DetectorOutput((RawDetection(box=box, score=0.90),), inference_ms=0.1)

    def metadata(self) -> dict[str, Any]:
        return {"purpose": "development-only deterministic output"}

    def close(self) -> None:
        self.ready = False


class YoloDetector:
    name = "yolo-bird-detector"
    backend = "ultralytics-yolo"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.device = settings.device
        self.ready = False
        self._model: Any = None
        self._torch: Any = None
        self._resolved_model_path: str | None = None
        self._model_sha256: str | None = None

    def load(self) -> None:
        self.close()
        try:
            import torch
            from ultralytics import YOLO

            self._torch = torch
            self.device = self._resolve_device(torch)
            model_path = self.settings.model_path.expanduser()
            # Resolve automatic downloads before YOLO deserializes the checkpoint.
            if not model_path.is_file():
                if model_path.parent != Path(".") or model_path.exists():
                    raise FileNotFoundError(f"detector weights not found: {model_path}")
                from ultralytics.utils.downloads import attempt_download_asset

                model_path = Path(attempt_download_asset(str(model_path)))
            if not model_path.is_file():
                raise FileNotFoundError(f"detector weights not found: {model_path}")
            model_path = model_path.resolve()
            from ultralytics.utils.checks import check_yolov5u_filename

            canonical_path = check_yolov5u_filename(str(model_path), verbose=False)
            if canonical_path != str(model_path):
                raise ValueError(f"configure the actual detector checkpoint path: {canonical_path}")
            self._model_sha256 = _sha256(model_path)
            expected = self.settings.model_sha256
            if expected and self._model_sha256.casefold() != expected.casefold():
                raise RuntimeError(
                    f"detector weights SHA-256 mismatch: expected {expected}, got {self._model_sha256}"
                )
            self._resolved_model_path = str(model_path)
            self._model = YOLO(self._resolved_model_path)
            loaded_path = getattr(self._model, "ckpt_path", None)
            if loaded_path and Path(loaded_path).resolve() != model_path:
                raise RuntimeError("YOLO loaded different detector weights than the verified file")
            raw_names = getattr(self._model, "names", {}) or {}
            names = raw_names if isinstance(raw_names, dict) else dict(enumerate(raw_names))
            invalid = [class_id for class_id in self.settings.class_id_list if class_id not in names]
            if invalid:
                raise ValueError(f"detector class IDs do not exist in model metadata: {invalid}")
            unexpected = {
                str(names[class_id]).casefold()
                for class_id in self.settings.class_id_list
                if str(names[class_id]).casefold() not in self.settings.expected_class_name_set
            }
            if unexpected:
                raise ValueError(
                    f"configured detector class IDs are not expected bird classes: {sorted(unexpected)}"
                )
            if self.settings.warmup_on_start:
                warmup_side = (
                    math.ceil(
                        self.settings.model_image_size
                        * self.settings.detection_high_resolution_min_image_ratio
                    )
                    if self.settings.detection_high_resolution_enabled
                    else self.settings.model_image_size
                )
                warmup = Image.new("RGB", (warmup_side, warmup_side))
                try:
                    self.predict(warmup)
                finally:
                    warmup.close()
            self.ready = True
        except Exception:
            self.close()
            raise

    def _resolve_device(self, torch: Any) -> str:
        requested = self.settings.device
        if requested == "auto":
            return "cuda:0" if torch.cuda.is_available() else "cpu"
        if requested == "cuda":
            if not torch.cuda.is_available():
                raise RuntimeError("BIRD_VISION_DEVICE=cuda but torch.cuda.is_available() is false")
            return "cuda:0"
        return "cpu"

    def predict(self, image: Image.Image) -> DetectorOutput:
        if self._model is None:
            raise RuntimeError("detector is not loaded")
        started = time.perf_counter()
        inference_size = self._inference_size(image)
        result = self._model.predict(
            source=image,
            imgsz=inference_size,
            conf=min(self.settings.detection_confidence, self.settings.track_low_confidence),
            iou=self.settings.detection_iou,
            classes=self.settings.class_id_list,
            max_det=self.settings.detection_max_detections,
            device=self.device,
            verbose=False,
        )[0]
        boxes = result.boxes
        detections: list[RawDetection] = []
        if boxes is not None and len(boxes):
            xyxy = boxes.xyxy.detach().cpu().tolist()
            scores = boxes.conf.detach().cpu().tolist()
            classes = boxes.cls.detach().cpu().int().tolist()
            names = getattr(result, "names", {}) or {}
            for coords, score, class_id in zip(xyxy, scores, classes, strict=True):
                detections.append(
                    RawDetection(
                        box=Box(*(float(value) for value in coords)),
                        score=float(score),
                        class_id=int(class_id),
                        class_name=str(names.get(int(class_id), "bird")),
                    )
                )
        speed = getattr(result, "speed", {}) or {}
        elapsed_ms = (time.perf_counter() - started) * 1000
        return DetectorOutput(
            detections=tuple(detections),
            preprocess_ms=float(speed.get("preprocess", 0.0)),
            inference_ms=float(speed.get("inference", elapsed_ms)),
            postprocess_ms=float(speed.get("postprocess", 0.0)),
        )

    def _inference_size(self, image: Image.Image) -> int:
        threshold = (
            self.settings.model_image_size
            * self.settings.detection_high_resolution_min_image_ratio
        )
        if self.settings.detection_high_resolution_enabled and max(image.size) >= threshold:
            return self.settings.detection_high_resolution_image_size
        return self.settings.model_image_size

    def metadata(self) -> dict[str, Any]:
        details: dict[str, Any] = {
            "weights": self._resolved_model_path or str(self.settings.model_path),
            "image_size": self.settings.model_image_size,
            "confidence_threshold": self.settings.detection_confidence,
            "tracking_detection_threshold": min(
                self.settings.detection_confidence, self.settings.track_low_confidence
            ),
            "iou_threshold": self.settings.detection_iou,
            "class_ids": self.settings.class_id_list,
            "expected_class_names": sorted(self.settings.expected_class_name_set),
            "max_detections": self.settings.detection_max_detections,
            "high_resolution": {
                "enabled": self.settings.detection_high_resolution_enabled,
                "image_size": self.settings.detection_high_resolution_image_size,
                "min_image_ratio": self.settings.detection_high_resolution_min_image_ratio,
            },
            "weights_sha256": self._model_sha256,
        }
        if self._torch is not None:
            details["torch_version"] = self._torch.__version__
            details["cuda_version"] = self._torch.version.cuda
            if self.device.startswith("cuda"):
                details["gpu_name"] = self._torch.cuda.get_device_name(0)
        return details

    def close(self) -> None:
        self._model = None
        self._resolved_model_path = None
        self._model_sha256 = None
        self.ready = False
        if self._torch is not None and self.device.startswith("cuda"):
            self._torch.cuda.empty_cache()


def build_detector(settings: Settings) -> Detector:
    if settings.detector_backend == "mock":
        return MockDetector()
    return YoloDetector(settings)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
