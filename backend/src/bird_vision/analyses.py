"""Single-photo analysis: the one-shot adapter over the realtime pipeline.

The mini program's photo screen uploads one still image, so it does not need a
session, a tracker or a WebSocket. This module reuses the same detector and
species provider, classifies the largest subjects once and returns the same
candidate envelope the audio service uses.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Literal

from PIL import Image

from bird_vision.config import Settings
from bird_vision.domain import Box, ObservationContext, RawDetection, SpeciesCandidate, SpeciesPrediction
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
from bird_vision.tracking import intersection_over_union

REASON_CANDIDATE = "candidate_above_similarity"
REASON_NO_SUBJECT = "no_bird_detected"
REASON_SUBJECT_TOO_SMALL = "subject_below_minimum_size"
REASON_CLASSIFIER_DISABLED = "species_backend_disabled"


def _tile_spans(length: int, base_size: int) -> list[tuple[int, int]]:
    if length <= base_size:
        return [(0, length)]
    span = (length * 3 + 4) // 5
    return [(0, span), (length - span, length)]


def _detect_subjects(image: Image.Image, detector: Detector, settings: Settings) -> list[RawDetection]:
    minimum = settings.photo_min_recognizable_side_px
    detections = [
        item for item in detector.predict(image).detections
        if item.score >= settings.detection_confidence
        or item.box.short_side >= settings.min_recognizable_side_px
    ]
    full_size = (
        settings.detection_high_resolution_image_size
        if settings.detection_high_resolution_enabled else settings.model_image_size
    )
    if max(image.size) > full_size and not any(item.box.short_side >= minimum for item in detections):
        full_image_scale = full_size / max(image.size)
        small_side = max(minimum, settings.min_recognizable_side_px)
        for left, right in _tile_spans(image.width, settings.model_image_size):
            for top, bottom in _tile_spans(image.height, settings.model_image_size):
                with image.crop((left, top, right, bottom)) as tile:
                    for item in detector.predict(tile).detections:
                        if (item.score < settings.detection_confidence
                                or item.box.short_side * full_image_scale > small_side):
                            continue
                        box = item.box
                        projected = Box(left + box.x1, top + box.y1, left + box.x2, top + box.y2)
                        detections.append(replace(item, box=projected))
    detections.sort(key=lambda item: (item.box.short_side >= minimum, item.score), reverse=True)
    distinct: list[RawDetection] = []
    for item in detections:
        if all(intersection_over_union(item.box, other.box) <= settings.detection_iou for other in distinct):
            distinct.append(item)
    distinct.sort(key=lambda item: (item.box.short_side >= minimum, item.box.area * item.score), reverse=True)
    return distinct[:settings.photo_max_subjects]


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
    context: ObservationContext | None = None,
) -> PhotoAnalysisResponse:
    width, height = image.size
    detection_started = time.perf_counter()
    subjects = _detect_subjects(image, detector, settings)
    detection_ms = (time.perf_counter() - detection_started) * 1000.0
    minimum = settings.photo_min_recognizable_side_px
    classifiable = [item for item in subjects if item.box.short_side >= minimum]
    subject_responses: list[PhotoSubjectResponse] = []
    predictions: list[SpeciesPrediction] = []
    classifier_enabled = species.backend != "disabled"
    species_started = time.perf_counter()
    if classifier_enabled and classifiable:
        crops = [_crop(image, subject.box, settings.crop_padding_ratio) for subject in classifiable]
        try:
            if context:
                predictions = species.classify(crops, settings.species_top_k, context=context)
            else:
                predictions = species.classify(crops, settings.species_top_k)
        finally:
            for crop in crops:
                crop.close()
    species_ms = (time.perf_counter() - species_started) * 1000.0
    prediction_by_subject = dict(zip(classifiable, predictions, strict=False))

    for rank, subject in enumerate(subjects, start=1):
        prediction = prediction_by_subject.get(subject)
        subject_state: Literal["candidate", "unknown"] = "unknown"
        reason = REASON_SUBJECT_TOO_SMALL if subject.box.short_side < minimum else REASON_CLASSIFIER_DISABLED
        if prediction is not None:
            subject_state = "candidate" if prediction.accepted and prediction.candidates else "unknown"
            reason = REASON_CANDIDATE if subject_state == "candidate" else prediction.reason
        subject_responses.append(
            PhotoSubjectResponse(
                rank=rank,
                bbox=NormalizedBox(
                    x1=_clamp(subject.box.x1 / width),
                    y1=_clamp(subject.box.y1 / height),
                    x2=_clamp(subject.box.x2 / width),
                    y2=_clamp(subject.box.y2 / height),
                ),
                detection_score=round(subject.score, 6),
                short_side_px=round(subject.box.short_side, 2),
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
    elif not subjects:
        reason = REASON_NO_SUBJECT
    elif not classifiable:
        reason = REASON_SUBJECT_TOO_SMALL
    elif not classifier_enabled:
        reason = REASON_CLASSIFIER_DISABLED
    else:
        reason = predictions[0].reason if predictions else "unknown"

    notes: list[str] = []
    if len(classifiable) < len(subjects):
        notes.append("small_detections_ignored")
    if not classifier_enabled and subjects:
        notes.append("classifier_disabled")
    total_ms = decode_ms + detection_ms + species_ms
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
            min_short_side_px=minimum,
            detection_confidence=settings.detection_confidence,
            candidate_count=settings.species_top_k,
            decision=state,
            reason=reason,
            score_type=candidates[0].score_type if candidates else "relative_similarity",
        ),
        timing=PhotoTimingResponse(
            decode_ms=round(decode_ms, 3),
            detection_ms=round(detection_ms, 3),
            species_ms=round(max(species_ms, 0.0), 3),
            total_ms=round(total_ms, 3),
        ),
        notes=notes,
        created_at=datetime.now(UTC),
    )


def _clamp(value: float) -> float:
    return min(max(value, 0.0), 1.0)
