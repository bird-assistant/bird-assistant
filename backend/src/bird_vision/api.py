from __future__ import annotations

import asyncio
import math
import time
import uuid
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Query,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException
from starlette.requests import Request as StarletteRequest

from bird_vision.auth import Principal, require_principal
from bird_vision.domain import FrameJob
from bird_vision.errors import ServiceError
from bird_vision.images import decode_image
from bird_vision.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    FrameAcceptedResponse,
    HealthResponse,
    ModelInfo,
    ReadyResponse,
    SessionResponse,
    SpeciesCatalogInfo,
    SpeciesCatalogItem,
    SpeciesCatalogPage,
)


class FrameAdmissionRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        if self.path != "/api/v1/vision/sessions/{session_id}/frames":
            return handler

        async def admitted(request: Request):
            manager = request.app.state.sessions
            principal = request.app.state.auth.verify_request(request)
            reservation = manager.begin_upload(request.path_params["session_id"], principal.subject)
            limit = request.app.state.settings.max_image_bytes + 64 * 1024
            received = 0

            async def limited_receive():
                nonlocal received
                message = await request.receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > limit:
                        raise ServiceError("IMAGE_TOO_LARGE", "multipart upload exceeds the byte limit", 413)
                return message

            bounded = StarletteRequest(request.scope, limited_receive)
            bounded.state.upload_reservation = reservation
            try:
                content_length = request.headers.get("content-length")
                if content_length:
                    try:
                        length = int(content_length)
                    except ValueError as exc:
                        raise ServiceError("INVALID_CONTENT_LENGTH", "invalid Content-Length", 422) from exc
                    if length < 0 or length > limit:
                        raise ServiceError("IMAGE_TOO_LARGE", "multipart upload exceeds the byte limit", 413)
                try:
                    async with asyncio.timeout(manager.settings.upload_timeout_seconds):
                        await bounded.form(max_files=1, max_fields=5, max_part_size=1024)
                except TimeoutError as exc:
                    raise ServiceError("UPLOAD_TIMEOUT", "frame upload timed out", 408) from exc
                except HTTPException as exc:
                    raise ServiceError("INVALID_MULTIPART", "invalid frame multipart body", 422) from exc
                return await handler(bounded)
            finally:
                await bounded.close()
                manager.finish_upload(reservation)

        return admitted


router = APIRouter(route_class=FrameAdmissionRoute)


@router.get("/healthz", response_model=HealthResponse, tags=["operations"])
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        service=settings.service_name,
        version=settings.service_version,
        timestamp=datetime.now(UTC),
    )


@router.get("/readyz", response_model=ReadyResponse, tags=["operations"])
async def readiness(request: Request) -> Response:
    detector = request.app.state.detector
    species = request.app.state.species
    sessions = request.app.state.sessions
    models = [
        ModelInfo(
            name=detector.name,
            backend=detector.backend,
            device=detector.device,
            ready=detector.ready,
        ),
        ModelInfo(
            name=species.name,
            backend=species.backend,
            device=species.device,
            ready=species.ready,
        ),
        ModelInfo(
            name="inference-runtime",
            backend="session-manager",
            device=detector.device,
            ready=sessions.ready,
            details={"last_error": sessions.last_inference_error},
        ),
    ]
    ready = all(model.ready for model in models)
    if request.app.state.settings.environment == "production":
        ready = ready and (
            detector.backend == "ultralytics-yolo"
            and species.backend == "open-clip"
            and detector.device.startswith("cuda")
            and species.device.startswith("cuda")
        )
    body = ReadyResponse(status="ready" if ready else "not_ready", models=models)
    return JSONResponse(status_code=200 if ready else 503, content=body.model_dump(mode="json"))


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request, _: Annotated[Principal, Depends(require_principal)]) -> Response:
    return Response(request.app.state.metrics.render(), media_type="text/plain; version=0.0.4")


@router.get("/api/v1/models", response_model=list[ModelInfo], tags=["models"])
async def models(request: Request, _: Annotated[Principal, Depends(require_principal)]) -> list[ModelInfo]:
    detector = request.app.state.detector
    species = request.app.state.species
    return [
        ModelInfo(
            name=detector.name,
            backend=detector.backend,
            device=detector.device,
            ready=detector.ready,
            details=detector.metadata(),
        ),
        ModelInfo(
            name=species.name,
            backend=species.backend,
            device=species.device,
            ready=species.ready,
            details=species.metadata(),
        ),
    ]


@router.get(
    "/api/v1/species/catalog/info",
    response_model=SpeciesCatalogInfo,
    tags=["species catalog"],
)
async def species_catalog_info(
    request: Request,
    _: Annotated[Principal, Depends(require_principal)],
) -> SpeciesCatalogInfo:
    return SpeciesCatalogInfo.model_validate(request.app.state.species.catalog_info())


@router.get(
    "/api/v1/species/catalog",
    response_model=SpeciesCatalogPage,
    tags=["species catalog"],
)
async def search_species_catalog(
    request: Request,
    _: Annotated[Principal, Depends(require_principal)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    region_code: Annotated[str | None, Query(min_length=2, max_length=2)] = None,
    enabled_only: bool = True,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> SpeciesCatalogPage:
    if region_code is not None:
        region_code = region_code.upper()
        if len(region_code) != 2 or not region_code.isascii() or not region_code.isalpha():
            raise ServiceError(
                "INVALID_REGION_CODE",
                "region_code must be an ISO 3166-1 alpha-2 code",
                422,
            )
    provider = request.app.state.species
    total, taxa = provider.search_catalog(
        query=q,
        region_code=region_code,
        enabled_only=enabled_only,
        offset=offset,
        limit=limit,
    )
    return SpeciesCatalogPage(
        total=total,
        offset=offset,
        limit=limit,
        items=[
            SpeciesCatalogItem(
                species_id=taxon.species_id,
                scientific_name=taxon.scientific_name,
                common_name_zh=taxon.common_name_zh,
                common_name_en=taxon.common_name_en,
                order=taxon.order,
                family=taxon.family,
                ebird_code=taxon.ebird_code,
                avibase_id=taxon.avibase_id,
                region_codes=sorted(taxon.region_codes),
                extinction_status=taxon.extinction_status,
                iucn_status=taxon.iucn_status,
                enabled=taxon.enabled,
            )
            for taxon in taxa
        ],
    )


@router.post(
    "/api/v1/vision/sessions",
    response_model=CreateSessionResponse,
    status_code=201,
    tags=["realtime vision"],
)
async def create_session(
    payload: CreateSessionRequest,
    request: Request,
    principal: Annotated[Principal, Depends(require_principal)],
) -> CreateSessionResponse:
    manager = request.app.state.sessions
    session = await manager.create(
        owner_subject=principal.subject,
        client_session_id=payload.client_session_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        region_code=payload.region_code,
    )
    interval_ms = math.ceil(1000.0 / request.app.state.settings.max_frame_rate)
    catalog_version = request.app.state.species.catalog_info().get("version")
    return CreateSessionResponse(
        session_id=session.session_id,
        created_at=session.created_at,
        expires_after_idle_seconds=request.app.state.settings.session_idle_ttl_seconds,
        recommended_frame_interval_ms=interval_ms,
        websocket_path=f"/api/v1/vision/sessions/{session.session_id}/events",
        region_code=session.region_code,
        catalog_version=catalog_version,
    )


@router.get(
    "/api/v1/vision/sessions/{session_id}",
    response_model=SessionResponse,
    tags=["realtime vision"],
)
async def get_session(
    session_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_principal)],
) -> SessionResponse:
    return request.app.state.sessions.get(session_id, principal.subject).response()


@router.delete(
    "/api/v1/vision/sessions/{session_id}",
    status_code=204,
    tags=["realtime vision"],
)
async def delete_session(
    session_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_principal)],
) -> Response:
    request.app.state.sessions.get(session_id, principal.subject)
    await request.app.state.sessions.close(session_id)
    return Response(status_code=204)


@router.post(
    "/api/v1/vision/sessions/{session_id}/frames",
    response_model=FrameAcceptedResponse,
    status_code=202,
    tags=["realtime vision"],
)
async def submit_frame(
    session_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_principal)],
    frame_id: Annotated[
        str,
        Form(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    ],
    frame: Annotated[UploadFile, File(description="JPEG, PNG or WebP image")],
    captured_at: Annotated[datetime | None, Form()] = None,
    latitude: Annotated[float | None, Form(ge=-90.0, le=90.0)] = None,
    longitude: Annotated[float | None, Form(ge=-180.0, le=180.0)] = None,
) -> FrameAcceptedResponse:
    settings = request.app.state.settings
    if captured_at is not None and captured_at.utcoffset() is None:
        raise ServiceError(
            "CAPTURED_AT_TIMEZONE_REQUIRED",
            "captured_at must include a UTC offset",
            422,
        )
    now = datetime.now(UTC)
    if captured_at is not None:
        skew = abs((captured_at.astimezone(UTC) - now).total_seconds())
        if skew > settings.max_capture_clock_skew_seconds:
            raise ServiceError(
                "CAPTURED_AT_CLOCK_SKEW",
                "captured_at differs too far from server time",
                422,
                {"max_skew_seconds": settings.max_capture_clock_skew_seconds},
            )
    manager = request.app.state.sessions
    session = manager.reserve_frame(session_id, principal.subject, frame_id, admitted=True)
    committed = False
    image = None
    try:
        data = await frame.read(settings.max_image_bytes + 1)
        loop = asyncio.get_running_loop()
        decode_finished = asyncio.Event()
        ownership_lock = Lock()
        ownership: dict[str, object] = {"abandoned": False}

        def owned_decode():
            try:
                result = decode_image(data, frame.content_type, settings)
                with ownership_lock:
                    if ownership["abandoned"]:
                        result[0].close()
                    else:
                        ownership["result"] = result
                return result
            finally:
                loop.call_soon_threadsafe(decode_finished.set)

        decoding = asyncio.create_task(asyncio.to_thread(owned_decode))
        try:
            image, decode_ms = await asyncio.shield(decoding)
            with ownership_lock:
                ownership.pop("result", None)
        except asyncio.CancelledError as cancellation:
            current = asyncio.current_task()
            with ownership_lock:
                ownership["abandoned"] = True
                retained = ownership.pop("result", None)
                if retained is not None:
                    retained[0].close()
            # A cancelled to_thread Task may be done while its native thread is
            # still running. Keep admission until that thread has closed any
            # unclaimed image, despite repeated middleware cancellation.
            while not decode_finished.is_set():
                if current is not None:
                    current.uncancel()
                try:
                    await asyncio.shield(decode_finished.wait())
                except asyncio.CancelledError:
                    continue
            raise cancellation
        request.app.state.metrics.decode_latency.observe(decode_ms / 1000.0)
        job = FrameJob(
            frame_id=frame_id,
            image=image,
            captured_at=captured_at,
            received_at=now,
            received_monotonic=time.monotonic(),
            decode_ms=decode_ms,
            latitude=latitude,
            longitude=longitude,
            region_code=session.region_code,
        )
        replaced = await manager.submit_reserved(
            session_id, principal.subject, job, request.state.upload_reservation
        )
        committed = True
    finally:
        await frame.close()
        if not committed:
            if image is not None:
                image.close()
            manager.abort_frame(session_id, principal.subject, frame_id)
    return FrameAcceptedResponse(
        session_id=session_id,
        frame_id=frame_id,
        replaced_frame_id=replaced,
    )


@router.websocket("/api/v1/vision/sessions/{session_id}/events")
async def session_events(websocket: WebSocket, session_id: str) -> None:
    try:
        principal = websocket.app.state.auth.verify_websocket(websocket)
        session = websocket.app.state.sessions.get(session_id, principal.subject)
        queue = websocket.app.state.sessions.subscribe(session_id, principal.subject)
    except ServiceError as exc:
        code = 4401 if exc.status_code == 401 else 4429 if exc.status_code == 429 else 4404
        await websocket.close(code=code, reason=exc.code)
        return
    try:
        await websocket.accept()
        await websocket.send_json(
            {
                "type": "vision.session.started",
                "event_id": f"evt_{uuid.uuid4().hex}",
                "occurred_at": datetime.now(UTC).isoformat(),
                "session_id": session.session_id,
                "details": {
                    "recommended_frame_interval_ms": math.ceil(
                        1000.0 / websocket.app.state.settings.max_frame_rate
                    ),
                    "region_code": session.region_code,
                    "catalog_version": websocket.app.state.species.catalog_info().get("version"),
                },
            }
        )
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15.0)
            except TimeoutError:
                await websocket.send_json(
                    {
                        "type": "vision.heartbeat",
                        "event_id": f"evt_{uuid.uuid4().hex}",
                        "occurred_at": datetime.now(UTC).isoformat(),
                        "session_id": session_id,
                    }
                )
                continue
            try:
                await websocket.send_json(event)
            finally:
                queue.task_done()
            if event.get("type") == "vision.session.closed":
                break
    except WebSocketDisconnect:
        pass
    finally:
        websocket.app.state.sessions.unsubscribe(session_id, queue)
