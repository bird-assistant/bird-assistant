from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from bird_business.admin import router as admin_router
from bird_business.admin_session import AdminSessions
from bird_business.api import router
from bird_business.community import router as community_router
from bird_business.community_store import CommunityStore
from bird_business.config import BusinessSettings, get_settings
from bird_business.db import ObservationStore
from bird_business.guide_api import router as guide_router
from bird_business.metrics import BusinessMetrics
from bird_business.social import router as social_router
from bird_business.social_groups import router as groups_router
from bird_business.trip import router as trip_router
from bird_business.writing import install as install_writing
from bird_business.writing import router as writing_router
from bird_common.app_factory import build_service_app
from bird_common.mobile_auth import MobileAuth
from bird_common.mobile_auth import router as mobile_router

LOGGER = logging.getLogger(__name__)


def create_app(settings: BusinessSettings | None = None, *, store: ObservationStore | None = None) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        metrics = BusinessMetrics()
        observations = store or ObservationStore(resolved)
        metrics.stored.set(observations.count())
        app.state.settings = resolved
        install_writing(app)
        app.state.admin_sessions = AdminSessions(resolved.admin_password_sha256)
        app.state.store = observations
        app.state.metrics = metrics
        app.state.community = CommunityStore(resolved.database_path, resolved.catalog_path)
        app.state.auth = MobileAuth(
            resolved,
            (
                "/api/v1/observations",
                "/api/v1/community",
                "/api/v1/map",
                "/api/v1/species",
                "/api/v2/observations",
                "/api/v1/journal",
            ),
        )
        LOGGER.info("business service ready", extra={"detail": f"database={observations.path}"})
        try:
            yield
        finally:
            LOGGER.info("stopping business service")
            observations.close()
            app.state.community.db.close()

    service = build_service_app(
        settings=resolved,
        router=router,
        lifespan=lifespan,
        title="Bird Assistant Business API",
        version=resolved.service_version,
        description=(
            "Private field observations, sanitized photos, moderated community publications, "
            "map records, species references and member conversations."
        ),
    )
    service.include_router(mobile_router)
    service.include_router(admin_router)
    service.include_router(community_router)
    service.include_router(guide_router)
    service.include_router(trip_router)
    service.include_router(social_router)
    service.include_router(groups_router)
    service.include_router(writing_router)
    return service


app = create_app()
