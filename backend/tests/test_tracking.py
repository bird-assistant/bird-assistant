from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from PIL import Image

import bird_vision.tracking as tracking_module
from bird_vision.domain import Box, RawDetection
from bird_vision.tracking import ByteTrackAdapter, IoUTracker, build_tracker, intersection_over_union


def test_intersection_over_union() -> None:
    assert intersection_over_union(Box(0, 0, 10, 10), Box(5, 5, 15, 15)) == 25 / 175
    assert intersection_over_union(Box(0, 0, 10, 10), Box(20, 20, 30, 30)) == 0


def test_track_id_is_stable_and_expired() -> None:
    tracker = IoUTracker(iou_threshold=0.3, max_missed_frames=1)
    now = datetime.now(UTC)
    first = tracker.update((RawDetection(Box(10, 10, 100, 100), 0.9),), now)
    second = tracker.update((RawDetection(Box(12, 12, 102, 102), 0.8),), now + timedelta(milliseconds=200))
    assert first[0].track_id == second[0].track_id
    assert second[0].hits == 2

    tracker.update(tuple(), now + timedelta(seconds=1))
    tracker.update(tuple(), now + timedelta(seconds=2))
    third = tracker.update((RawDetection(Box(10, 10, 100, 100), 0.9),), now + timedelta(seconds=3))
    assert third[0].track_id != first[0].track_id


def test_motion_prediction_keeps_ids_when_birds_cross() -> None:
    tracker = IoUTracker(iou_threshold=0.1, max_missed_frames=2)
    now = datetime.now(UTC)
    first = tracker.update(
        (
            RawDetection(Box(0, 0, 20, 20), 0.9),
            RawDetection(Box(80, 0, 100, 20), 0.9),
        ),
        now,
    )
    tracker.update(
        (
            RawDetection(Box(25, 0, 45, 20), 0.9),
            RawDetection(Box(55, 0, 75, 20), 0.9),
        ),
        now + timedelta(milliseconds=100),
    )
    crossed = tracker.update(
        (
            RawDetection(Box(50, 0, 70, 20), 0.9),
            RawDetection(Box(30, 0, 50, 20), 0.9),
        ),
        now + timedelta(milliseconds=200),
    )
    assert first[0].track_id == crossed[0].track_id
    assert crossed[0].box.x1 == 50
    assert first[1].track_id == crossed[1].track_id
    assert crossed[1].box.x1 == 30


def test_motion_velocity_is_per_frame_after_an_occlusion() -> None:
    tracker = IoUTracker(iou_threshold=0.1, max_missed_frames=2)
    now = datetime.now(UTC)
    first = tracker.update((RawDetection(Box(0, 0, 20, 20), 0.9),), now)[0]
    tracker.update(tuple(), now + timedelta(milliseconds=100))
    recovered = tracker.update(
        (RawDetection(Box(20, 0, 40, 20), 0.9),),
        now + timedelta(milliseconds=200),
    )[0]
    assert recovered.track_id == first.track_id
    assert recovered.velocity_x == 10


def test_motion_tracker_returns_predicted_track_during_short_miss() -> None:
    tracker = IoUTracker(iou_threshold=0.1, max_missed_frames=2)
    now = datetime.now(UTC)
    tracker.update((RawDetection(Box(0, 0, 20, 20), 0.9),), now)
    tracker.update((RawDetection(Box(10, 0, 30, 20), 0.9),), now + timedelta(milliseconds=100))

    predicted = tracker.update(tuple(), now + timedelta(milliseconds=200))

    assert len(predicted) == 1
    assert predicted[0].missed_frames == 1
    assert predicted[0].predicted_box == Box(20, 0, 40, 20)


def test_tracker_releases_a_saved_crop_when_a_track_expires() -> None:
    tracker = IoUTracker(iou_threshold=0.3, max_missed_frames=0)
    now = datetime.now(UTC)
    track = tracker.update((RawDetection(Box(0, 0, 20, 20), 0.9),), now)[0]
    crop = Image.new("RGB", (8, 8))
    track.save_best_crop(crop, 0.5)

    tracker.update(tuple(), now + timedelta(milliseconds=100))

    with pytest.raises(ValueError):
        crop.load()
    assert tracker._tracks == {}


def test_expired_track_is_not_returned_for_one_extra_frame() -> None:
    tracker = IoUTracker(iou_threshold=0.3, max_missed_frames=0)
    now = datetime.now(UTC)
    tracker.update((RawDetection(Box(0, 0, 20, 20), 0.9),), now)

    assert tracker.update(tuple(), now + timedelta(milliseconds=100)) == []


def test_auto_tracker_uses_motion_without_yolo_extras() -> None:
    settings = SimpleNamespace(
        tracker_backend="auto",
        detector_backend="mock",
        environment="test",
        track_iou_threshold=0.3,
        track_max_missed_frames=2,
        track_high_confidence=0.25,
        track_low_confidence=0.1,
        track_center_distance_threshold=1.5,
    )

    tracker = build_tracker(settings)

    assert isinstance(tracker, IoUTracker)


def test_production_motion_tracker_is_rejected() -> None:
    settings = SimpleNamespace(
        tracker_backend="motion",
        detector_backend="yolo",
        environment="production",
    )

    with pytest.raises(ValueError, match="production requires"):
        build_tracker(settings)


def test_bytetrack_adapter_has_an_independent_backend_per_session(monkeypatch) -> None:
    instances = []

    class FakeByteTracker:
        def __init__(self, args, frame_rate=30):
            self.args = args
            self.frame_rate = frame_rate
            instances.append(self)

    monkeypatch.setattr(tracking_module, "_load_bytetrack_backend", lambda: FakeByteTracker)
    first = ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=5,
        high_confidence=0.25,
        low_confidence=0.1,
    )
    second = ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=5,
        high_confidence=0.25,
        low_confidence=0.1,
    )

    assert first._backend is not second._backend
    assert first._backend.args.track_low_thresh == 0.1
    assert first._backend.args.track_high_thresh == 0.25
    assert first._backend.args.track_buffer == 5
    assert first._backend.args.match_thresh == 0.7


def test_bytetrack_current_api_uses_frame_count_buffer(monkeypatch) -> None:
    class CurrentByteTracker:
        def __init__(self, args):
            self.args = args

    monkeypatch.setattr(tracking_module, "_load_bytetrack_backend", lambda: CurrentByteTracker)
    adapter = ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=5,
        high_confidence=0.25,
        low_confidence=0.1,
        frame_rate=5,
    )
    assert adapter._backend.args.track_buffer == 5


def test_bytetrack_sessions_cannot_reset_process_id_counter(monkeypatch) -> None:
    numpy = pytest.importorskip("numpy")

    class Counter:
        _count = 0

    class FakeByteTracker:
        def __init__(self, args):
            Counter._count = 0

        def update(self, results):
            Counter._count += 1
            return numpy.asarray([[0, 0, 20, 20, Counter._count, 0.9, 14, 0]], dtype=float)

    monkeypatch.setattr(tracking_module, "_BYTETRACK_ID_HIGH_WATER", 0)
    monkeypatch.setattr(tracking_module, "_load_bytetrack_backend", lambda: FakeByteTracker)
    monkeypatch.setattr(tracking_module, "_load_bytetrack_id_counter", lambda: Counter)
    first = ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=5,
        high_confidence=0.25,
        low_confidence=0.1,
    )
    detection = (RawDetection(Box(0, 0, 20, 20), 0.9),)
    now = datetime.now(UTC)
    assert first.update(detection, now)[0].track_id == 1
    ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=5,
        high_confidence=0.25,
        low_confidence=0.1,
    )
    updated = first.update(detection, now)
    assert [track.track_id for track in updated if track.missed_frames == 0] == [2]


def test_bytetrack_adapter_maps_ids_and_preserves_track_state(monkeypatch) -> None:
    numpy = pytest.importorskip("numpy")

    class FakeByteTracker:
        def __init__(self, args, frame_rate=30):
            self.outputs = []
            self.expected_confidence_orders = [[0.2, 0.9], [0.9, 0.2]]

        def update(self, results):
            assert results.conf.tolist() == self.expected_confidence_orders.pop(0)
            return self.outputs.pop(0)

    monkeypatch.setattr(tracking_module, "_load_bytetrack_backend", lambda: FakeByteTracker)
    adapter = ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=0,
        high_confidence=0.25,
        low_confidence=0.1,
    )
    adapter._backend.outputs.extend(
        [
            numpy.asarray([[0, 0, 20, 20, 42, 0.9, 14, 0]], dtype=float),
            numpy.asarray([[2, 0, 22, 20, 42, 0.9, 14, 0]], dtype=float),
        ]
    )
    now = datetime.now(UTC)
    first = adapter.update(
        (
            RawDetection(Box(50, 0, 70, 20), 0.2),
            RawDetection(Box(0, 0, 20, 20), 0.9),
            RawDetection(Box(100, 0, 120, 20), 0.05),
        ),
        now,
    )[0]
    first.pending_best_quality = 0.7
    second = adapter.update(
        (
            RawDetection(Box(2, 0, 22, 20), 0.9),
            RawDetection(Box(50, 0, 70, 20), 0.2),
        ),
        now + timedelta(milliseconds=100),
    )[0]

    assert first is second
    assert second.track_id == 42
    assert second.hits == 2
    assert second.pending_best_quality == 0.7
    assert second.box.x1 == 2
    assert second.detection_score == 0.9


def test_bytetrack_adapter_releases_crop_when_backend_removes_track(monkeypatch) -> None:
    numpy = pytest.importorskip("numpy")

    class FakeByteTracker:
        def __init__(self, args, frame_rate=30):
            self.outputs = [numpy.asarray([[0, 0, 20, 20, 42, 0.9, 14, 0]], dtype=float), numpy.empty((0, 8))]
            self.removed_stracks = []

        def update(self, results):
            output = self.outputs.pop(0)
            if output.size == 0:
                self.removed_stracks = [SimpleNamespace(track_id=42)]
            return output

    monkeypatch.setattr(tracking_module, "_load_bytetrack_backend", lambda: FakeByteTracker)
    adapter = ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=0,
        high_confidence=0.25,
        low_confidence=0.1,
    )
    now = datetime.now(UTC)
    track = adapter.update((RawDetection(Box(0, 0, 20, 20), 0.9),), now)[0]
    crop = Image.new("RGB", (8, 8))
    track.save_best_crop(crop, 0.5)

    adapter.update(tuple(), now + timedelta(milliseconds=100))

    with pytest.raises(ValueError):
        crop.load()
    assert adapter._tracks == {}


def test_bytetrack_adapter_returns_predicted_track_during_short_miss(monkeypatch) -> None:
    numpy = pytest.importorskip("numpy")

    class FakeByteTracker:
        def __init__(self, args, frame_rate=30):
            self.outputs = [
                numpy.asarray([[0, 0, 20, 20, 42, 0.9, 14, 0]], dtype=float),
                numpy.asarray([[10, 0, 30, 20, 42, 0.9, 14, 0]], dtype=float),
                numpy.empty((0, 8)),
            ]

        def update(self, results):
            return self.outputs.pop(0)

    monkeypatch.setattr(tracking_module, "_load_bytetrack_backend", lambda: FakeByteTracker)
    adapter = ByteTrackAdapter(
        iou_threshold=0.3,
        max_missed_frames=2,
        high_confidence=0.25,
        low_confidence=0.1,
    )
    now = datetime.now(UTC)
    adapter.update((RawDetection(Box(0, 0, 20, 20), 0.9),), now)
    adapter.update((RawDetection(Box(10, 0, 30, 20), 0.9),), now + timedelta(milliseconds=100))

    predicted = adapter.update(tuple(), now + timedelta(milliseconds=200))

    assert len(predicted) == 1
    assert predicted[0].missed_frames == 1
    assert predicted[0].predicted_box == Box(20, 0, 40, 20)


def test_auto_yolo_selects_bytetrack_factory(monkeypatch) -> None:
    class FakeAdapter:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    settings = SimpleNamespace(
        tracker_backend="auto",
        detector_backend="yolo",
        environment="production",
        track_iou_threshold=0.3,
        track_max_missed_frames=5,
        track_high_confidence=0.25,
        track_low_confidence=0.1,
        track_center_distance_threshold=1.5,
        max_frame_rate=5.0,
    )
    monkeypatch.setattr(tracking_module, "ByteTrackAdapter", FakeAdapter)

    tracker = build_tracker(settings)

    assert isinstance(tracker, FakeAdapter)
    assert tracker.kwargs["low_confidence"] == 0.1
