from __future__ import annotations

import inspect
from datetime import datetime
from threading import Lock
from types import SimpleNamespace
from typing import Any, Protocol

from bird_vision.domain import Box, RawDetection, Track

_BYTETRACK_ID_LOCK = Lock()
_BYTETRACK_ID_HIGH_WATER = 0


def intersection_over_union(left: Box, right: Box) -> float:
    x1 = max(left.x1, right.x1)
    y1 = max(left.y1, right.y1)
    x2 = min(left.x2, right.x2)
    y2 = min(left.y2, right.y2)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = left.area + right.area - intersection
    return intersection / union if union > 0.0 else 0.0


def _center(box: Box) -> tuple[float, float]:
    return ((box.x1 + box.x2) / 2.0, (box.y1 + box.y2) / 2.0)


def _shift(box: Box, dx: float, dy: float) -> Box:
    return Box(box.x1 + dx, box.y1 + dy, box.x2 + dx, box.y2 + dy)


class TrackManager(Protocol):
    def update(self, detections: tuple[RawDetection, ...], observed_at: datetime) -> list[Track]: ...

    def clear(self) -> None: ...


class MotionTracker:
    """Per-session, two-stage motion/IoU tracker.

    Constant-velocity prediction avoids the most common identity swap caused
    by matching only the last box. Lower-confidence detections can maintain an
    existing track, but never create a new one.

    This is motion-only tracking. If two birds overlap or disappear and their
    predicted positions become indistinguishable, identity cannot be
    guaranteed without appearance or detector-level re-identification
    features.
    """

    def __init__(
        self,
        iou_threshold: float,
        max_missed_frames: int,
        high_confidence: float = 0.5,
        low_confidence: float = 0.1,
        center_distance_threshold: float = 1.5,
    ) -> None:
        self.iou_threshold = iou_threshold
        self.max_missed_frames = max_missed_frames
        self.high_confidence = high_confidence
        self.low_confidence = low_confidence
        self.center_distance_threshold = center_distance_threshold
        self._next_id = 1
        self._tracks: dict[int, Track] = {}

    def update(self, detections: tuple[RawDetection, ...], observed_at: datetime) -> list[Track]:
        matched_tracks: set[int] = set()
        matched_detections: set[int] = set()
        visible: list[Track] = []

        high = {index for index, item in enumerate(detections) if item.score >= self.high_confidence}
        low = {
            index
            for index, item in enumerate(detections)
            if self.low_confidence <= item.score < self.high_confidence
        }
        self._associate(detections, high, matched_tracks, matched_detections, visible, observed_at)
        self._associate(detections, low, matched_tracks, matched_detections, visible, observed_at)

        for detection_index, detection in enumerate(detections):
            if detection_index in matched_detections or detection.score < self.high_confidence:
                continue
            track = Track(
                track_id=self._next_id,
                box=detection.box,
                detection_score=detection.score,
                first_seen_at=observed_at,
                last_seen_at=observed_at,
                detection_class_id=detection.class_id,
                detection_class_name=detection.class_name,
            )
            self._tracks[track.track_id] = track
            self._next_id += 1
            matched_tracks.add(track.track_id)
            visible.append(track)

        for track_id, track in self._tracks.items():
            if track_id not in matched_tracks:
                track.missed_frames += 1
        self._expire_tracks()
        return sorted(visible, key=lambda track: track.track_id)

    def _associate(
        self,
        detections: tuple[RawDetection, ...],
        candidates: set[int],
        matched_tracks: set[int],
        matched_detections: set[int],
        visible: list[Track],
        observed_at: datetime,
    ) -> None:
        pairs: list[tuple[float, float, float, int, int]] = []
        for track_id, track in self._tracks.items():
            if track_id in matched_tracks:
                continue
            predicted = _shift(
                track.box,
                track.velocity_x * (track.missed_frames + 1),
                track.velocity_y * (track.missed_frames + 1),
            )
            predicted_center = _center(predicted)
            scale = max(1.0, (predicted.width**2 + predicted.height**2) ** 0.5)
            for detection_index in candidates:
                detection = detections[detection_index]
                if detection.class_id != track.detection_class_id:
                    continue
                iou = intersection_over_union(predicted, detection.box)
                detection_center = _center(detection.box)
                distance = (
                    (predicted_center[0] - detection_center[0]) ** 2
                    + (predicted_center[1] - detection_center[1]) ** 2
                ) ** 0.5 / scale
                if iou < self.iou_threshold and distance > self.center_distance_threshold:
                    continue
                affinity = iou + 0.25 * max(0.0, 1.0 - distance / self.center_distance_threshold)
                pairs.append((affinity, iou, distance, track_id, detection_index))
        # Prefer the strongest geometric match, then the closest prediction.
        # IDs make ambiguous ties deterministic and reproducible in tests.
        pairs.sort(key=lambda item: (-item[0], -item[1], item[2], item[3], item[4]))
        for _, _, _, track_id, detection_index in pairs:
            if track_id in matched_tracks or detection_index in matched_detections:
                continue
            track = self._tracks[track_id]
            detection = detections[detection_index]
            previous_center = _center(track.box)
            current_center = _center(detection.box)
            frame_gap = track.missed_frames + 1
            dx = (current_center[0] - previous_center[0]) / frame_gap
            dy = (current_center[1] - previous_center[1]) / frame_gap
            if track.hits == 1:
                track.velocity_x = dx
                track.velocity_y = dy
            else:
                track.velocity_x = 0.65 * track.velocity_x + 0.35 * dx
                track.velocity_y = 0.65 * track.velocity_y + 0.35 * dy
            track.box = detection.box
            track.detection_score = detection.score
            track.last_seen_at = observed_at
            track.hits += 1
            track.missed_frames = 0
            matched_tracks.add(track_id)
            matched_detections.add(detection_index)
            visible.append(track)

    def clear(self) -> None:
        self._expire_tracks()
        for track in self._tracks.values():
            track.release_best_crop()
        self._tracks.clear()

    def _expire_tracks(self) -> None:
        expired = [
            track_id
            for track_id, track in self._tracks.items()
            if track.missed_frames > self.max_missed_frames
        ]
        for track_id in expired:
            self._tracks[track_id].release_best_crop()
            del self._tracks[track_id]


def _load_bytetrack_backend() -> type[Any]:
    """Import Ultralytics only when a session explicitly selects ByteTrack."""
    try:
        from ultralytics.trackers.byte_tracker import BYTETracker
    except (ImportError, ModuleNotFoundError) as exc:
        raise RuntimeError(
            "ByteTrack requires the optional Ultralytics tracking extras; "
            "install the GPU/test extras or select tracker_backend=motion"
        ) from exc
    return BYTETracker


def _load_bytetrack_id_counter() -> type[Any] | None:
    try:
        from ultralytics.trackers.basetrack import BaseTrack
    except (ImportError, ModuleNotFoundError):
        return None
    return BaseTrack


class _ByteTrackResults:
    """Small Results-compatible input accepted by Ultralytics BYTETracker."""

    def __init__(self, boxes: Any, scores: Any, class_ids: Any, indices: Any) -> None:
        import numpy as np

        self.xyxy = np.asarray(boxes, dtype=float).reshape((-1, 4))
        self.conf = np.asarray(scores, dtype=float).reshape((-1,))
        self.cls = np.asarray(class_ids, dtype=float).reshape((-1,))
        self.idx = np.asarray(indices, dtype=float).reshape((-1,))
        self.is_track = False

    @property
    def xywh(self) -> Any:
        import numpy as np

        boxes = self.xyxy
        centers = (boxes[:, :2] + boxes[:, 2:]) / 2.0
        sizes = boxes[:, 2:] - boxes[:, :2]
        return np.concatenate((centers, sizes), axis=1)

    def __len__(self) -> int:
        return len(self.xyxy)

    def __getitem__(self, selection: Any) -> _ByteTrackResults:
        return _ByteTrackResults(
            self.xyxy[selection],
            self.conf[selection],
            self.cls[selection],
            self.idx[selection],
        )


class ByteTrackAdapter:
    """Per-session adapter from Ultralytics BYTETracker to our Track model.

    ByteTrack improves motion/IoU association through high- and low-score
    detection stages, but it does not provide appearance re-identification.
    Severe overlap or long occlusion can still swap two visually identical
    birds.
    """

    def __init__(
        self,
        *,
        iou_threshold: float,
        max_missed_frames: int,
        high_confidence: float,
        low_confidence: float,
        frame_rate: float = 30.0,
    ) -> None:
        BYTETracker = _load_bytetrack_backend()
        self.high_confidence = high_confidence
        self.low_confidence = low_confidence
        self.max_missed_frames = max_missed_frames
        self._tracks: dict[int, Track] = {}
        self._id_counter = _load_bytetrack_id_counter()
        supports_frame_rate = "frame_rate" in inspect.signature(BYTETracker).parameters
        track_buffer = (
            round(max_missed_frames * 30 / max(1.0, frame_rate)) if supports_frame_rate else max_missed_frames
        )
        args = SimpleNamespace(
            track_high_thresh=high_confidence,
            track_low_thresh=low_confidence,
            new_track_thresh=high_confidence,
            track_buffer=max(0, track_buffer),
            match_thresh=max(0.0, min(1.0, 1.0 - iou_threshold)),
            fuse_score=True,
        )
        # Ultralytics versions through 8.4 use one process-global ID counter
        # and reset it in every BYTETracker constructor. Preserve a process
        # high-water mark so creating a second session cannot inject duplicate
        # IDs into an already active first session.
        global _BYTETRACK_ID_HIGH_WATER
        with _BYTETRACK_ID_LOCK:
            if supports_frame_rate:
                self._backend = BYTETracker(args, frame_rate=max(1, round(frame_rate)))
            else:
                self._backend = BYTETracker(args)
            if self._id_counter is not None:
                self._id_counter._count = max(
                    int(getattr(self._id_counter, "_count", 0)), _BYTETRACK_ID_HIGH_WATER
                )

    def update(self, detections: tuple[RawDetection, ...], observed_at: datetime) -> list[Track]:
        import numpy as np

        eligible = [
            (index, detection)
            for index, detection in enumerate(detections)
            if detection.score >= self.low_confidence
        ]
        results = _ByteTrackResults(
            [
                (detection.box.x1, detection.box.y1, detection.box.x2, detection.box.y2)
                for _, detection in eligible
            ],
            [detection.score for _, detection in eligible],
            [detection.class_id for _, detection in eligible],
            [index for index, _ in eligible],
        )
        global _BYTETRACK_ID_HIGH_WATER
        with _BYTETRACK_ID_LOCK:
            if self._id_counter is not None:
                self._id_counter._count = max(
                    int(getattr(self._id_counter, "_count", 0)), _BYTETRACK_ID_HIGH_WATER
                )
            output = self._backend.update(results)
            if self._id_counter is not None:
                _BYTETRACK_ID_HIGH_WATER = max(
                    _BYTETRACK_ID_HIGH_WATER,
                    int(getattr(self._id_counter, "_count", 0)),
                )
        rows = np.asarray(output, dtype=float)
        if rows.size == 0:
            rows = np.empty((0, 5), dtype=float)
        elif rows.ndim == 1:
            rows = rows.reshape((1, -1))

        visible: list[Track] = []
        active_ids: set[int] = set()
        used_detection_indexes: set[int] = set()
        for row in rows:
            if len(row) < 5:
                continue
            track_id = int(round(float(row[4])))
            if track_id in active_ids:
                continue
            box = Box(*(float(value) for value in row[:4]))
            # BYTETracker's output idx is local to its confidence split.
            # Geometry plus class maps back to the original detections safely.
            detection_index = self._match_detection(
                box,
                eligible,
                used_detection_indexes,
                int(round(float(row[6]))) if len(row) > 6 else None,
            )
            detection = detections[detection_index] if detection_index is not None else None
            if detection is None:
                score = float(row[5]) if len(row) > 5 else self.high_confidence
                class_id = int(round(float(row[6]))) if len(row) > 6 else 14
                class_name = "bird"
            else:
                used_detection_indexes.add(detection_index)
                score = detection.score
                class_id = detection.class_id
                class_name = detection.class_name

            track = self._tracks.get(track_id)
            if track is None:
                track = Track(
                    track_id=track_id,
                    box=box,
                    detection_score=score,
                    first_seen_at=observed_at,
                    last_seen_at=observed_at,
                    detection_class_id=class_id,
                    detection_class_name=class_name,
                )
                self._tracks[track_id] = track
            else:
                track.box = box
                track.detection_score = score
                track.last_seen_at = observed_at
                track.detection_class_id = class_id
                track.detection_class_name = class_name
                track.hits += 1
                track.missed_frames = 0
            active_ids.add(track_id)
            visible.append(track)

        for track_id, track in self._tracks.items():
            if track_id not in active_ids:
                track.missed_frames += 1
        self._expire_tracks()
        return sorted(visible, key=lambda track: track.track_id)

    def _match_detection(
        self,
        box: Box,
        eligible: list[tuple[int, RawDetection]],
        used_detection_indexes: set[int],
        class_id: int | None,
    ) -> int | None:
        candidates = (
            (intersection_over_union(box, detection.box), detection.score, -index, index)
            for index, detection in eligible
            if index not in used_detection_indexes and (class_id is None or detection.class_id == class_id)
        )
        best_iou, _, _, best_index = max(candidates, default=(0.0, 0.0, 0, None))
        return best_index if best_iou > 0.0 else None

    def clear(self) -> None:
        for track in self._tracks.values():
            track.release_best_crop()
        self._tracks.clear()
        reset = getattr(self._backend, "reset", None)
        if reset is not None:
            global _BYTETRACK_ID_HIGH_WATER
            with _BYTETRACK_ID_LOCK:
                reset()
                if self._id_counter is not None:
                    self._id_counter._count = _BYTETRACK_ID_HIGH_WATER

    def _expire_tracks(self) -> None:
        expired = [
            track_id
            for track_id, track in self._tracks.items()
            if track.missed_frames > self.max_missed_frames
        ]
        for track_id in expired:
            self._tracks[track_id].release_best_crop()
            del self._tracks[track_id]


def build_tracker(settings: Any) -> TrackManager:
    """Build the configured tracker without importing optional GPU packages."""
    configured = getattr(settings, "tracker_backend", "auto")
    detector_backend = getattr(settings, "detector_backend", "mock")
    backend = "bytetrack" if configured == "auto" and detector_backend == "yolo" else configured
    if backend == "auto":
        backend = "motion"
    if getattr(settings, "environment", "development") == "production" and backend == "motion":
        raise ValueError("production requires tracker_backend=bytetrack")
    if backend == "motion":
        return MotionTracker(
            iou_threshold=settings.track_iou_threshold,
            max_missed_frames=settings.track_max_missed_frames,
            high_confidence=settings.track_high_confidence,
            low_confidence=settings.track_low_confidence,
            center_distance_threshold=settings.track_center_distance_threshold,
        )
    if backend == "bytetrack":
        return ByteTrackAdapter(
            iou_threshold=settings.track_iou_threshold,
            max_missed_frames=settings.track_max_missed_frames,
            high_confidence=settings.track_high_confidence,
            low_confidence=settings.track_low_confidence,
            frame_rate=getattr(settings, "max_frame_rate", 30.0),
        )
    raise ValueError(f"unsupported tracker backend: {backend}")


# Compatibility for callers from the first implementation.
IoUTracker = MotionTracker
