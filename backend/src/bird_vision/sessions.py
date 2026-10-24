from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from bird_vision.config import Settings
from bird_vision.domain import FrameJob
from bird_vision.errors import ServiceError, SessionNotFoundError
from bird_vision.inference.pipeline import VisionPipeline
from bird_vision.metrics import Metrics
from bird_vision.schemas import SessionResponse, SessionStats, StatusEvent
from bird_vision.tracking import TrackManager

LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class MutableStats:
    accepted_frames: int = 0
    processed_frames: int = 0
    replaced_frames: int = 0
    stale_frames: int = 0
    failed_frames: int = 0

    def schema(self) -> SessionStats:
        return SessionStats(**asdict(self))


@dataclass(slots=True)
class UploadReservation:
    session_id: str
    reserved_bytes: int
    task: asyncio.Task[Any]


@dataclass(slots=True)
class VisionSession:
    session_id: str
    client_session_id: str | None
    owner_subject: str
    created_at: datetime
    last_activity_at: datetime
    observation_mode: Literal["live", "historical"]
    latitude: float | None
    longitude: float | None
    region_code: str | None
    coordinates_used_for_inference: bool
    tracker: TrackManager
    queue: asyncio.Queue[FrameJob | None] = field(default_factory=lambda: asyncio.Queue(maxsize=1))
    subscribers: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)
    stats: MutableStats = field(default_factory=MutableStats)
    state: str = "active"
    last_accepted_monotonic: float | None = None
    seen_frame_ids: set[str] = field(default_factory=set)
    pending_frame_ids: set[str] = field(default_factory=set)
    task: asyncio.Task[None] | None = None
    close_task: asyncio.Task[None] | None = None
    uploading: bool = False

    def response(self) -> SessionResponse:
        return SessionResponse(
            session_id=self.session_id,
            client_session_id=self.client_session_id,
            state=self.state,
            created_at=self.created_at,
            last_activity_at=self.last_activity_at,
            observation_mode=self.observation_mode,
            latitude=self.latitude,
            longitude=self.longitude,
            region_code=self.region_code,
            stats=self.stats.schema(),
            coordinates_used_for_inference=self.coordinates_used_for_inference,
        )


class SessionManager:
    def __init__(self, settings: Settings, pipeline: VisionPipeline, metrics: Metrics) -> None:
        self.settings = settings
        self.pipeline = pipeline
        self.metrics = metrics
        self.sessions: dict[str, VisionSession] = {}
        self._inference_slots = asyncio.Semaphore(settings.max_concurrent_inference)
        self._uploads: list[UploadReservation] = []
        self._cleanup_task: asyncio.Task[None] | None = None
        self._closing = False
        self._buffered_image_bytes = 0
        self.inference_healthy = True
        self.last_inference_error: str | None = None

    async def start(self) -> None:
        self._cleanup_task = asyncio.create_task(self._cleanup_loop(), name="vision-session-cleanup")

    async def stop(self) -> None:
        self._closing = True
        if self._cleanup_task:
            self._cleanup_task.cancel()
            await asyncio.gather(self._cleanup_task, return_exceptions=True)
        await asyncio.gather(
            *(asyncio.shield(item.task) for item in list(self._uploads)),
            return_exceptions=True,
        )
        await asyncio.gather(
            *(
                self.close(session_id, "service_shutdown", wait_timeout=None)
                for session_id in list(self.sessions)
            )
        )

    async def create(
        self,
        *,
        owner_subject: str,
        client_session_id: str | None = None,
        observation_mode: Literal["live", "historical"] = "live",
        latitude: float | None = None,
        longitude: float | None = None,
        region_code: str | None = None,
    ) -> VisionSession:
        if self._closing:
            raise ServiceError("SERVICE_STOPPING", "service is shutting down", 503)
        if len(self.sessions) >= self.settings.max_sessions:
            raise ServiceError("SESSION_CAPACITY_EXCEEDED", "too many active sessions", 503)
        principal_sessions = sum(
            session.owner_subject == owner_subject and session.state != "closed"
            for session in self.sessions.values()
        )
        if principal_sessions >= self.settings.max_sessions_per_principal:
            raise ServiceError(
                "PRINCIPAL_SESSION_CAPACITY_EXCEEDED",
                "caller has too many active sessions",
                429,
                {"max_sessions_per_principal": self.settings.max_sessions_per_principal},
            )
        now = datetime.now(UTC)
        session_id = f"vs_{uuid.uuid4().hex}"
        session = VisionSession(
            session_id=session_id,
            client_session_id=client_session_id,
            owner_subject=owner_subject,
            created_at=now,
            last_activity_at=now,
            observation_mode=observation_mode,
            latitude=latitude,
            longitude=longitude,
            region_code=region_code or self.settings.species_default_region_code,
            coordinates_used_for_inference=self.pipeline.species.coordinates_supported(
                latitude, longitude
            ),
            tracker=self.pipeline.new_tracker(),
        )
        session.task = asyncio.create_task(self._worker(session), name=f"vision-session-{session_id}")
        self.sessions[session_id] = session
        self.metrics.active_sessions.set(len(self.sessions))
        return session

    def get(self, session_id: str, owner_subject: str | None = None) -> VisionSession:
        session = self.sessions.get(session_id)
        if session is None or session.state != "active":
            raise SessionNotFoundError(session_id)
        if owner_subject is not None and session.owner_subject != owner_subject:
            # Deliberately do not reveal whether another caller owns the ID.
            raise SessionNotFoundError(session_id)
        return session

    @property
    def ready(self) -> bool:
        return not self._closing and self.inference_healthy

    def begin_upload(self, session_id: str, owner_subject: str) -> UploadReservation:
        if self._closing:
            raise ServiceError("SERVICE_STOPPING", "service is shutting down", 503)
        session = self.get(session_id, owner_subject)
        if session.uploading:
            raise ServiceError("FRAME_UPLOAD_IN_PROGRESS", "session already has an upload in progress", 429)
        self._check_frame_rate(session)
        if len(self._uploads) >= self.settings.max_concurrent_decodes:
            raise ServiceError("DECODE_CAPACITY_EXCEEDED", "too many active frame uploads", 503)
        # Source, EXIF transform and RGB conversion can coexist. Reserve before
        # multipart parsing, including compressed bytes and transient pixel copies.
        reserved_bytes = self.settings.max_image_bytes + self.settings.max_image_pixels * 16
        self._check_image_capacity(reserved_bytes)
        reservation = UploadReservation(session_id, reserved_bytes, asyncio.current_task())
        self._uploads.append(reservation)
        session.uploading = True
        session.last_accepted_monotonic = time.monotonic()
        session.last_activity_at = datetime.now(UTC)
        self._buffered_image_bytes += reserved_bytes
        self.metrics.buffered_image_bytes.set(self._buffered_image_bytes)
        return reservation

    def finish_upload(self, reservation: UploadReservation) -> None:
        self._uploads.remove(reservation)
        self._buffered_image_bytes -= reservation.reserved_bytes
        reservation.reserved_bytes = 0
        session = self.sessions.get(reservation.session_id)
        if session is not None:
            session.uploading = False
        self.metrics.buffered_image_bytes.set(self._buffered_image_bytes)

    def _check_image_capacity(self, requested: int) -> None:
        if self._buffered_image_bytes + requested > self.settings.max_buffered_image_bytes:
            raise ServiceError(
                "IMAGE_BUFFER_CAPACITY_EXCEEDED",
                "image memory capacity is exhausted; retry later",
                503,
                {"max_buffered_image_bytes": self.settings.max_buffered_image_bytes},
            )

    def _check_frame_rate(self, session: VisionSession) -> None:
        if session.last_accepted_monotonic is not None:
            interval = time.monotonic() - session.last_accepted_monotonic
            if interval < 1.0 / self.settings.max_frame_rate:
                raise ServiceError(
                    "FRAME_RATE_EXCEEDED",
                    "frames are arriving faster than the session limit",
                    429,
                    {"max_frame_rate": self.settings.max_frame_rate},
                )

    def reserve_frame(
        self, session_id: str, owner_subject: str, frame_id: str, *, admitted: bool = False
    ) -> VisionSession:
        """Reserve a frame ID and admission slot before reading or decoding its body."""
        session = self.get(session_id, owner_subject)
        if frame_id in session.seen_frame_ids or frame_id in session.pending_frame_ids:
            raise ServiceError(
                "FRAME_ID_DUPLICATE",
                "frame_id has already been accepted in this session",
                409,
                {"frame_id": frame_id},
            )
        frame_count = len(session.seen_frame_ids) + len(session.pending_frame_ids)
        if frame_count >= self.settings.max_frames_per_session:
            raise ServiceError(
                "SESSION_FRAME_CAPACITY_EXCEEDED",
                "session has reached its frame limit; create a new session",
                409,
                {"max_frames_per_session": self.settings.max_frames_per_session},
            )
        if not admitted:
            self._check_frame_rate(session)
            session.last_accepted_monotonic = time.monotonic()
        session.last_activity_at = datetime.now(UTC)
        session.pending_frame_ids.add(frame_id)
        return session

    def abort_frame(self, session_id: str, owner_subject: str, frame_id: str) -> None:
        session = self.sessions.get(session_id)
        if session is not None and session.owner_subject == owner_subject:
            session.pending_frame_ids.discard(frame_id)

    async def submit_reserved(
        self,
        session_id: str,
        owner_subject: str,
        job: FrameJob,
        reservation: UploadReservation | None = None,
    ) -> str | None:
        session = self.get(session_id, owner_subject)
        if job.frame_id not in session.pending_frame_ids:
            raise ServiceError("FRAME_RESERVATION_MISSING", "frame reservation is no longer active", 409)
        reserved_bytes = reservation.reserved_bytes if reservation is not None else 0
        self._check_image_capacity(job.decoded_bytes - reserved_bytes)
        if reservation is not None:
            self._buffered_image_bytes -= reserved_bytes
            reservation.reserved_bytes = 0
        session.pending_frame_ids.remove(job.frame_id)
        session.seen_frame_ids.add(job.frame_id)
        session.stats.accepted_frames += 1
        self.metrics.frames.labels("accepted").inc()

        replaced: FrameJob | None = None
        if session.queue.full():
            replaced = session.queue.get_nowait()
            session.queue.task_done()
            if replaced is not None:
                self._release_image(replaced)
                session.stats.replaced_frames += 1
                self.metrics.frames.labels("replaced").inc()
        self._buffered_image_bytes += job.decoded_bytes
        self.metrics.buffered_image_bytes.set(self._buffered_image_bytes)
        session.queue.put_nowait(job)
        if replaced:
            await self._publish(
                session,
                self._status_event(
                    session,
                    "vision.frame.dropped",
                    frame_id=replaced.frame_id,
                    reason="replaced_by_newer_frame",
                ),
            )
        return replaced.frame_id if replaced else None

    async def close(
        self,
        session_id: str,
        reason: str = "client_closed",
        *,
        wait_timeout: float | None = 30.0,
    ) -> None:
        session = self.sessions.get(session_id)
        if session is None or session.state == "closed":
            return
        if session.close_task is None:
            session.state = "closing"
            if session.queue.full():
                queued = session.queue.get_nowait()
                session.queue.task_done()
                if queued is not None:
                    self._release_image(queued)
                    session.stats.replaced_frames += 1
            session.queue.put_nowait(None)
            session.close_task = asyncio.create_task(
                self._finish_close(session, reason),
                name=f"vision-session-close-{session_id}",
            )
        if wait_timeout is None:
            await session.close_task
        else:
            try:
                await asyncio.wait_for(asyncio.shield(session.close_task), timeout=wait_timeout)
            except TimeoutError:
                # Native CUDA work started via to_thread cannot be cancelled safely.
                # The close task owns final cleanup and will finish after inference returns.
                LOGGER.error("session worker is still stopping", extra={"session_id": session_id})

    async def _finish_close(self, session: VisionSession, reason: str) -> None:
        if session.task:
            await asyncio.gather(session.task, return_exceptions=True)
        session.tracker.clear()
        self.metrics.saved_crop_bytes.set(self.pipeline.crop_budget.used)
        session.state = "closed"
        await self._publish(session, self._status_event(session, "vision.session.closed", reason=reason))
        session.subscribers.clear()
        self.metrics.websocket_subscribers.set(sum(len(item.subscribers) for item in self.sessions.values()))
        self.sessions.pop(session.session_id, None)
        self.metrics.active_sessions.set(len(self.sessions))

    @staticmethod
    async def _drain_native_task(task: asyncio.Task[Any]) -> None:
        """Wait through repeated cancellation without leaking native thread work."""
        current = asyncio.current_task()
        while not task.done():
            if current is not None:
                while current.cancelling():
                    current.uncancel()
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if not task.cancelled():
            task.exception()

    def subscribe(self, session_id: str, owner_subject: str) -> asyncio.Queue[dict[str, Any]]:
        session = self.get(session_id, owner_subject)
        if len(session.subscribers) >= self.settings.max_subscribers_per_session:
            raise ServiceError(
                "SUBSCRIBER_CAPACITY_EXCEEDED",
                "session has too many event subscribers",
                429,
                {"max_subscribers_per_session": self.settings.max_subscribers_per_session},
            )
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self.settings.subscriber_queue_size)
        session.subscribers.add(queue)
        self.metrics.websocket_subscribers.set(sum(len(item.subscribers) for item in self.sessions.values()))
        return queue

    def unsubscribe(self, session_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        session = self.sessions.get(session_id)
        if session:
            session.subscribers.discard(queue)
            self.metrics.websocket_subscribers.set(
                sum(len(item.subscribers) for item in self.sessions.values())
            )

    async def _worker(self, session: VisionSession) -> None:
        while True:
            job = await session.queue.get()
            if job is None:
                session.queue.task_done()
                break
            try:
                queue_ms = (time.monotonic() - job.received_monotonic) * 1000
                if queue_ms > self.settings.frame_max_queue_age_ms:
                    session.stats.stale_frames += 1
                    self.metrics.frames.labels("stale").inc()
                    await self._publish(
                        session,
                        self._status_event(
                            session,
                            "vision.frame.dropped",
                            frame_id=job.frame_id,
                            reason="stale_in_queue",
                            details={"queue_ms": round(queue_ms, 3)},
                        ),
                    )
                    continue
                async with self._inference_slots:
                    if session.state != "active":
                        continue
                    queue_ms = (time.monotonic() - job.received_monotonic) * 1000
                    if queue_ms > self.settings.frame_max_queue_age_ms:
                        session.stats.stale_frames += 1
                        self.metrics.frames.labels("stale").inc()
                        await self._publish(
                            session,
                            self._status_event(
                                session,
                                "vision.frame.dropped",
                                frame_id=job.frame_id,
                                reason="stale_in_queue",
                                details={"queue_ms": round(queue_ms, 3)},
                            ),
                        )
                        continue
                    inference_started = time.perf_counter()
                    inference = asyncio.create_task(
                        asyncio.to_thread(
                            self.pipeline.process,
                            session_id=session.session_id,
                            job=job,
                            tracker=session.tracker,
                            queue_ms=queue_ms,
                            decode_ms=job.decode_ms,
                        )
                    )
                    try:
                        result = await asyncio.wait_for(
                            asyncio.shield(inference),
                            timeout=self.settings.inference_timeout_seconds,
                        )
                    except TimeoutError as timeout:
                        self.inference_healthy = False
                        self.last_inference_error = "InferenceTimeout"
                        LOGGER.error(
                            "inference exceeded its deadline; waiting for native work to finish",
                            extra={"session_id": session.session_id, "frame_id": job.frame_id},
                        )
                        await self._drain_native_task(inference)
                        raise TimeoutError("inference exceeded its deadline") from timeout
                    except asyncio.CancelledError as cancellation:
                        # Cancellation cannot stop native inference. Drain it
                        # before releasing its image, tracker or model resources.
                        await self._drain_native_task(inference)
                        raise cancellation
                    self.metrics.inference_latency.observe(time.perf_counter() - inference_started)
                    self.inference_healthy = True
                    self.last_inference_error = None
                    self.metrics.saved_crop_bytes.set(self.pipeline.crop_budget.used)
                session.stats.processed_frames += 1
                session.last_activity_at = datetime.now(UTC)
                self.metrics.frames.labels("processed").inc()
                for track in result.tracks:
                    self.metrics.species_results.labels(track.species.state).inc()
                await self._publish(session, result.model_dump(mode="json"))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # keep the realtime session alive after one bad frame
                LOGGER.exception(
                    "frame processing failed",
                    extra={"session_id": session.session_id, "frame_id": job.frame_id},
                )
                session.stats.failed_frames += 1
                self.metrics.frames.labels("failed").inc()
                if isinstance(exc, RuntimeError):
                    self.inference_healthy = False
                    self.last_inference_error = type(exc).__name__
                await self._publish(
                    session,
                    self._status_event(
                        session,
                        "vision.frame.error",
                        frame_id=job.frame_id,
                        reason="inference_failed",
                        details={"error_type": type(exc).__name__},
                    ),
                )
            finally:
                self._release_image(job)
                session.queue.task_done()

    def _release_image(self, job: FrameJob) -> None:
        self._buffered_image_bytes = max(0, self._buffered_image_bytes - job.decoded_bytes)
        job.image.close()
        self.metrics.buffered_image_bytes.set(self._buffered_image_bytes)
        self.metrics.saved_crop_bytes.set(self.pipeline.crop_budget.used)

    async def _publish(self, session: VisionSession, event: dict[str, Any]) -> None:
        dead: list[asyncio.Queue[dict[str, Any]]] = []
        for queue in session.subscribers:
            if queue.full():
                try:
                    queue.get_nowait()
                    queue.task_done()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(queue)
        for queue in dead:
            session.subscribers.discard(queue)

    def _status_event(
        self,
        session: VisionSession,
        event_type: str,
        *,
        frame_id: str | None = None,
        reason: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return StatusEvent(
            type=event_type,
            event_id=f"evt_{uuid.uuid4().hex}",
            occurred_at=datetime.now(UTC),
            session_id=session.session_id,
            frame_id=frame_id,
            reason=reason,
            details=details or {},
        ).model_dump(mode="json")

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(min(30, max(1, self.settings.session_idle_ttl_seconds // 3)))
            now = datetime.now(UTC)
            expired = [
                session_id
                for session_id, session in self.sessions.items()
                if (now - session.last_activity_at).total_seconds() > self.settings.session_idle_ttl_seconds
            ]
            for session_id in expired:
                await self.close(session_id, "idle_timeout")
