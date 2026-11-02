from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse

from bird_business.db import Observation, ObservationStore
from bird_business.schemas import (
    HealthResponse,
    ObservationCreate,
    ObservationPage,
    ObservationResponse,
    ReadyResponse,
)
from bird_common.auth import Principal, require_principal
from bird_common.errors import ServiceError

router = APIRouter()


def _to_response(observation: Observation) -> ObservationResponse:
    return ObservationResponse.model_validate(observation, from_attributes=True)


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
    store: ObservationStore = request.app.state.store
    ready = store.ready
    body = ReadyResponse(
        status="ready" if ready else "not_ready",
        database=str(store.path),
        observations=store.count() if ready else 0,
    )
    return JSONResponse(status_code=200 if ready else 503, content=body.model_dump(mode="json"))


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request, _: Annotated[Principal, Depends(require_principal)]) -> Response:
    return Response(request.app.state.metrics.render(), media_type="text/plain; version=0.0.4")


@router.post(
    "/api/v1/observations",
    response_model=ObservationResponse,
    status_code=201,
    responses={200: {"description": "Idempotent retry: the stored record is returned"}},
    tags=["observations"],
)
async def create_observation(
    payload: ObservationCreate,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(require_principal)],
) -> ObservationResponse:
    settings = request.app.state.settings
    if payload.note is not None and len(payload.note) > settings.max_note_length:
        raise ServiceError(
            "NOTE_TOO_LONG",
            "note exceeds the configured length",
            422,
            {"max_length": settings.max_note_length},
        )
    observed_at = payload.observed_at or datetime.now(UTC)
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=UTC)
    store: ObservationStore = request.app.state.store
    observation, created = store.create(
        owner_subject=principal.subject,
        observation_id=f"obs_{uuid.uuid4().hex}",
        observed_at=observed_at,
        source=payload.source,
        source_analysis_id=payload.source_analysis_id,
        species_id=payload.species_id,
        scientific_name=payload.scientific_name,
        common_name_zh=payload.common_name_zh,
        common_name_en=payload.common_name_en,
        score=payload.score,
        score_type=payload.score_type,
        latitude=payload.latitude,
        longitude=payload.longitude,
        region_code=payload.region_code,
        note=payload.note,
        client_reference=payload.client_reference,
    )
    metrics = request.app.state.metrics
    metrics.observations.labels("created" if created else "duplicate").inc()
    metrics.stored.set(store.count())
    if not created:
        response.status_code = 200
    return _to_response(observation)


@router.get("/api/v1/observations", response_model=ObservationPage, tags=["observations"])
async def list_observations(
    request: Request,
    principal: Annotated[Principal, Depends(require_principal)],
    limit: Annotated[int | None, Query(ge=1)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    source: Annotated[Literal["audio", "photo"] | None, Query()] = None,
) -> ObservationPage:
    settings = request.app.state.settings
    page_size = settings.default_page_size if limit is None else limit
    if page_size > settings.max_page_size:
        raise ServiceError(
            "INVALID_PAGE_SIZE",
            "limit exceeds the configured maximum",
            422,
            {"limit": page_size, "max": settings.max_page_size},
        )
    store: ObservationStore = request.app.state.store
    total, items = store.list(owner_subject=principal.subject, limit=page_size, offset=offset, source=source)
    return ObservationPage(
        total=total,
        offset=offset,
        limit=page_size,
        items=[_to_response(item) for item in items],
    )


@router.get(
    "/api/v1/observations/{observation_id}",
    response_model=ObservationResponse,
    tags=["observations"],
)
async def get_observation(
    observation_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_principal)],
) -> ObservationResponse:
    store: ObservationStore = request.app.state.store
    return _to_response(store.get(observation_id, principal.subject))


@router.delete("/api/v1/observations/{observation_id}", status_code=204, tags=["observations"])
async def delete_observation(
    observation_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_principal)],
) -> Response:
    store: ObservationStore = request.app.state.store
    store.delete(observation_id, principal.subject)
    request.app.state.metrics.stored.set(store.count())
    return Response(status_code=204)
