from __future__ import annotations

import csv
import hashlib
import logging
import re
import tempfile
from collections import Counter
from contextlib import nullcontext, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from PIL import Image

from bird_vision.config import Settings
from bird_vision.domain import ObservationContext, SpeciesCandidate, SpeciesPrediction
from bird_vision.occurrence import (
    DynamicOccurrenceResolver,
    OccurrenceIndex,
    OccurrenceLookupError,
    OccurrenceLookupPending,
)

LOGGER = logging.getLogger(__name__)
PROMPT_VERSION = "bioclip-bird-prompt-v1"


@dataclass(frozen=True, slots=True)
class Taxon:
    species_id: str
    scientific_name: str
    common_name_zh: str | None
    common_name_en: str | None
    order: str | None
    family: str | None
    ebird_code: str | None = None
    avibase_id: str | None = None
    region_codes: frozenset[str] = frozenset()
    extinction_status: str | None = None
    iucn_status: str | None = None
    taxon_source: str | None = None
    taxon_version: str | None = None
    license: str | None = None
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class CandidateSelection:
    indices: tuple[int, ...]
    scope: str
    region_code: str | None
    occurrence_counts: dict[str, int]
    location_profile_id: str | None = None
    location_profile_name: str | None = None
    location_distance_km: float | None = None
    observation_month: int | None = None
    temporal_window_months: int | None = None
    occurrence_dataset_version: str | None = None
    coordinates_used: bool = False
    fallback_reason: str | None = None


class SpeciesProvider(Protocol):
    name: str
    backend: str
    device: str
    ready: bool
    taxa: list[Taxon]

    def load(self) -> None: ...

    def classify(
        self,
        images: list[Image.Image],
        top_k: int,
        region_code: str | None = None,
        context: ObservationContext | None = None,
    ) -> list[SpeciesPrediction]: ...

    def coordinates_supported(self, latitude: float | None, longitude: float | None) -> bool: ...

    def metadata(self) -> dict[str, Any]: ...

    def catalog_info(self) -> dict[str, Any]: ...

    def search_catalog(
        self,
        *,
        query: str | None,
        region_code: str | None,
        enabled_only: bool,
        offset: int,
        limit: int,
    ) -> tuple[int, list[Taxon]]: ...

    def close(self) -> None: ...


class CatalogBackedProvider:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings
        self.taxa: list[Taxon] = []
        self._catalog_metadata: dict[str, Any] = {
            "available": False,
            "total_species": 0,
            "enabled_species": 0,
            "region_counts": {},
        }

    def _load_catalog(self) -> None:
        if self.settings is not None and self.settings.species_catalog_path is not None:
            self.taxa = load_catalog(self.settings.species_catalog_path)
            resolved = self.settings.species_catalog_path.expanduser().resolve()
            first = self.taxa[0]
            regions = Counter(code for taxon in self.taxa for code in taxon.region_codes)
            self._catalog_metadata = {
                "available": True,
                "path": str(resolved),
                "source": first.taxon_source,
                "version": first.taxon_version,
                "license": first.license,
                "checksum_sha256": _sha256(resolved),
                "total_species": len(self.taxa),
                "enabled_species": sum(taxon.enabled for taxon in self.taxa),
                "region_counts": dict(sorted(regions.items())),
            }

    def catalog_info(self) -> dict[str, Any]:
        return dict(self._catalog_metadata)

    def coordinates_supported(self, latitude: float | None, longitude: float | None) -> bool:
        return False

    def search_catalog(
        self,
        *,
        query: str | None,
        region_code: str | None,
        enabled_only: bool,
        offset: int,
        limit: int,
    ) -> tuple[int, list[Taxon]]:
        needle = query.strip().casefold() if query else None
        region = region_code.upper() if region_code else None
        matches: list[tuple[int, int, Taxon]] = []
        for sequence, taxon in enumerate(self.taxa):
            if enabled_only and not taxon.enabled:
                continue
            if region and region not in taxon.region_codes:
                continue
            values = tuple(
                value.casefold()
                for value in (
                    taxon.species_id,
                    taxon.scientific_name,
                    taxon.common_name_zh or "",
                    taxon.common_name_en or "",
                    taxon.ebird_code or "",
                )
            )
            relevance = 0
            if needle:
                if needle in values:
                    relevance = 0
                elif any(value.startswith(needle) for value in values):
                    relevance = 1
                elif any(needle in value for value in values):
                    relevance = 2
                else:
                    continue
            matches.append((relevance, sequence, taxon))
        matches.sort(key=lambda item: (item[0], item[1]))
        page = [item[2] for item in matches[offset : offset + limit]]
        return len(matches), page


class DisabledSpeciesProvider(CatalogBackedProvider):
    name = "species-disabled"
    backend = "disabled"
    device = "none"

    def __init__(self, settings: Settings | None = None) -> None:
        super().__init__(settings)
        self.ready = True

    def load(self) -> None:
        self._load_catalog()
        self.ready = True

    def classify(
        self,
        images: list[Image.Image],
        top_k: int,
        region_code: str | None = None,
        context: ObservationContext | None = None,
    ) -> list[SpeciesPrediction]:
        resolved_region = (
            context.region_code if context is not None and context.region_code else region_code
        )
        return [
            SpeciesPrediction(
                candidates=tuple(),
                accepted=False,
                reason="classifier_unavailable",
                top_similarity=None,
                margin=None,
                candidate_count=0,
                region_code=resolved_region,
                catalog_version=None,
            )
            for _ in images
        ]

    def metadata(self) -> dict[str, Any]:
        return {
            "reason": "species classification is disabled",
            "catalog": self.catalog_info(),
        }

    def close(self) -> None:
        return None


class MockSpeciesProvider(CatalogBackedProvider):
    name = "mock-species-classifier"
    backend = "mock"
    device = "cpu"

    def __init__(self, settings: Settings | None = None) -> None:
        super().__init__(settings)
        self.ready = False

    def load(self) -> None:
        self._load_catalog()
        self.ready = True

    def classify(
        self,
        images: list[Image.Image],
        top_k: int,
        region_code: str | None = None,
        context: ObservationContext | None = None,
    ) -> list[SpeciesPrediction]:
        resolved_region = (
            context.region_code if context is not None and context.region_code else region_code
        )
        candidate = SpeciesCandidate(
            species_id="mock_bird",
            scientific_name="Avis exemplum",
            common_name_zh="示例鸟种",
            common_name_en="Example bird",
            score=0.80,
            score_type="mock",
            similarity=None,
            region_match=resolved_region == "CN",
        )
        return [
            SpeciesPrediction(
                candidates=(candidate,),
                accepted=True,
                reason="mock",
                top_similarity=None,
                margin=None,
                candidate_count=1,
                region_code=resolved_region,
                catalog_version="mock",
            )
            for _ in images
        ]

    def metadata(self) -> dict[str, Any]:
        return {
            "purpose": "development-only deterministic output",
            "catalog": self.catalog_info(),
        }

    def close(self) -> None:
        self.ready = False


class BioClipSpeciesProvider(CatalogBackedProvider):
    name = "bioclip-2-zero-shot"
    backend = "open-clip"

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.device = settings.device
        self.ready = False
        self._active_taxa: list[Taxon] = []
        self._torch: Any = None
        self._model: Any = None
        self._preprocess: Any = None
        self._tokenizer: Any = None
        self._text_features: Any = None
        self._occurrence_index: OccurrenceIndex | None = None
        self._dynamic_occurrence: DynamicOccurrenceResolver | None = None
        self._active_taxon_indices: dict[str, int] = {}
        self._resolved_precision = "fp32"
        self._text_cache_path: Path | None = None
        self._text_cache_hit = False
        self._resolved_model_source: str | None = None
        self._model_fingerprint: str | None = None
        self._resolved_revision: str | None = None
        self._feature_dim: int | None = None

    def load(self) -> None:
        self.close()
        try:
            import open_clip
            import torch

            self._torch = torch
            self.device = self._resolve_device(torch)
            self._resolved_precision = self._resolve_precision()
            self._load_catalog()
            self._active_taxa = [taxon for taxon in self.taxa if taxon.enabled]
            if not self._active_taxa:
                raise ValueError("species catalog contains no enabled species")
            self._active_taxon_indices = {
                taxon.scientific_name.casefold(): index
                for index, taxon in enumerate(self._active_taxa)
            }
            self._load_occurrence_index()
            if self.settings.species_live_occurrence_enabled:
                self._dynamic_occurrence = DynamicOccurrenceResolver(
                    radius_km=self.settings.species_live_occurrence_radius_km,
                    facet_limit=self.settings.species_live_occurrence_facet_limit,
                    cache_ttl_seconds=self.settings.species_live_occurrence_cache_ttl_seconds,
                    request_timeout_seconds=self.settings.species_live_occurrence_timeout_seconds,
                )
            model_source = self._resolve_model_source()
            expected = self.settings.bioclip_expected_fingerprint
            if expected and self._model_fingerprint.casefold() != expected.casefold():
                raise RuntimeError(
                    "BioCLIP artifact fingerprint mismatch: "
                    f"expected {expected}, got {self._model_fingerprint}"
                )
            # OpenCLIP's factory has no HF revision argument. Both consumers must
            # read the same resolved local snapshot, and weights must be present.
            self._model, _, self._preprocess = open_clip.create_model_and_transforms(
                model_source, require_pretrained=True, weights_only=True
            )
            self._model = self._model.to(self.device).eval()
            self._tokenizer = open_clip.get_tokenizer(model_source)
            with torch.inference_mode(), self._autocast_context():
                tokens = self._tokenizer([self._prompt(self._active_taxa[0])]).to(self.device)
                probe = self._model.encode_text(tokens)
                if (
                    not torch.is_tensor(probe)
                    or probe.layout != torch.strided
                    or not probe.is_floating_point()
                    or probe.ndim != 2
                    or probe.shape[0] != 1
                    or probe.shape[1] < 1
                ):
                    raise ValueError("BioCLIP text encoder returned an invalid feature shape or dtype")
                self._feature_dim = probe.shape[1]
                probe = probe.float()
                probe = probe / probe.norm(dim=-1, keepdim=True)
                if not self._valid_text_features(probe, 1):
                    raise ValueError("BioCLIP text encoder returned invalid features")
            self._text_features = self._load_or_encode_taxa()
            if self.settings.species_warmup_on_start:
                self.classify([Image.new("RGB", (224, 224), (127, 127, 127))], 1)
            self.ready = True
        except Exception:
            self.close()
            raise

    def _resolve_model_source(self) -> str:
        configured = self.settings.bioclip_model
        revision = self.settings.bioclip_model_revision
        self._resolved_revision = None
        self._model_fingerprint = None
        if configured.startswith("hf-hub:"):
            if self.settings.environment == "production" and not re.fullmatch(
                r"[0-9a-fA-F]{40}", revision or ""
            ):
                raise ValueError("production BioCLIP revision must be a full 40-character HF commit SHA")
            from huggingface_hub import snapshot_download

            repository = configured.removeprefix("hf-hub:")
            snapshot = Path(
                snapshot_download(
                    repo_id=repository,
                    revision=revision,
                )
            ).resolve()
            if not re.fullmatch(r"[0-9a-fA-F]{40}", snapshot.name):
                raise ValueError("BioCLIP snapshot path does not identify a resolved HF commit")
            if (
                revision
                and re.fullmatch(r"[0-9a-fA-F]{40}", revision)
                and snapshot.name.casefold() != revision.casefold()
            ):
                raise ValueError("BioCLIP snapshot revision does not match the requested commit")
            self._resolved_model_source = f"local-dir:{snapshot}"
            self._resolved_revision = snapshot.name
            self._model_fingerprint = _directory_fingerprint(snapshot)
            return self._resolved_model_source
        if configured.startswith("local-dir:"):
            if revision:
                raise ValueError("BioCLIP revision applies only to hf-hub model sources")
            directory = Path(configured.removeprefix("local-dir:")).expanduser().resolve()
            self._resolved_model_source = f"local-dir:{directory}"
            self._model_fingerprint = _directory_fingerprint(directory)
            return self._resolved_model_source
        raise ValueError("BioCLIP requires an hf-hub: or local-dir: pretrained model source")

    def _resolve_device(self, torch: Any) -> str:
        if self.settings.device == "auto":
            return "cuda:0" if torch.cuda.is_available() else "cpu"
        if self.settings.device == "cuda":
            if not torch.cuda.is_available():
                raise RuntimeError("BioCLIP requested CUDA but CUDA is unavailable")
            return "cuda:0"
        return "cpu"

    def _resolve_precision(self) -> str:
        requested = self.settings.species_precision
        if self.device.startswith("cuda"):
            return "fp16" if requested == "auto" else requested
        if requested == "fp16":
            raise RuntimeError("BioCLIP fp16 precision requires CUDA")
        return "fp32"

    def _autocast_context(self) -> Any:
        if self._resolved_precision == "fp16":
            return self._torch.autocast(device_type="cuda", dtype=self._torch.float16)
        return nullcontext()

    def _prompt(self, taxon: Taxon) -> str:
        parts = [f"a wildlife photograph of the bird species {taxon.scientific_name}"]
        if taxon.common_name_en:
            parts.append(f"commonly called {taxon.common_name_en}")
        if taxon.family:
            parts.append(f"in the family {taxon.family}")
        if taxon.order:
            parts.append(f"and order {taxon.order}")
        return ", ".join(parts)

    def _encode_taxa(self) -> Any:
        chunks = []
        text_batch_size = self.settings.species_text_batch_size
        with self._torch.inference_mode(), self._autocast_context():
            for start in range(0, len(self._active_taxa), text_batch_size):
                prompts = [
                    self._prompt(taxon) for taxon in self._active_taxa[start : start + text_batch_size]
                ]
                tokens = self._tokenizer(prompts).to(self.device)
                features = self._model.encode_text(tokens).float()
                features = features / features.norm(dim=-1, keepdim=True)
                chunks.append(features)
        return self._torch.cat(chunks, dim=0)

    def _feature_cache_path(self) -> Path:
        if not self._model_fingerprint or self._feature_dim is None:
            raise RuntimeError(
                "BioCLIP model fingerprint and feature dimension must be resolved before caching"
            )
        catalog_hash = str(self.catalog_info().get("checksum_sha256") or "no-catalog-hash")
        material = "\0".join(
            (
                self.settings.bioclip_model,
                self._resolved_revision or "unversioned",
                self._model_fingerprint,
                str(self._feature_dim),
                catalog_hash,
                PROMPT_VERSION,
                self._resolved_precision,
            )
        )
        cache_key = hashlib.sha256(material.encode()).hexdigest()[:24]
        return self.settings.species_text_cache_dir.expanduser().resolve() / f"{cache_key}.pt"

    def _load_or_encode_taxa(self) -> Any:
        self._text_cache_hit = False
        cache_path = self._feature_cache_path()
        self._text_cache_path = cache_path
        taxa_hash = hashlib.sha256(
            "\0".join(taxon.species_id for taxon in self._active_taxa).encode()
        ).hexdigest()
        expected_metadata = {
            "model_fingerprint": self._model_fingerprint,
            "model_revision": self._resolved_revision,
            "feature_dim": self._feature_dim,
            "catalog_sha256": self.catalog_info().get("checksum_sha256"),
            "taxa_sha256": taxa_hash,
            "prompt_version": PROMPT_VERSION,
            "precision": self._resolved_precision,
            "taxon_count": len(self._active_taxa),
        }
        features = None
        try:
            if cache_path.is_file():
                cached = self._torch.load(cache_path, map_location="cpu", weights_only=True)
                candidate = cached.get("features") if isinstance(cached, dict) else None
                metadata = cached.get("metadata") if isinstance(cached, dict) else None
                if metadata == expected_metadata and self._valid_text_features(
                    candidate, len(self._active_taxa)
                ):
                    features = candidate
                else:
                    LOGGER.warning("ignoring incompatible BioCLIP text feature cache")
        except Exception:
            # weights_only deserialization can also raise UnpicklingError and
            # other format errors. A disposable cache must not prevent startup.
            LOGGER.warning("failed to load BioCLIP text feature cache", exc_info=True)
        if features is not None:
            self._text_cache_hit = True
            return features.to(self.device)

        features = self._encode_taxa()
        if not self._valid_text_features(features, len(self._active_taxa)):
            raise ValueError("BioCLIP text encoder returned invalid features")
        temporary = None
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=cache_path.parent, suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                self._torch.save({"features": features.detach().cpu(), "metadata": expected_metadata}, handle)
            temporary.replace(cache_path)
        except (OSError, RuntimeError):
            LOGGER.warning("failed to save BioCLIP text feature cache", exc_info=True)
        finally:
            if temporary is not None:
                with suppress(OSError):
                    temporary.unlink(missing_ok=True)
        return features

    def _valid_text_features(self, features: Any, rows: int) -> bool:
        return bool(
            self._torch.is_tensor(features)
            and features.layout == self._torch.strided
            and features.dtype == self._torch.float32
            and features.shape == (rows, self._feature_dim)
            and self._torch.isfinite(features).all().item()
            and self._torch.allclose(
                features.norm(dim=-1),
                self._torch.ones(rows, device=features.device),
                atol=1e-3,
                rtol=1e-3,
            )
        )

    def _load_occurrence_index(self) -> None:
        self._occurrence_index = None
        path = self.settings.species_occurrence_path
        if path is None:
            return
        try:
            self._occurrence_index = OccurrenceIndex.load(path)
        except FileNotFoundError:
            if self.settings.environment == "production":
                raise
            LOGGER.warning("occurrence profile is unavailable; location filtering will fall back")

    def coordinates_supported(self, latitude: float | None, longitude: float | None) -> bool:
        if latitude is None or longitude is None:
            return False
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return False
        if self._dynamic_occurrence is not None:
            return True
        if self._occurrence_index is None:
            return False
        # Month does not affect whether a coordinate lies within a configured profile.
        from datetime import UTC, datetime

        return (
            self._occurrence_index.select(
                latitude=latitude,
                longitude=longitude,
                observed_at=datetime.now(UTC),
                window_months=0,
            )
            is not None
        )

    def _candidate_selection(
        self,
        region_code: str | None,
        context: ObservationContext | None,
    ) -> CandidateSelection:
        resolved_region = (
            context.region_code if context is not None and context.region_code else region_code
        )
        resolved_region = resolved_region.upper() if resolved_region else None
        fallback_reason: str | None = None
        selection = None
        if context is not None and context.latitude is not None and context.longitude is not None:
            temporal_window = (
                None
                if context.time_precision == "unknown"
                else self.settings.species_temporal_window_months
            )
            matched: list[int] = []
            if self._occurrence_index is None:
                fallback_reason = "occurrence_index_unavailable"
            else:
                selection = self._occurrence_index.select(
                    latitude=context.latitude,
                    longitude=context.longitude,
                    observed_at=context.observed_at,
                    window_months=temporal_window,
                )
                if selection is None:
                    fallback_reason = "outside_occurrence_profile_coverage"
                else:
                    # A country attached to a coordinate profile is more reliable
                    # than a stale or manually supplied request region.
                    resolved_region = selection.site.country_code or resolved_region
                    selection_region = resolved_region
                    matched = sorted(
                        {
                            self._active_taxon_indices[scientific_name.casefold()]
                            for scientific_name in selection.occurrence_counts
                            if scientific_name.casefold() in self._active_taxon_indices
                        }
                    )
                    if len(matched) >= self.settings.species_min_local_candidates:
                        return CandidateSelection(
                            indices=tuple(matched),
                            scope="local_seasonal",
                            region_code=selection_region,
                            occurrence_counts=selection.occurrence_counts,
                            location_profile_id=selection.site.site_id,
                            location_profile_name=selection.site.name,
                            location_distance_km=round(selection.distance_km, 3),
                            observation_month=selection.observation_month,
                            temporal_window_months=temporal_window,
                            occurrence_dataset_version=str(
                                self._occurrence_index.dataset.get("version")
                            ),
                            coordinates_used=True,
                        )
                    fallback_reason = "insufficient_local_candidates"
            should_query_live = (
                len(matched) < self.settings.species_min_local_candidates
                and self._dynamic_occurrence is not None
            )
            if should_query_live:
                selection = None
                try:
                    selection = self._dynamic_occurrence.select_cached(
                        latitude=context.latitude,
                        longitude=context.longitude,
                        observed_at=context.observed_at,
                        window_months=temporal_window,
                    )
                    if selection is None:
                        fallback_reason = "live_occurrence_no_candidates"
                except OccurrenceLookupPending:
                    fallback_reason = "live_occurrence_lookup_pending"
                except OccurrenceLookupError:
                    LOGGER.debug("live occurrence lookup failed; falling back to catalog", exc_info=True)
                    fallback_reason = "live_occurrence_lookup_failed"
                if selection is not None:
                    matched = sorted(
                        {
                            self._active_taxon_indices[scientific_name.casefold()]
                            for scientific_name in selection.occurrence_counts
                            if scientific_name.casefold() in self._active_taxon_indices
                        }
                    )
                    if len(matched) >= self.settings.species_min_local_candidates:
                        return CandidateSelection(
                            indices=tuple(matched),
                            scope="local_seasonal",
                            region_code=resolved_region,
                            occurrence_counts=selection.occurrence_counts,
                            location_profile_id=selection.site.site_id,
                            location_profile_name=selection.site.name,
                            location_distance_km=0.0,
                            observation_month=selection.observation_month,
                            temporal_window_months=temporal_window,
                            occurrence_dataset_version=selection.dataset_version,
                            coordinates_used=True,
                        )
                    fallback_reason = "insufficient_local_candidates"
        elif context is not None:
            fallback_reason = "coordinates_missing"

        if resolved_region:
            country_indices = tuple(
                index
                for index, taxon in enumerate(self._active_taxa)
                if resolved_region in taxon.region_codes
            )
            if country_indices:
                return CandidateSelection(
                    indices=country_indices,
                    scope="country",
                    region_code=resolved_region,
                    occurrence_counts={},
                    observation_month=(
                        context.observed_at.month
                        if context is not None and context.time_precision != "unknown"
                        else None
                    ),
                    fallback_reason=fallback_reason,
                )
            fallback_reason = fallback_reason or "region_has_no_catalog_candidates"
        return CandidateSelection(
            indices=tuple(range(len(self._active_taxa))),
            scope="global",
            region_code=resolved_region,
            occurrence_counts={},
            observation_month=(
                context.observed_at.month
                if context is not None and context.time_precision != "unknown"
                else None
            ),
            fallback_reason=fallback_reason or ("region_code_missing" if context is not None else None),
        )

    def classify(
        self,
        images: list[Image.Image],
        top_k: int,
        region_code: str | None = None,
        context: ObservationContext | None = None,
    ) -> list[SpeciesPrediction]:
        if not images:
            return []
        results: list[SpeciesPrediction] = []
        batch_size = self.settings.species_batch_size
        selection = self._candidate_selection(region_code, context)
        selection_tensor = self._torch.tensor(selection.indices, dtype=self._torch.long, device=self.device)
        selected_text_features = self._text_features.index_select(0, selection_tensor)
        catalog_version = self.catalog_info().get("version")
        with self._torch.inference_mode(), self._autocast_context():
            for start in range(0, len(images), batch_size):
                chunk = images[start : start + batch_size]
                batch = self._torch.stack([self._preprocess(image) for image in chunk]).to(self.device)
                image_features = self._model.encode_image(batch)
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                image_features = image_features.to(self._text_features.dtype)
                similarities = image_features @ selected_text_features.T
                ranking_scores = similarities
                # These are catalog-relative ranking scores, not correctness probabilities.
                relative_scores = (100.0 * ranking_scores.float()).softmax(dim=-1)
                output_k = min(top_k, relative_scores.shape[-1])
                decision_k = min(max(output_k, 2), relative_scores.shape[-1])
                _, decision_indices = ranking_scores.topk(decision_k, dim=-1)
                for row_number, index_row in enumerate(decision_indices.tolist()):
                    output_local_indices = index_row[:output_k]
                    top_local_index = output_local_indices[0]
                    top_similarity = float(similarities[row_number, top_local_index].item())
                    margin = None
                    if len(index_row) > 1:
                        margin = float(
                            (
                                ranking_scores[row_number, index_row[0]]
                                - ranking_scores[row_number, index_row[1]]
                            ).item()
                        )
                    accepted, reason = self._decision(top_similarity, margin)
                    candidates = tuple(
                        self._candidate(
                            index=selection.indices[local_index],
                            similarity=float(similarities[row_number, local_index].item()),
                            relative_score=float(relative_scores[row_number, local_index].item()),
                            region_code=selection.region_code,
                            occurrence_counts=selection.occurrence_counts,
                        )
                        for local_index in output_local_indices
                    )
                    results.append(
                        SpeciesPrediction(
                            candidates=candidates,
                            accepted=accepted,
                            reason=reason,
                            top_similarity=round(top_similarity, 6),
                            margin=round(margin, 6) if margin is not None else None,
                            candidate_count=len(selection.indices),
                            region_code=selection.region_code,
                            catalog_version=catalog_version,
                            candidate_scope=selection.scope,
                            location_profile_id=selection.location_profile_id,
                            location_profile_name=selection.location_profile_name,
                            location_distance_km=selection.location_distance_km,
                            observation_month=selection.observation_month,
                            temporal_window_months=selection.temporal_window_months,
                            occurrence_dataset_version=selection.occurrence_dataset_version,
                            coordinates_used=selection.coordinates_used,
                            fallback_reason=selection.fallback_reason,
                        )
                    )
        return results

    def _decision(self, top_similarity: float, margin: float | None) -> tuple[bool, str]:
        if top_similarity < self.settings.species_min_similarity:
            return False, "below_similarity_threshold"
        if margin is None or margin < self.settings.species_min_margin:
            return False, "ambiguous_candidates"
        return True, "accepted"

    def _candidate(
        self,
        *,
        index: int,
        similarity: float,
        relative_score: float,
        region_code: str | None,
        occurrence_counts: dict[str, int],
    ) -> SpeciesCandidate:
        taxon = self._active_taxa[index]
        return SpeciesCandidate(
            species_id=taxon.species_id,
            scientific_name=taxon.scientific_name,
            common_name_zh=taxon.common_name_zh,
            common_name_en=taxon.common_name_en,
            score=round(relative_score, 6),
            score_type="relative_similarity",
            similarity=round(similarity, 6),
            region_match=bool(region_code and region_code.upper() in taxon.region_codes),
            local_occurrence_count=occurrence_counts.get(taxon.scientific_name),
        )

    def metadata(self) -> dict[str, Any]:
        return {
            "model": self.settings.bioclip_model,
            "resolved_model_source": self._resolved_model_source,
            "configured_revision": self.settings.bioclip_model_revision,
            "resolved_revision": self._resolved_revision,
            "artifact_fingerprint_sha256": self._model_fingerprint,
            "precision": self._resolved_precision,
            "text_feature_cache": {
                "path": str(self._text_cache_path) if self._text_cache_path else None,
                "hit": self._text_cache_hit,
                "prompt_version": PROMPT_VERSION,
            },
            "catalog": self.catalog_info(),
            "decision": {
                "min_similarity": self.settings.species_min_similarity,
                "min_margin": self.settings.species_min_margin,
                "candidate_policy": "local seasonal filter, then country filter, then global fallback",
                "temporal_window_months": self.settings.species_temporal_window_months,
                "min_local_candidates": self.settings.species_min_local_candidates,
            },
            "occurrence_index": (
                self._occurrence_index.metadata()
                if self._occurrence_index is not None
                else {"available": False}
            ),
            "live_occurrence": (
                self._dynamic_occurrence.metadata()
                if self._dynamic_occurrence is not None
                else {"enabled": False}
            ),
            "score_semantics": (
                "softmax similarity within the enabled catalog; ranking only, not correctness probability"
            ),
        }

    def close(self) -> None:
        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._text_features = None
        self._active_taxa = []
        self._active_taxon_indices = {}
        self._occurrence_index = None
        if self._dynamic_occurrence is not None:
            self._dynamic_occurrence.close()
        self._dynamic_occurrence = None
        self._feature_dim = None
        self._text_cache_path = None
        self._text_cache_hit = False
        self._resolved_model_source = None
        self._resolved_revision = None
        self._model_fingerprint = None
        self.ready = False
        if self._torch is not None and self.device.startswith("cuda"):
            self._torch.cuda.empty_cache()


def _optional(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _boolean(value: str | None, *, default: bool = True) -> bool:
    if value is None or not value.strip():
        return default
    normalized = value.strip().casefold()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    raise ValueError(f"invalid boolean value: {value}")


def _regions(value: str | None) -> frozenset[str]:
    return frozenset(part.strip().upper() for part in (value or "").split(";") if part.strip())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _directory_fingerprint(path: Path) -> str:
    """Hash the root artifacts consumed by OpenCLIP's local-dir loader."""
    if not path.is_dir():
        raise FileNotFoundError(f"BioCLIP local model directory not found: {path}")
    if not (path / "open_clip_config.json").is_file():
        raise FileNotFoundError(f"BioCLIP model configuration not found: {path / 'open_clip_config.json'}")
    if not any(file.is_file() and file.suffix in {".safetensors", ".bin", ".pth"} for file in path.iterdir()):
        raise ValueError(f"BioCLIP local model directory has no OpenCLIP checkpoint: {path}")
    artifacts = sorted(
        file
        for file in path.iterdir()
        if file.is_file()
        and (file.suffix in {".bin", ".pth", ".safetensors", ".json", ".txt", ".model", ".gz", ".bpe"})
    )
    digest = hashlib.sha256()
    for artifact in artifacts:
        digest.update(str(artifact.relative_to(path)).encode())
        digest.update(b"\0")
        with artifact.open("rb") as handle:
            for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def load_catalog(path: Path) -> list[Taxon]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"species catalog not found: {resolved}")
    with resolved.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"species_id", "scientific_name"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"species catalog missing columns: {sorted(missing)}")
        taxa: list[Taxon] = []
        ids: set[str] = set()
        scientific_names: set[str] = set()
        for line_number, row in enumerate(reader, start=2):
            species_id = (row.get("species_id") or "").strip()
            scientific_name = (row.get("scientific_name") or "").strip()
            if not species_id or not scientific_name:
                raise ValueError(f"catalog line {line_number} has an empty id or scientific name")
            if species_id in ids:
                raise ValueError(f"duplicate species_id in catalog: {species_id}")
            if scientific_name.casefold() in scientific_names:
                raise ValueError(f"duplicate scientific_name in catalog: {scientific_name}")
            ids.add(species_id)
            scientific_names.add(scientific_name.casefold())
            try:
                enabled = _boolean(row.get("enabled"))
            except ValueError as exc:
                raise ValueError(f"catalog line {line_number}: {exc}") from exc
            taxa.append(
                Taxon(
                    species_id=species_id,
                    scientific_name=scientific_name,
                    common_name_zh=_optional(row.get("common_name_zh")),
                    common_name_en=_optional(row.get("common_name_en")),
                    order=_optional(row.get("order")),
                    family=_optional(row.get("family")),
                    ebird_code=_optional(row.get("ebird_code")),
                    avibase_id=_optional(row.get("avibase_id")),
                    region_codes=_regions(row.get("region_codes")),
                    extinction_status=_optional(row.get("extinction_status")),
                    iucn_status=_optional(row.get("iucn_status")),
                    taxon_source=_optional(row.get("taxon_source")),
                    taxon_version=_optional(row.get("taxon_version")),
                    license=_optional(row.get("license")),
                    enabled=enabled,
                )
            )
    if not taxa:
        raise ValueError("species catalog is empty")
    return taxa


def build_species_provider(settings: Settings) -> SpeciesProvider:
    if settings.species_backend == "disabled":
        return DisabledSpeciesProvider(settings)
    if settings.species_backend == "mock":
        return MockSpeciesProvider(settings)
    return BioClipSpeciesProvider(settings)
