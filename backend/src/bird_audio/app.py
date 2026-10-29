from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from bird_audio.api import router
from bird_audio.audio import AudioDecoder, resolve_ffmpeg
from bird_audio.config import AudioSettings, get_settings
from bird_audio.engine import AudioEngine, build_engine, verify_assets
from bird_audio.labels import (
    CatalogIndex,
    ModelLabel,
    SpeciesLink,
    label_summary,
    link_labels,
    load_model_labels,
    parse_model_labels,
)
from bird_audio.metrics import AudioMetrics
from bird_audio.service import AudioAnalysisService
from bird_common.app_factory import build_service_app
from bird_common.auth import ApiKeyAuth
from bird_common.catalog import load_catalog, sha256_file

LOGGER = logging.getLogger(__name__)

# Only used when the real label file is absent *and* the mock engine is selected,
# so API development never silently pretends the real vocabulary is loaded.
MOCK_LABELS = [
    "Turdus merula_Eurasian Blackbird",
    "Parus major_Great Tit",
    "Cyanistes caeruleus_Eurasian Blue Tit",
    "Pica pica_Eurasian Magpie",
    "Passer domesticus_House Sparrow",
    "Human vocal_Human vocal",
    "Dog_Dog",
]


def load_labels(settings: AudioSettings) -> tuple[list[ModelLabel], str]:
    path = settings.labels_path.expanduser()
    if path.is_file():
        return load_model_labels(path), "model_file"
    if settings.engine_backend == "mock":
        LOGGER.warning("BirdNET labels missing; using the built-in mock vocabulary")
        return parse_model_labels(MOCK_LABELS), "builtin_mock"
    raise FileNotFoundError(f"BirdNET label file not found: {path}")


def _catalog_context(
    settings: AudioSettings, labels: list[ModelLabel]
) -> tuple[list[SpeciesLink], dict[str, Any]]:
    path = settings.catalog_path
    if path is None:
        return [SpeciesLink() for _ in labels], {"available": False}
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        if settings.environment == "production":
            raise FileNotFoundError(f"species catalog not found: {resolved}")
        LOGGER.warning("species catalog missing; candidates stay unmapped", extra={"detail": str(resolved)})
        return [SpeciesLink() for _ in labels], {"available": False, "path": str(resolved)}
    taxa = load_catalog(resolved)
    index = CatalogIndex.build(taxa)
    return link_labels(labels, index), {
        "available": True,
        "path": str(resolved),
        "source": taxa[0].taxon_source,
        "version": taxa[0].taxon_version,
        "license": taxa[0].license,
        "checksum_sha256": sha256_file(resolved),
        "total_species": len(taxa),
        "enabled_species": sum(taxon.enabled for taxon in taxa),
    }


def create_app(
    settings: AudioSettings | None = None,
    *,
    engine: AudioEngine | None = None,
    decoder: AudioDecoder | None = None,
) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        metrics = AudioMetrics()
        labels, labels_source = load_labels(resolved)
        links, catalog_info = _catalog_context(resolved, labels)
        digests: dict[str, str | None] = {
            "model_sha256": resolved.model_sha256,
            "labels_sha256": resolved.labels_sha256,
        }
        if resolved.engine_backend == "birdnet":
            LOGGER.info("verifying BirdNET assets")
            digests = verify_assets(resolved)
            # Report the digests that were actually verified, not just the ones
            # a deployment happened to pin.
            if digests.get("model_sha256"):
                resolved.model_sha256 = str(digests["model_sha256"])
            if digests.get("labels_sha256"):
                resolved.labels_sha256 = str(digests["labels_sha256"])
        audio_engine = engine or build_engine(resolved, labels)
        LOGGER.info("loading audio engine")
        audio_engine.load()
        try:
            # A caller-supplied decoder owns its own runtime; otherwise fail fast
            # here rather than advertising readiness without a decoder.
            ffmpeg = decoder.ffmpeg if decoder is not None else resolve_ffmpeg(resolved)
            active_decoder = decoder or AudioDecoder(resolved, ffmpeg=ffmpeg)
            service = AudioAnalysisService(
                resolved,
                audio_engine,
                labels,
                links,
                metrics,
                decoder=active_decoder,
            )
            app.state.settings = resolved
            app.state.engine = audio_engine
            app.state.service = service
            app.state.labels = labels
            app.state.links = links
            app.state.labels_source = labels_source
            app.state.label_summary = label_summary(labels, links, labels_sha256=digests.get("labels_sha256"))
            app.state.label_summary["source"] = labels_source
            app.state.catalog_info = catalog_info
            app.state.asset_digests = digests
            app.state.ffmpeg_path = ffmpeg
            app.state.metrics = metrics
            app.state.auth = ApiKeyAuth(resolved)
            metrics.engine_ready.set(1 if audio_engine.ready else 0)
            LOGGER.info("audio service ready", extra={"detail": f"engine={audio_engine.backend}"})
            yield
        finally:
            LOGGER.info("stopping audio service")
            metrics.engine_ready.set(0)
            audio_engine.close()

    return build_service_app(
        settings=resolved,
        router=router,
        lifespan=lifespan,
        title="Bird Assistant Audio API",
        version=resolved.service_version,
        description=(
            "One-shot bird sound recognition for recordings made in the WeChat mini program. "
            "Uploads are validated and decoded server-side, converted to 48 kHz mono, cut into "
            "3 s windows and scored with BirdNET v2.4. Candidates are ranked model scores aligned "
            "to the AviList catalog; they are not calibrated correctness probabilities."
        ),
    )


def runtime_paths(settings: AudioSettings) -> dict[str, str]:
    """Paths worth printing at startup so a deployment can be reproduced."""
    return {
        "model": str(settings.model_path),
        "labels": str(settings.labels_path),
        "catalog": str(settings.catalog_path or ""),
        "temp_dir": str(settings.temp_dir or Path("<system temp>")),
    }


app = create_app()
