from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from threading import Lock
from typing import Literal

from PIL import Image


class CropMemoryBudget:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0
        self._lock = Lock()

    def replace(self, previous: int, requested: int) -> bool:
        with self._lock:
            if self.used - previous + requested > self.limit:
                return False
            self.used += requested - previous
            return True


@dataclass(frozen=True, slots=True)
class Box:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def width(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def height(self) -> float:
        return max(0.0, self.y2 - self.y1)

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def short_side(self) -> float:
        return min(self.width, self.height)

    def normalized(self, width: int, height: int) -> tuple[float, float, float, float]:
        return (
            min(max(self.x1 / width, 0.0), 1.0),
            min(max(self.y1 / height, 0.0), 1.0),
            min(max(self.x2 / width, 0.0), 1.0),
            min(max(self.y2 / height, 0.0), 1.0),
        )


@dataclass(frozen=True, slots=True)
class RawDetection:
    box: Box
    score: float
    class_id: int = 14
    class_name: str = "bird"


@dataclass(frozen=True, slots=True)
class DetectorOutput:
    detections: tuple[RawDetection, ...]
    preprocess_ms: float = 0.0
    inference_ms: float = 0.0
    postprocess_ms: float = 0.0


@dataclass(frozen=True, slots=True)
class SpeciesCandidate:
    species_id: str
    scientific_name: str
    common_name_zh: str | None
    common_name_en: str | None
    score: float
    score_type: Literal["relative_similarity", "mock"] = "relative_similarity"
    similarity: float | None = None
    region_match: bool = False


@dataclass(frozen=True, slots=True)
class SpeciesPrediction:
    candidates: tuple[SpeciesCandidate, ...]
    accepted: bool
    reason: str
    top_similarity: float | None
    margin: float | None
    candidate_count: int
    region_code: str | None
    catalog_version: str | None


@dataclass(slots=True)
class Track:
    track_id: int
    box: Box
    detection_score: float
    first_seen_at: datetime
    last_seen_at: datetime
    hits: int = 1
    missed_frames: int = 0
    velocity_x: float = 0.0
    velocity_y: float = 0.0
    detection_class_id: int = 14
    detection_class_name: str = "bird"
    best_quality: float = 0.0
    last_classified_quality: float = 0.0
    last_classified_monotonic: float | None = None
    species_candidates: tuple[SpeciesCandidate, ...] = field(default_factory=tuple)
    species_model: str | None = None
    species_prediction: SpeciesPrediction | None = None
    species_history: list[SpeciesPrediction] = field(default_factory=list)
    pending_best_crop: Image.Image | None = None
    pending_best_quality: float = 0.0
    crop_budget: CropMemoryBudget | None = field(default=None, repr=False)
    crop_bytes: int = 0

    def save_best_crop(
        self, crop: Image.Image, quality: float, budget: CropMemoryBudget | None = None
    ) -> None:
        """Keep one owned crop until the next classification attempt."""
        size = crop.width * crop.height * 4
        if budget is not None and not budget.replace(self.crop_bytes, size):
            crop.close()
            return
        previous = self.pending_best_crop
        self.pending_best_crop = crop
        self.pending_best_quality = quality
        self.crop_budget = budget
        self.crop_bytes = size if budget is not None else 0
        if previous is not None and previous is not crop:
            previous.close()

    def release_best_crop(self) -> None:
        crop = self.pending_best_crop
        self.pending_best_crop = None
        self.pending_best_quality = 0.0
        if self.crop_budget is not None:
            self.crop_budget.replace(self.crop_bytes, 0)
        self.crop_budget = None
        self.crop_bytes = 0
        if crop is not None:
            crop.close()


@dataclass(frozen=True, slots=True)
class FrameJob:
    frame_id: str
    image: Image.Image
    captured_at: datetime | None
    received_at: datetime
    received_monotonic: float
    decode_ms: float = 0.0
    latitude: float | None = None
    longitude: float | None = None
    region_code: str | None = None

    @property
    def decoded_bytes(self) -> int:
        width, height = self.image.size
        # Pillow stores RGB pixels in four-byte internal blocks.
        return width * height * 4
