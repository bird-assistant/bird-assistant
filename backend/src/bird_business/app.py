from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from bird_business.api import router
from bird_business.config import BusinessSettings, get_settings
from bird_business.db import ObservationStore
from bird_business.metrics import BusinessMetrics
from bird_common.app_factory import build_service_app
from bird_common.auth import ApiKeyAuth

LOGGER = logging.getLogger(__name__)


def create_app(settings: BusinessSettings | None = None, *, store: ObservationStore | None = None) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        metrics = BusinessMetrics()
        observations = store or ObservationStore(resolved)
        metrics.stored.set(observations.count())
        app.state.settings = resolved
        app.state.store = observations
        app.state.metrics = metrics
        app.state.auth = ApiKeyAuth(resolved)
        LOGGER.info("business service ready", extra={"detail": f"database={observations.path}"})
        try:
            yield
        finally:
            LOGGER.info("stopping business service")
            observations.close()

    return build_service_app(
        settings=resolved,
        router=router,
        lifespan=lifespan,
        title="Bird Assistant Business API",
        version=resolved.service_version,
        description=(
            "Persists confirmed observation records produced by the audio and photo analysis "
            "services. Raw recordings and images are intentionally not stored here."
        ),
    )


app = create_app()
