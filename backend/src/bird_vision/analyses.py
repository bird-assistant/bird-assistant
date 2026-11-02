"""Single-photo analysis: the one-shot adapter over the realtime pipeline.

The mini program's photo screen uploads one still image, so it does not need a
session, a tracker or a WebSocket. This module reuses the same detector and
species provider, classifies the largest subjects once and returns the same
candidate envelope the audio service uses.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from PIL import Image

from bird_vision.config import Settings
from bird_vision.domain import Box, RawDetection, SpeciesCandidate, SpeciesPrediction
from bird_vision.inference.detectors import Detector
from bird_vision.inference.species import SpeciesProvider
from bird_vision.schemas import (
    ModelInfo,
    NormalizedBox,
    PhotoAnalysisResponse,
    PhotoCandidateResponse,
    PhotoImageInfo,
    PhotoPolicyResponse,
    PhotoSubjectResponse,
    PhotoTimingResponse,
)

REASON_CANDIDATE = "candidate_above_similarity"
REASON_NO_SUBJECT = "no_bird_detected"
REASON_SUBJECT_TOO_SMALL = "subject_below_minimum_size"
REASON_CLASSIFIER_DISABLED = "species_backend_disabled"


@dataclass(frozen=True, slots=True)
class _Subject:
    rank: int
    box: Box
    detection_score: float
    short_side_px: float


def _select_subjects(
    detections: tuple[RawDetection, ...], settings: Settings, width: int, height: int
) -> tuple[list[_Subject], bool]:
    """Largest/highest-scoring subjects first; reports whether any was too small."""
    candidates: list[tuple[float, RawDetection, float]] = []
    too_small = False
    for detection in detections:
        box = detection.box
        if box.short_side < settings.min_recognizable_side_px:
            too_small = True
            continue
        candidates.append((detection.score * max(box.area, 1.0), detection, box.short_side))
    candidates.sort(key=lambda item: -item[0])
    selected = [
        _Subject(rank=index, box=detection.box, detection_score=detection.score, short_side_px=short)
        for index, (_, detection, short) in enumerate(candidates[: settings.photo_max_subjects], start=1)
    ]
    return selected, too_small


def _crop(image: Image.Image, box: Box, padding: float) -> Image.Image:
    width, height = image.size
    pad_w = box.width * padding
    pad_h = box.height * padding
    left = max(0, int(box.x1 - pad_w))
    top = max(0, int(box.y1 - pad_h))
    right = min(width, int(box.x2 + pad_w))
    bottom = min(height, int(box.y2 + pad_h))
    return image.crop((left, top, max(right, left + 1), max(bottom, top + 1)))


def _merge_candidates(predictions: list[SpeciesPrediction], top_k: int) -> list[PhotoCandidateResponse]:
    best: dict[str, SpeciesCandidate] = {}
    for prediction in predictions:
        for candidate in prediction.candidates:
            current = best.get(candidate.species_id)
            if current is None or candidate.score > current.score:
                best[candidate.species_id] = candidate
    ranked = sorted(best.values(), key=lambda item: -item.score)[:top_k]
    return [
        PhotoCandidateResponse(
            rank=index,
            species_id=candidate.species_id,
            scientific_name=candidate.scientific_name,
            common_name_zh=candidate.common_name_zh,
            common_name_en=candidate.common_name_en,
            score=round(candidate.score, 6),
            score_type=candidate.score_type,
            similarity=candidate.similarity,
            region_match=candidate.region_match,
            local_occurrence_count=candidate.local_occurrence_count,
        )
        for index, candidate in enumerate(ranked, start=1)
    ]


def analyze_photo(
    *,
    image: Image.Image,
    settings: Settings,
    detector: Detector,
    species: SpeciesProvider,
    filename: str | None,
    content_type: str | None,
    size_bytes: int,
    decode_ms: float,
) -> PhotoAnalysisResponse:
    width, height = image.size
    detector_output = detector.predict(image)
    subjects, too_small = _select_subjects(detector_output.detections, settings, width, height)
    subject_responses: list[PhotoSubjectResponse] = []
    predictions: list[SpeciesPrediction] = []
    classifier_enabled = species.backend != "disabled" and bool(subjects)
    species_started = time.perf_counter()
    if classifier_enabled:
        crops = [_crop(image, subject.box, settings.crop_padding_ratio) for subject in subjects]
        predictions = species.classify(crops, settings.species_top_k)
    species_ms = (time.perf_counter() - species_started) * 1000.0
    prediction_by_rank = {
        subject.rank: prediction for subject, prediction in zip(subjects, predictions, strict=False)
    }

    for subject in subjects:
        prediction = prediction_by_rank.get(subject.rank)
        subject_state: Literal["candidate", "unknown"] = "unknown"
        reason = REASON_CLASSIFIER_DISABLED
        if prediction is not None:
            subject_state = "candidate" if prediction.accepted and prediction.candidates else "unknown"
            reason = REASON_CANDIDATE if subject_state == "candidate" else prediction.reason
        subject_responses.append(
            PhotoSubjectResponse(
                rank=subject.rank,
                bbox=NormalizedBox(
                    x1=_clamp(subject.box.x1 / width),
                    y1=_clamp(subject.box.y1 / height),
                    x2=_clamp(subject.box.x2 / width),
                    y2=_clamp(subject.box.y2 / height),
                ),
                detection_score=round(subject.detection_score, 6),
                short_side_px=round(subject.short_side_px, 2),
                state=subject_state,
                reason=reason,
                candidates=_merge_candidates([prediction], settings.species_top_k) if prediction else [],
            )
        )

    accepted_predictions = [prediction for prediction in predictions if prediction.accepted]
    candidates = (
        _merge_candidates(accepted_predictions, settings.species_top_k) if accepted_predictions else []
    )
    state: Literal["candidate", "unknown"] = "unknown"
    if candidates:
        state = "candidate"
        reason = REASON_CANDIDATE
    elif not detector_output.detections:
        reason = REASON_NO_SUBJECT
    elif not subjects:
        reason = REASON_SUBJECT_TOO_SMALL
    elif not classifier_enabled:
        reason = REASON_CLASSIFIER_DISABLED
    else:
        reason = predictions[0].reason if predictions else "unknown"

    notes: list[str] = []
    if too_small:
        notes.append("small_detections_ignored")
    if not classifier_enabled and subjects:
        notes.append("classifier_disabled")
    total_ms = decode_ms + detector_output.preprocess_ms + detector_output.inference_ms + species_ms
    return PhotoAnalysisResponse(
        analysis_id=f"pho_{uuid.uuid4().hex}",
        state=state,
        candidates=candidates,
        subjects=subject_responses,
        model=ModelInfo(
            name=species.name,
            backend=species.backend,
            device=species.device,
            ready=species.ready,
            details=species.metadata(),
        ),
        image=PhotoImageInfo(
            filename=filename,
            content_type=content_type,
            width=width,
            height=height,
            size_bytes=size_bytes,
        ),
        policy=PhotoPolicyResponse(
            max_subjects=settings.photo_max_subjects,
            min_short_side_px=settings.min_recognizable_side_px,
            detection_confidence=settings.detection_confidence,
            candidate_count=settings.species_top_k,
            decision=state,
            reason=reason,
            score_type=candidates[0].score_type if candidates else "relative_similarity",
        ),
        timing=PhotoTimingResponse(
            decode_ms=round(decode_ms, 3),
            detection_ms=round(detector_output.inference_ms, 3),
            species_ms=round(max(species_ms, 0.0), 3),
            total_ms=round(total_ms, 3),
        ),
        notes=notes,
        created_at=datetime.now(UTC),
    )


def _clamp(value: float) -> float:
    return min(max(value, 0.0), 1.0)
