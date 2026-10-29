from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from bird_common.app_factory import build_service_app
from bird_common.auth import ApiKeyAuth
from bird_vision.api import router
from bird_vision.config import Settings, get_settings
from bird_vision.inference.detectors import build_detector
from bird_vision.inference.pipeline import VisionPipeline
from bird_vision.inference.species import build_species_provider
from bird_vision.metrics import Metrics
from bird_vision.sessions import SessionManager

LOGGER = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()

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
            # One-shot photo analyses share the single GPU slot with the pipeline.
            app.state.photo_slots = asyncio.Semaphore(resolved.max_concurrent_inference)
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

    return build_service_app(
        settings=resolved,
        router=router,
        lifespan=lifespan,
        title="Bird Assistant Vision API",
        version=resolved.service_version,
        description=(
            "Realtime bird detection, per-session tracking and BioCLIP species candidates over a "
            "versioned AviList catalog with open-set rejection. Model scores are not presented as "
            "correctness probabilities."
        ),
    )


app = create_app()
