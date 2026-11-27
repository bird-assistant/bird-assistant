from __future__ import annotations

import asyncio
import http.client
import json
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, File, Form, Request, UploadFile
from fastapi.routing import APIRoute
from starlette.requests import Request as StarletteRequest

from bird_business.config import BusinessSettings
from bird_business.dongniao import Dongniao, multipart
from bird_common.app_factory import build_service_app
from bird_common.catalog import load_catalog
from bird_common.errors import ServiceError
from bird_common.mobile_auth import MobileAuth
from bird_vision.images import decode_image

PHOTO_PATH = "/api/v1/vision/analyses"
REVIEW_REASONS = {
    "ambiguous_candidates",
    "below_similarity_threshold",
    "subject_below_minimum_size",
    "species_backend_disabled",
    "no_bird_detected",
}


class ImageLimits:
    max_image_bytes = 6 * 1024 * 1024
    max_image_pixels = 3840 * 2160


class UploadRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def admitted(request: Request):
            request.app.state.auth.verify_request(request)
            if not request.app.state.capacity.acquire(blocking=False):
                raise ServiceError("PHOTO_REVIEW_BUSY", "photo gateway busy", 429)
            received = 0

            async def receive():
                nonlocal received
                message = await request.receive()
                received += len(message.get("body", b""))
                if received > ImageLimits.max_image_bytes + 65536:
                    raise ServiceError("IMAGE_TOO_LARGE", "multipart upload too large", 413)
                return message

            try:
                return await handler(StarletteRequest(request.scope, receive))
            finally:
                request.app.state.capacity.release()

        return admitted


def overlap(first: dict, second: dict) -> float:
    def area(box):
        return (box["x2"] - box["x1"]) * (box["y2"] - box["y1"])

    width = max(0.0, min(first["x2"], second["x2"]) - max(first["x1"], second["x1"]))
    height = max(0.0, min(first["y2"], second["y2"]) - max(first["y1"], second["y1"]))
    intersection = width * height
    return intersection / (area(first) + area(second) - intersection)


def merge_subjects(local: list, external: list) -> list:
    if not local:
        return external
    result = list(local)
    pairs = sorted(
        (
            (overlap(subject["bbox"], bird["bbox"]), index, other)
            for index, subject in enumerate(local)
            for other, bird in enumerate(external)
        ),
        reverse=True,
    )
    matched_local, matched_external = set(), set()
    for score, index, other in pairs:
        if score < 0.25 or index in matched_local or other in matched_external:
            continue
        matched_local.add(index)
        matched_external.add(other)
        if local[index]["state"] == "unknown" and external[other]["candidates"]:
            result[index] = {
                **local[index],
                "state": "candidate",
                "reason": "dongniao_review",
                "local_candidates": local[index]["candidates"],
                "candidates": external[other]["candidates"],
            }
    return result


class PhotoGateway:
    def __init__(self, vendor: Dongniao):
        self.vendor = vendor
        self.gpu_slot = threading.BoundedSemaphore(1)

    def primary(self, data, mime, fields, headers):
        if not self.gpu_slot.acquire(blocking=False):
            return None, "gpu_busy"
        try:
            body, content_type = multipart(fields, data, mime)
            with closing(http.client.HTTPConnection("127.0.0.1", 18000, timeout=10)) as conn:
                conn.request("POST", PHOTO_PATH, body, {**headers, "Content-Type": content_type})
                response = conn.getresponse()
                if response.status in (408, 429, 503):
                    return None, "gpu_busy"
                if response.status >= 500:
                    return None, "gpu_unavailable"
                payload = json.loads(response.read(1024 * 1024))
                if response.status != 200:
                    error = payload.get("error", {})
                    raise ServiceError(
                        error.get("code", "PHOTO_REJECTED"), "photo request rejected", response.status
                    )
                return payload, None
        except (OSError, http.client.HTTPException, ValueError):
            return None, "gpu_unavailable"
        finally:
            self.gpu_slot.release()

    def analyze(self, data, mime, fields, headers):
        started = time.monotonic()
        local, reason = self.primary(data, mime, fields, headers)
        if local is not None:
            if local["model"]["device"] == "cpu":
                reason = "gpu_unavailable"
            else:
                reason = next(
                    (subject["reason"] for subject in local["subjects"] if subject["state"] == "unknown"),
                    None,
                )
                if not reason and local["policy"]["reason"] in REVIEW_REASONS:
                    reason = local["policy"]["reason"]
            if not reason:
                return local
        image, decode_ms = decode_image(data, mime, ImageLimits())
        with image:
            try:
                reviewed = self.vendor.identify(image)
            except ServiceError as error:
                if local is None:
                    raise
                local["notes"].append(error.code)
                return local
            subjects = merge_subjects(local["subjects"] if local else [], reviewed)
            if local and subjects == local["subjects"]:
                local["notes"].append("dongniao_review_no_change")
                return local
            unique = {}
            for subject in subjects:
                if subject["state"] == "candidate":
                    for candidate in subject["candidates"]:
                        unique.setdefault(candidate["scientific_name"], candidate)
            candidates = [
                dict(value, rank=index) for index, value in enumerate(list(unique.values())[:10], 1)
            ]
            state = "candidate" if candidates else "unknown"
            return dict(
                analysis_id=local["analysis_id"] if local else "pho_" + uuid.uuid4().hex,
                created_at=datetime.now(UTC),
                state=state,
                candidates=candidates,
                subjects=subjects,
                model=dict(
                    name="懂鸟" if not local else "BioCLIP + 懂鸟",
                    backend="dongniao",
                    device="remote",
                    ready=True,
                    details={"trigger": reason},
                ),
                image=dict(width=image.width, height=image.height, content_type=mime, size_bytes=len(data)),
                policy=dict(
                    decision=state,
                    reason=reason,
                    score_type="dongniao_confidence",
                    candidate_count=len(candidates),
                    max_subjects=32,
                    min_short_side_px=11,
                ),
                timing=dict(decode_ms=decode_ms, total_ms=(time.monotonic() - started) * 1000),
                notes=["dongniao_review"],
            )


def create_app(settings=None, vendor=None) -> FastAPI:
    settings = settings or BusinessSettings()

    @asynccontextmanager
    async def lifespan(app):
        app.state.auth = MobileAuth(settings, (PHOTO_PATH,))
        app.state.capacity = threading.BoundedSemaphore(8)
        app.state.gateway = PhotoGateway(
            vendor
            or Dongniao(
                os.environ.get("BIRD_DONGNIAO_API_KEY", ""),
                Path(os.environ.get("BIRD_PHOTO_LEDGER", "/var/lib/bird-photo/calls.sqlite3")),
                load_catalog(settings.catalog_path),
            )
        )
        yield

    router = APIRouter(route_class=UploadRoute)

    @router.post(PHOTO_PATH)
    async def analyze(
        request: Request,
        image: Annotated[UploadFile, File()],
        observation_mode: Annotated[Literal["historical"] | None, Form()] = None,
        captured_at: Annotated[datetime | None, Form()] = None,
        capture_time_precision: Annotated[Literal["exact", "date", "month", "unknown"], Form()] = "unknown",
        latitude: Annotated[float | None, Form(ge=-90, le=90)] = None,
        longitude: Annotated[float | None, Form(ge=-180, le=180)] = None,
    ):
        if observation_mode and (not captured_at or captured_at.utcoffset() is None):
            raise ServiceError(
                "CAPTURED_AT_REQUIRED", "historical photo needs capture time with timezone", 422
            )
        if (latitude is None) != (longitude is None):
            raise ServiceError("COORDINATES_INCOMPLETE", "coordinates must be paired", 422)
        mime = (image.content_type or "").lower()
        if mime not in {"image/jpeg", "image/webp", "image/png"}:
            raise ServiceError("UNSUPPORTED_IMAGE_TYPE", "unsupported image type", 415)
        data = await image.read(ImageLimits.max_image_bytes + 1)
        if len(data) > ImageLimits.max_image_bytes:
            raise ServiceError("IMAGE_TOO_LARGE", "image too large", 413)
        fields = {
            key: str(value)
            for key, value in dict(
                observation_mode=observation_mode,
                capture_time_precision=capture_time_precision,
                captured_at=captured_at.isoformat() if captured_at else None,
                latitude=latitude,
                longitude=longitude,
            ).items()
            if value is not None
        }
        headers = {
            key: request.headers[key] for key in ("authorization", "x-api-key") if key in request.headers
        }
        return await asyncio.to_thread(request.app.state.gateway.analyze, data, mime, fields, headers)

    return build_service_app(
        settings=settings,
        router=router,
        lifespan=lifespan,
        title="Photo Recognition",
        version="1",
        description="Bird photo recognition and review",
    )
