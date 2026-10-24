from __future__ import annotations

import asyncio
import time
from contextlib import suppress
from datetime import UTC, datetime
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

import bird_vision.sessions as sessions_module
from bird_vision.domain import Box, FrameJob, RawDetection
from bird_vision.errors import ServiceError
from bird_vision.inference.detectors import MockDetector
from bird_vision.inference.pipeline import VisionPipeline
from bird_vision.inference.species import MockSpeciesProvider
from bird_vision.metrics import Metrics
from bird_vision.sessions import SessionManager


@pytest.fixture
async def manager(test_settings):
    pipeline = VisionPipeline(test_settings, MockDetector(), MockSpeciesProvider())
    instance = SessionManager(test_settings, pipeline, Metrics())
    await instance.start()
    try:
        yield instance
    finally:
        # A cancelled worker can also cancel close(); still finish fixture teardown.
        with suppress(asyncio.CancelledError):
            await asyncio.wait_for(instance.stop(), timeout=3)


@pytest.fixture
async def blocked_inference(manager, monkeypatch):
    started = asyncio.Event()
    finished = asyncio.Event()
    release = Event()
    loop = asyncio.get_running_loop()
    process = manager.pipeline.process

    def blocking_process(**kwargs):
        loop.call_soon_threadsafe(started.set)
        try:
            assert release.wait(timeout=5), "test did not release native inference"
            return process(**kwargs)
        finally:
            loop.call_soon_threadsafe(finished.set)

    monkeypatch.setattr(manager.pipeline, "process", blocking_process)
    try:
        yield started, release, finished
    finally:
        release.set()
        if started.is_set():
            await asyncio.wait_for(finished.wait(), timeout=3)


def make_job(frame_id: str, *, received_monotonic: float | None = None) -> FrameJob:
    return FrameJob(
        frame_id=frame_id,
        image=Image.new("RGB", (64, 48), (80, 120, 60)),
        captured_at=None,
        received_at=datetime.now(UTC),
        received_monotonic=time.monotonic() if received_monotonic is None else received_monotonic,
    )


async def submit(manager, session, job):
    manager.reserve_frame(session.session_id, session.owner_subject, job.frame_id, admitted=True)
    return await manager.submit_reserved(session.session_id, session.owner_subject, job)


async def test_submit_transfers_upload_reservation_to_queued_image(manager) -> None:
    session = await manager.create(owner_subject="caller")
    job = make_job("reserved")
    reservation = manager.begin_upload(session.session_id, session.owner_subject)
    expected = manager.settings.max_image_bytes + manager.settings.max_image_pixels * 16
    try:
        assert reservation.reserved_bytes == expected
        assert manager._buffered_image_bytes == expected
        assert manager.metrics.registry.get_sample_value("bird_vision_buffered_image_bytes") == expected
        manager.reserve_frame(session.session_id, session.owner_subject, job.frame_id, admitted=True)

        assert (
            await manager.submit_reserved(session.session_id, session.owner_subject, job, reservation) is None
        )

        assert reservation.reserved_bytes == 0
        assert manager._buffered_image_bytes == job.decoded_bytes
        assert (
            manager.metrics.registry.get_sample_value("bird_vision_buffered_image_bytes") == job.decoded_bytes
        )
        assert session.pending_frame_ids == set()
        assert session.seen_frame_ids == {job.frame_id}
        assert session.uploading
    finally:
        manager.finish_upload(reservation)

    assert not session.uploading
    assert manager._uploads == []
    assert manager._buffered_image_bytes == job.decoded_bytes
    await manager.close(session.session_id, wait_timeout=None)
    assert manager._buffered_image_bytes == 0
    with pytest.raises(ValueError, match="closed image"):
        job.image.getpixel((0, 0))


async def test_live_session_prefetches_occurrence_cache(manager, monkeypatch) -> None:
    prepare = Mock(return_value={"status": "pending", "source": "gbif", "candidate_count": 0})
    monkeypatch.setattr(manager.pipeline.species, "prepare_occurrence_cache", prepare)
    session = await manager.create(
        owner_subject="caller",
        observation_mode="live",
        latitude=31.8206,
        longitude=117.2272,
    )
    prepare.assert_called_once_with(
        latitude=31.8206,
        longitude=117.2272,
        observed_at=session.created_at,
        time_precision="exact",
    )


async def test_live_session_prefetches_adjacent_month_at_utc_boundary(
    manager, monkeypatch
) -> None:
    class BoundaryDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 31, 23, 59, tzinfo=UTC)

    prepare = Mock(return_value={"status": "pending", "source": "gbif", "candidate_count": 0})
    monkeypatch.setattr(sessions_module, "datetime", BoundaryDateTime)
    monkeypatch.setattr(manager.pipeline.species, "prepare_occurrence_cache", prepare)
    await manager.create(
        owner_subject="caller",
        observation_mode="live",
        latitude=31.8206,
        longitude=117.2272,
    )
    assert prepare.call_count == 2
    assert {call.kwargs["observed_at"].month for call in prepare.call_args_list} == {5, 6}


async def test_occurrence_prepare_limits_each_principal_to_two_pending_keys(
    manager, monkeypatch
) -> None:
    prepare = Mock(return_value={"status": "pending", "source": "gbif", "candidate_count": 0})
    monkeypatch.setattr(manager.pipeline.species, "prepare_occurrence_cache", prepare)
    for month in (5, 6):
        assert manager.prepare_occurrence_cache(
            owner_subject="caller",
            latitude=31.8206,
            longitude=117.2272,
            observed_at=datetime(2026, month, 15, tzinfo=UTC),
            time_precision="exact",
        )["status"] == "pending"
    with pytest.raises(ServiceError) as denied:
        manager.prepare_occurrence_cache(
            owner_subject="caller",
            latitude=31.8206,
            longitude=117.2272,
            observed_at=datetime(2026, 7, 15, tzinfo=UTC),
            time_precision="exact",
        )
    assert denied.value.code == "OCCURRENCE_PREPARE_CAPACITY_EXCEEDED"
    assert denied.value.status_code == 429

    session = await manager.create(
        owner_subject="caller",
        observation_mode="live",
        latitude=40.0,
        longitude=116.0,
    )
    assert session.state == "active"
    assert len(manager._occurrence_prepares["caller"]) == 2


@pytest.mark.parametrize("already_accepted", [False, True], ids=["pending", "accepted"])
async def test_duplicate_frame_reservation_preserves_existing_owner(manager, already_accepted) -> None:
    session = await manager.create(owner_subject="caller")
    manager.reserve_frame(session.session_id, session.owner_subject, "same", admitted=True)
    if already_accepted:
        await manager.submit_reserved(session.session_id, session.owner_subject, make_job("same"))

    with pytest.raises(ServiceError) as denied:
        manager.reserve_frame(session.session_id, session.owner_subject, "same", admitted=True)

    assert denied.value.code == "FRAME_ID_DUPLICATE"
    assert denied.value.status_code == 409
    assert session.pending_frame_ids == (set() if already_accepted else {"same"})
    assert session.seen_frame_ids == ({"same"} if already_accepted else set())


async def test_latest_frame_replacement_closes_image_and_releases_budget(manager, blocked_inference) -> None:
    started, release, _ = blocked_inference
    session = await manager.create(owner_subject="caller")
    events = manager.subscribe(session.session_id, session.owner_subject)
    running, replaced, latest = (make_job(frame_id) for frame_id in ("running", "old", "latest"))
    await submit(manager, session, running)
    await asyncio.wait_for(started.wait(), timeout=2)
    await submit(manager, session, replaced)
    assert manager._buffered_image_bytes == running.decoded_bytes + replaced.decoded_bytes

    assert await submit(manager, session, latest) == replaced.frame_id

    assert manager._buffered_image_bytes == running.decoded_bytes + latest.decoded_bytes
    assert (
        manager.metrics.registry.get_sample_value("bird_vision_buffered_image_bytes")
        == manager._buffered_image_bytes
    )
    with pytest.raises(ValueError, match="closed image"):
        replaced.image.getpixel((0, 0))
    assert latest.image.getpixel((0, 0)) == (80, 120, 60)
    dropped = events.get_nowait()
    events.task_done()
    assert dropped["type"] == "vision.frame.dropped"
    assert dropped["frame_id"] == replaced.frame_id
    assert dropped["reason"] == "replaced_by_newer_frame"

    release.set()
    await asyncio.wait_for(session.queue.join(), timeout=3)
    assert session.stats.accepted_frames == 3
    assert session.stats.processed_frames == 2
    assert session.stats.replaced_frames == 1
    assert manager._buffered_image_bytes == 0


async def test_close_timeout_keeps_native_inference_image_tracker_and_slot_alive(
    manager, blocked_inference
) -> None:
    started, release, finished = blocked_inference
    session = await manager.create(owner_subject="caller")
    now = datetime.now(UTC)
    track = session.tracker.update((RawDetection(Box(1, 1, 30, 30), 0.9),), now)[0]
    crop = Image.new("RGB", (16, 16))
    track.save_best_crop(crop, 1.0, manager.pipeline.crop_budget)
    job = make_job("running")
    await submit(manager, session, job)
    await asyncio.wait_for(started.wait(), timeout=2)

    await manager.close(session.session_id, wait_timeout=0)

    assert session.state == "closing"
    assert session.close_task is not None and not session.close_task.done()
    assert session.task is not None and not session.task.done()
    assert not finished.is_set()
    assert manager._inference_slots.locked()
    assert manager._buffered_image_bytes == job.decoded_bytes
    assert session.tracker._tracks[track.track_id] is track
    assert track.pending_best_crop is crop
    assert manager.pipeline.crop_budget.used == 16 * 16 * 4
    assert crop.getpixel((0, 0)) == (0, 0, 0)
    assert job.image.getpixel((0, 0)) == (80, 120, 60)

    release.set()
    await asyncio.wait_for(asyncio.shield(session.close_task), timeout=3)
    assert finished.is_set()
    assert session.state == "closed"
    assert session.session_id not in manager.sessions
    assert session.tracker._tracks == {}
    assert manager.pipeline.crop_budget.used == 0
    assert manager._buffered_image_bytes == 0
    assert not manager._inference_slots.locked()
    for image in (job.image, crop):
        with pytest.raises(ValueError, match="closed image"):
            image.getpixel((0, 0))


async def test_cancelled_worker_drains_native_inference_before_releasing_resources(
    manager, blocked_inference
) -> None:
    started, release, finished = blocked_inference
    session = await manager.create(owner_subject="caller")
    clear_tracker = Mock(wraps=session.tracker.clear)
    session.tracker.clear = clear_tracker
    job = make_job("cancelled")
    await submit(manager, session, job)
    await asyncio.wait_for(started.wait(), timeout=2)
    assert session.task is not None

    session.task.cancel()
    cancellation_delivered = asyncio.Event()
    asyncio.get_running_loop().call_soon(cancellation_delivered.set)
    await cancellation_delivered.wait()

    assert not session.task.done()
    assert not finished.is_set()
    assert manager._inference_slots.locked()
    assert manager._buffered_image_bytes == job.decoded_bytes
    assert job.image.getpixel((0, 0)) == (80, 120, 60)
    clear_tracker.assert_not_called()

    release.set()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(asyncio.shield(session.task), timeout=3)
    await asyncio.wait_for(session.queue.join(), timeout=2)
    assert finished.is_set()
    assert not manager._inference_slots.locked()
    assert manager._buffered_image_bytes == 0
    with pytest.raises(ValueError, match="closed image"):
        job.image.getpixel((0, 0))

    await manager.close(session.session_id, wait_timeout=None)
    clear_tracker.assert_called_once_with()
    assert session.session_id not in manager.sessions
    assert session.state == "closed"


async def test_inference_timeout_marks_not_ready_but_drains_native_work(manager, blocked_inference) -> None:
    started, release, finished = blocked_inference
    manager.settings.inference_timeout_seconds = 0.02
    session = await manager.create(owner_subject="caller")
    events = manager.subscribe(session.session_id, session.owner_subject)
    job = make_job("timed-out")
    await submit(manager, session, job)
    await asyncio.wait_for(started.wait(), timeout=2)
    await asyncio.sleep(0.03)

    assert not manager.ready
    assert manager.last_inference_error == "InferenceTimeout"
    assert not finished.is_set()
    assert manager._buffered_image_bytes == job.decoded_bytes
    assert job.image.getpixel((0, 0)) == (80, 120, 60)

    release.set()
    await asyncio.wait_for(session.queue.join(), timeout=3)
    assert session.stats.failed_frames == 1
    assert manager._buffered_image_bytes == 0
    event = events.get_nowait()
    events.task_done()
    assert event["type"] == "vision.frame.error"
    assert event["details"]["error_type"] == "TimeoutError"


async def test_frame_expires_while_waiting_for_inference_semaphore(manager, monkeypatch) -> None:
    waiting = asyncio.Event()

    class ObservedSemaphore(asyncio.Semaphore):
        async def acquire(self):
            waiting.set()
            return await super().acquire()

    clock = 1000.0
    monkeypatch.setattr(
        sessions_module, "time", SimpleNamespace(monotonic=lambda: clock, perf_counter=time.perf_counter)
    )
    manager._inference_slots = ObservedSemaphore(0)
    process = Mock(side_effect=AssertionError("stale frame reached native inference"))
    monkeypatch.setattr(manager.pipeline, "process", process)
    session = await manager.create(owner_subject="caller")
    events = manager.subscribe(session.session_id, session.owner_subject)
    job = make_job("stale-after-wait", received_monotonic=clock)
    await submit(manager, session, job)
    await asyncio.wait_for(waiting.wait(), timeout=2)

    clock += manager.settings.frame_max_queue_age_ms / 1000 + 1
    manager._inference_slots.release()
    await asyncio.wait_for(session.queue.join(), timeout=2)

    process.assert_not_called()
    assert session.stats.stale_frames == 1
    assert session.stats.failed_frames == 0
    assert session.stats.processed_frames == 0
    assert manager._buffered_image_bytes == 0
    event = events.get_nowait()
    events.task_done()
    assert event["frame_id"] == job.frame_id
    assert event["reason"] == "stale_in_queue"
    assert event["details"]["queue_ms"] > manager.settings.frame_max_queue_age_ms
    with pytest.raises(ValueError, match="closed image"):
        job.image.getpixel((0, 0))


async def test_subscriber_quota_is_released_on_unsubscribe_and_close(manager) -> None:
    manager.settings.max_subscribers_per_session = 1
    session = await manager.create(owner_subject="caller")
    first = manager.subscribe(session.session_id, session.owner_subject)

    with pytest.raises(ServiceError) as denied:
        manager.subscribe(session.session_id, session.owner_subject)
    assert denied.value.code == "SUBSCRIBER_CAPACITY_EXCEEDED"
    assert denied.value.status_code == 429
    assert session.subscribers == {first}
    assert manager.metrics.registry.get_sample_value("bird_vision_websocket_subscribers") == 1

    manager.unsubscribe(session.session_id, first)
    manager.unsubscribe(session.session_id, first)
    assert manager.metrics.registry.get_sample_value("bird_vision_websocket_subscribers") == 0
    replacement = manager.subscribe(session.session_id, session.owner_subject)
    assert replacement is not first
    await manager.close(session.session_id, wait_timeout=None)
    assert replacement.get_nowait()["type"] == "vision.session.closed"
    replacement.task_done()
    assert session.subscribers == set()
    assert manager.metrics.registry.get_sample_value("bird_vision_websocket_subscribers") == 0


async def test_shutdown_waits_for_upload_and_rejects_new_admissions(manager) -> None:
    session = await manager.create(owner_subject="caller")
    entered = asyncio.Event()
    release = asyncio.Event()

    async def upload():
        reservation = manager.begin_upload(session.session_id, session.owner_subject)
        entered.set()
        try:
            await release.wait()
        finally:
            manager.finish_upload(reservation)

    uploading = asyncio.create_task(upload())
    await asyncio.wait_for(entered.wait(), timeout=2)
    stopping = asyncio.create_task(manager.stop())
    stop_started = asyncio.Event()
    asyncio.get_running_loop().call_soon(stop_started.set)
    await stop_started.wait()
    try:
        assert manager._closing
        assert not stopping.done()
        assert not uploading.done()
        assert session.state == "active"
        assert session.uploading
        assert manager._buffered_image_bytes > 0
        with pytest.raises(ServiceError) as denied:
            manager.begin_upload(session.session_id, session.owner_subject)
        assert denied.value.code == "SERVICE_STOPPING"
        with pytest.raises(ServiceError) as denied:
            await manager.create(owner_subject="caller")
        assert denied.value.code == "SERVICE_STOPPING"
    finally:
        release.set()
        await asyncio.wait_for(asyncio.gather(uploading, stopping), timeout=3)

    assert session.state == "closed"
    assert manager.sessions == {}
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0
    assert manager.metrics.registry.get_sample_value("bird_vision_buffered_image_bytes") == 0
