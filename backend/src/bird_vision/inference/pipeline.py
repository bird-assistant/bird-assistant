from __future__ import annotations

import time
import uuid
from dataclasses import replace
from datetime import UTC, datetime

from PIL import Image, ImageFilter, ImageStat

from bird_vision.config import Settings
from bird_vision.domain import Box, CropMemoryBudget, FrameJob, SpeciesCandidate, SpeciesPrediction, Track
from bird_vision.inference.detectors import Detector
from bird_vision.inference.species import SpeciesProvider
from bird_vision.schemas import (
    FrameResultEvent,
    NormalizedBox,
    ObservationContextResponse,
    SpeciesCandidateResponse,
    SpeciesDecisionResponse,
    SpeciesResultResponse,
    TimingResponse,
    TrackResponse,
)
from bird_vision.tracking import TrackManager, build_tracker


class VisionPipeline:
    def __init__(self, settings: Settings, detector: Detector, species: SpeciesProvider) -> None:
        self.settings = settings
        self.detector = detector
        self.species = species
        self.crop_budget = CropMemoryBudget(settings.max_saved_crop_bytes)

    def new_tracker(self) -> TrackManager:
        return build_tracker(self.settings)

    def process(
        self,
        *,
        session_id: str,
        job: FrameJob,
        tracker: TrackManager,
        queue_ms: float,
        decode_ms: float,
    ) -> FrameResultEvent:
        started = time.perf_counter()
        detector_output = self.detector.predict(job.image)
        observed_at = job.captured_at or job.received_at
        tracks = tracker.update(detector_output.detections, observed_at)

        species_started = time.perf_counter()
        classify_tracks: list[Track] = []
        crops: list[Image.Image] = []
        now_mono = time.monotonic()
        for track in tracks:
            if track.missed_frames:
                continue
            quality = self._quality(job.image, track.box, track.detection_score)
            track.best_quality = max(track.best_quality, quality)
            eligible = (
                track.hits >= self.settings.track_confirm_hits
                and track.box.short_side >= self.settings.min_recognizable_side_px
            )
            if (
                self.species.backend != "disabled"
                and eligible
                and (quality >= track.pending_best_quality or track.pending_best_crop is None)
            ):
                track.save_best_crop(self._crop(job.image, track.box), quality, self.crop_budget)
            if self._should_classify(track, quality, now_mono) and track.pending_best_crop is not None:
                crops.append(track.pending_best_crop)
                classify_tracks.append(track)

        if crops and self.species.backend != "disabled":
            try:
                predictions = self.species.classify(
                    crops,
                    self.settings.species_top_k,
                    region_code=job.region_code,
                    context=job.observation_context,
                )
                for track, prediction in zip(classify_tracks, predictions, strict=True):
                    self._reset_species_evidence_for_context_change(track, prediction)
                    track.species_history.append(prediction)
                    del track.species_history[: -self.settings.species_evidence_window]
                    aggregate = self._aggregate_predictions(track.species_history)
                    track.species_prediction = self._stabilize_prediction(track, aggregate)
                    track.species_candidates = track.species_prediction.candidates
                    track.species_model = self.species.name
                    track.last_classified_quality = track.pending_best_quality
                    track.last_classified_monotonic = now_mono
            finally:
                # Classification consumes crops synchronously. Do not retain an
                # image after an attempt, including when classification fails.
                for track in classify_tracks:
                    track.release_best_crop()
        species_ms = (time.perf_counter() - species_started) * 1000

        width, height = job.image.size
        responses = [self._track_response(track, width, height) for track in tracks]
        total_ms = (time.perf_counter() - started) * 1000 + queue_ms + decode_ms
        return FrameResultEvent(
            event_id=f"evt_{uuid.uuid4().hex}",
            occurred_at=datetime.now(UTC),
            session_id=session_id,
            frame_id=job.frame_id,
            captured_at=job.captured_at,
            observation_context=ObservationContextResponse.model_validate(
                job.observation_context, from_attributes=True
            ),
            image_width=width,
            image_height=height,
            tracks=responses,
            timing=TimingResponse(
                queue_ms=round(queue_ms, 3),
                decode_ms=round(decode_ms, 3),
                preprocess_ms=round(detector_output.preprocess_ms, 3),
                detection_ms=round(detector_output.inference_ms, 3),
                postprocess_ms=round(detector_output.postprocess_ms, 3),
                species_ms=round(species_ms, 3),
                total_ms=round(total_ms, 3),
            ),
        )

    def _should_classify(self, track: Track, quality: float, now_mono: float) -> bool:
        if self.species.backend == "disabled":
            return False
        if track.hits < self.settings.track_confirm_hits:
            return False
        if track.box.short_side < self.settings.min_recognizable_side_px:
            return False
        if track.last_classified_monotonic is None:
            return True
        if now_mono - track.last_classified_monotonic < self.settings.classification_cooldown_seconds:
            return False
        if now_mono - track.last_classified_monotonic >= self.settings.classification_refresh_seconds:
            return True
        required = track.last_classified_quality * (1.0 + self.settings.classification_min_quality_gain)
        return track.pending_best_quality >= required

    @staticmethod
    def _reset_species_evidence_for_context_change(
        track: Track, prediction: SpeciesPrediction
    ) -> None:
        previous = track.species_history[-1] if track.species_history else track.species_prediction
        if previous is None:
            return
        previous_context = (
            previous.candidate_scope,
            previous.region_code,
            previous.location_profile_id,
            previous.observation_month,
            previous.temporal_window_months,
            previous.occurrence_dataset_version,
        )
        next_context = (
            prediction.candidate_scope,
            prediction.region_code,
            prediction.location_profile_id,
            prediction.observation_month,
            prediction.temporal_window_months,
            prediction.occurrence_dataset_version,
        )
        if previous_context == next_context:
            return
        track.species_history.clear()
        track.species_prediction = None
        track.species_candidates = ()
        track.pending_species_id = None
        track.pending_species_hits = 0
        track.species_stability = "stable"

    def _aggregate_predictions(self, history: list[SpeciesPrediction]) -> SpeciesPrediction:
        """Stabilize species output with a bounded multi-observation consensus."""
        latest = history[-1]
        if len(history) == 1 or self.species.backend != "open-clip":
            return latest
        evidence: dict[str, list[tuple[int, SpeciesCandidate | None]]] = {}
        for weight, prediction in enumerate(history, start=1):
            candidates = {candidate.species_id: candidate for candidate in prediction.candidates}
            for species_id in set(evidence) | set(candidates):
                evidence.setdefault(species_id, []).append((weight, candidates.get(species_id)))
        total_weight = sum(range(1, len(history) + 1))
        ranked_values: list[tuple[float, SpeciesCandidate, float, float | None]] = []
        for values in evidence.values():
            candidate = next(candidate for _, candidate in reversed(values) if candidate is not None)
            score = sum(weight * (item.score if item is not None else 0.0) for weight, item in values)
            score /= total_weight
            similarities = [item for _, item in values if item is not None and item.similarity is not None]
            similarity = (
                sum(
                    weight * item.similarity
                    for weight, item in values
                    if item is not None and item.similarity is not None
                )
                / total_weight
                if similarities
                else None
            )
            ranking_value = (
                sum(
                    weight
                    * (
                        item.similarity
                        if item is not None and item.similarity is not None
                        else item.score
                        if item is not None
                        else 0.0
                    )
                    for weight, item in values
                )
                / total_weight
            )
            ranked_values.append((ranking_value, candidate, score, similarity))
        all_ranked = sorted(
            ranked_values,
            key=lambda item: (-item[0], item[1].species_id),
        )
        ranked = all_ranked[: self.settings.species_top_k]
        votes = {candidate.species_id: 0 for _, candidate, _, _ in all_ranked}
        for weight, prediction in enumerate(history, start=1):
            if prediction.candidates:
                species_id = prediction.candidates[0].species_id
                votes[species_id] = votes.get(species_id, 0) + weight
        candidates = tuple(
            replace(
                candidate,
                score=round(score, 6),
                similarity=round(similarity, 6) if similarity is not None else None,
            )
            for _, candidate, score, similarity in ranked
        )
        top_similarity = ranked[0][3] if ranked else None
        top_species_id = ranked[0][1].species_id if ranked else None
        latest_species_ids = {candidate.species_id for candidate in latest.candidates}
        latest_top_species_id = latest.candidates[0].species_id if latest.candidates else None
        limited_candidates = len(latest.candidates) < 2
        # The classifier's margin is measured against its full catalog. Do not
        # recompute it from a truncated top-k response.
        margin = latest.margin
        latest_accepts_top = latest.accepted and top_species_id in latest_species_ids
        top_votes = votes.get(top_species_id, 0) if top_species_id is not None else 0
        competing_votes = max(
            (count for species_id, count in votes.items() if species_id != top_species_id),
            default=0,
        )
        vote_winner = bool(ranked and top_votes > competing_votes)
        latest_top_matches = top_species_id == latest_top_species_id
        if limited_candidates:
            decision_evidence = (
                latest.margin is not None
                and latest.margin >= self.settings.species_min_margin
                or latest.margin is None
                and vote_winner
            )
        else:
            decision_evidence = (
                vote_winner
                and latest.margin is not None
                and latest.margin >= self.settings.species_min_margin
            )
        aggregate_gates = bool(
            top_similarity is not None
            and top_similarity >= self.settings.species_min_similarity
            and latest_accepts_top
            and latest_top_matches
            and decision_evidence
        )
        accepted = aggregate_gates
        if not latest.accepted:
            reason = latest.reason
        elif top_similarity is None or top_similarity < self.settings.species_min_similarity:
            reason = "below_similarity_threshold"
        elif top_species_id not in latest_species_ids:
            reason = "not_in_latest_prediction"
        elif not latest_top_matches:
            reason = "latest_prediction_disagrees"
        elif not decision_evidence:
            reason = "ambiguous_candidates"
        else:
            reason = "accepted"
        return SpeciesPrediction(
            candidates=candidates,
            accepted=accepted,
            reason=reason,
            top_similarity=round(top_similarity, 6) if top_similarity is not None else None,
            margin=round(margin, 6) if margin is not None else None,
            candidate_count=latest.candidate_count,
            region_code=latest.region_code,
            catalog_version=latest.catalog_version,
            candidate_scope=latest.candidate_scope,
            location_profile_id=latest.location_profile_id,
            location_profile_name=latest.location_profile_name,
            location_distance_km=latest.location_distance_km,
            observation_month=latest.observation_month,
            temporal_window_months=latest.temporal_window_months,
            occurrence_dataset_version=latest.occurrence_dataset_version,
            coordinates_used=latest.coordinates_used,
            fallback_reason=latest.fallback_reason,
        )

    def _stabilize_prediction(self, track: Track, prediction: SpeciesPrediction) -> SpeciesPrediction:
        current = track.species_prediction
        if current is None or not current.accepted:
            track.species_stability = "stable"
            if prediction.accepted and prediction.candidates:
                track.pending_species_id = None
                track.pending_species_hits = 0
            return prediction

        current_species_id = current.candidates[0].species_id if current.candidates else None
        next_species_id = prediction.candidates[0].species_id if prediction.candidates else None
        if not prediction.accepted or next_species_id == current_species_id:
            track.pending_species_id = None
            track.pending_species_hits = 0
            if prediction.accepted:
                track.species_stability = "stable"
                return prediction
            track.species_stability = "held"
            return current

        if next_species_id == track.pending_species_id:
            track.pending_species_hits += 1
        else:
            track.pending_species_id = next_species_id
            track.pending_species_hits = 1

        if track.pending_species_hits >= self.settings.species_switch_confirmations:
            track.pending_species_id = None
            track.pending_species_hits = 0
            track.species_stability = "stable"
            return prediction
        track.species_stability = "switch_pending"
        return current

    def _crop(self, image: Image.Image, box: Box) -> Image.Image:
        width, height = image.size
        pad_x = box.width * self.settings.crop_padding_ratio
        pad_y = box.height * self.settings.crop_padding_ratio
        coords = (
            max(0, int(box.x1 - pad_x)),
            max(0, int(box.y1 - pad_y)),
            min(width, int(box.x2 + pad_x)),
            min(height, int(box.y2 + pad_y)),
        )
        crop = image.crop(coords)
        maximum = self.settings.species_max_crop_side_px
        if max(crop.size) > maximum:
            crop.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
        return crop

    def _quality(self, image: Image.Image, box: Box, detection_score: float) -> float:
        with (
            self._crop(image, box) as crop,
            crop.convert("L") as grayscale,
            grayscale.resize((64, 64)) as resized,
            resized.filter(ImageFilter.FIND_EDGES) as edges,
        ):
            edge_variance = ImageStat.Stat(edges).var[0]
        size_score = min(1.0, box.short_side / 256.0)
        sharpness_score = min(1.0, edge_variance / 1000.0)
        return float(detection_score * size_score * (0.5 + 0.5 * sharpness_score))

    def _track_response(self, track: Track, width: int, height: int) -> TrackResponse:
        box = track.predicted_box or track.box
        normalized = box.normalized(width, height)
        recognizable = track.box.short_side >= self.settings.min_recognizable_side_px
        if self.species.backend == "disabled":
            species = SpeciesResultResponse(
                state="unavailable",
                note="species classification is not configured; detection does not prove species",
            )
        elif track.species_prediction is not None:
            prediction = track.species_prediction
            species = SpeciesResultResponse(
                state="candidate" if prediction.accepted else "unknown",
                stability=track.species_stability if prediction.accepted else None,
                model=track.species_model,
                candidates=[
                    SpeciesCandidateResponse.model_validate(item, from_attributes=True)
                    for item in prediction.candidates
                ],
                decision=SpeciesDecisionResponse(
                    accepted=prediction.accepted,
                    reason=prediction.reason,
                    top_similarity=prediction.top_similarity,
                    margin=prediction.margin,
                    min_similarity=(
                        self.settings.species_min_similarity if self.species.backend == "open-clip" else None
                    ),
                    min_margin=(
                        self.settings.species_min_margin if self.species.backend == "open-clip" else None
                    ),
                    candidate_count=prediction.candidate_count,
                    region_code=prediction.region_code,
                    catalog_version=prediction.catalog_version,
                    candidate_scope=prediction.candidate_scope,
                    location_profile_id=prediction.location_profile_id,
                    location_profile_name=prediction.location_profile_name,
                    location_distance_km=prediction.location_distance_km,
                    observation_month=prediction.observation_month,
                    temporal_window_months=prediction.temporal_window_months,
                    occurrence_dataset_version=prediction.occurrence_dataset_version,
                    coordinates_used=prediction.coordinates_used,
                    fallback_reason=prediction.fallback_reason,
                ),
                note=(
                    "candidate passed configured open-set gates; user confirmation is still required"
                    if prediction.accepted
                    else "no species passed the open-set gates; alternatives are provided for review only"
                ),
            )
        else:
            species = SpeciesResultResponse(
                state="waiting_for_quality",
                model=self.species.name,
                note="waiting for a stable track and a sufficiently large, clear crop",
            )
        return TrackResponse(
            track_id=track.track_id,
            state="confirmed" if track.hits >= self.settings.track_confirm_hits else "tentative",
            visibility="temporarily_lost" if track.missed_frames else "detected",
            bbox=NormalizedBox(x1=normalized[0], y1=normalized[1], x2=normalized[2], y2=normalized[3]),
            detection_score=round(track.detection_score, 6),
            short_side_px=round(track.box.short_side, 2),
            recognizable=recognizable,
            hits=track.hits,
            species=species,
        )
