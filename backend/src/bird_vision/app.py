from __future__ import annotations

import logging
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from bird_vision.api import router
from bird_vision.auth import ApiKeyAuth
from bird_vision.config import Settings, get_settings
from bird_vision.errors import ServiceError
from bird_vision.inference.detectors import build_detector
from bird_vision.inference.pipeline import VisionPipeline
from bird_vision.inference.species import build_species_provider
from bird_vision.logging import configure_logging
from bird_vision.metrics import Metrics
from bird_vision.sessions import SessionManager

LOGGER = logging.getLogger(__name__)
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _error_payload(request: Request, code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": getattr(request.state, "request_id", "unknown"),
            "details": details,
        }
    }


def _safe_validation_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    """Return stable JSON-safe validation details without echoing request bodies."""
    return [
        {
            "type": str(error.get("type", "value_error")),
            "loc": [str(part) if not isinstance(part, int) else part for part in error.get("loc", ())],
            "msg": str(error.get("msg", "invalid value")),
        }
        for error in exc.errors()
    ]


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()
    configure_logging(resolved.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        detector = None
        species = None
        sessions = None
        metrics = Metrics()
        try:
            detector = build_detector(resolved)
            species = build_species_provider(resolved)
            LOGGER.info("loading inference backends")
            species.load()
            # Load and warm the detector after BioCLIP so high-resolution warmup
            # validates peak memory with both GPU models resident.
            detector.load()
            pipeline = VisionPipeline(resolved, detector, species)
            # Fail startup if tracking dependencies are missing, rather than
            # advertising readiness and failing on the first session.
            pipeline.new_tracker().clear()
            sessions = SessionManager(resolved, pipeline, metrics)
            await sessions.start()
            app.state.settings = resolved
            app.state.detector = detector
            app.state.species = species
            app.state.metrics = metrics
            app.state.sessions = sessions
            app.state.auth = ApiKeyAuth(resolved)
            LOGGER.info("inference service ready")
            yield
        finally:
            LOGGER.info("stopping inference service")
            try:
                if sessions is not None:
                    await sessions.stop()
            finally:
                try:
                    if species is not None:
                        species.close()
                finally:
                    if detector is not None:
                        detector.close()

    app = FastAPI(
        title="Bird Assistant Vision API",
        version=resolved.service_version,
        description=(
            "Realtime bird detection, per-session tracking and BioCLIP species candidates over a "
            "versioned AviList catalog with open-set rejection. Model scores are not presented as "
            "correctness probabilities."
        ),
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    if resolved.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=resolved.cors_origin_list,
            allow_credentials=False,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Request-ID"],
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        supplied_request_id = request.headers.get("x-request-id", "")
        request_id = (
            supplied_request_id
            if REQUEST_ID_PATTERN.fullmatch(supplied_request_id)
            else f"req_{uuid.uuid4().hex}"
        )
        request.state.request_id = request_id
        started = time.perf_counter()
        response = await call_next(request)
        elapsed = time.perf_counter() - started
        route = request.scope.get("route")
        path = getattr(route, "path", "__unmatched__")
        method = (
            request.method
            if request.method
            in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"}
            else "OTHER"
        )
        if hasattr(request.app.state, "metrics"):
            request.app.state.metrics.http_requests.labels(method, path, str(response.status_code)).inc()
            request.app.state.metrics.http_latency.labels(method, path).observe(elapsed)
        response.headers["X-Request-ID"] = request_id
        LOGGER.info(
            "http_request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": path,
                "status": response.status_code,
                "duration_ms": round(elapsed * 1000, 3),
            },
        )
        return response

    @app.exception_handler(ServiceError)
    async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
        headers = {"Retry-After": "1"} if exc.status_code in {429, 503} else None
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(request, exc.code, exc.message, exc.details),
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                request,
                "VALIDATION_ERROR",
                "request validation failed",
                _safe_validation_errors(exc),
            ),
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        LOGGER.exception(
            "unhandled request failure",
            extra={"request_id": getattr(request.state, "request_id", None)},
        )
        return JSONResponse(
            status_code=500,
            content=_error_payload(request, "INTERNAL_ERROR", "unexpected server error"),
        )

    app.include_router(router)
    return app


app = create_app()
