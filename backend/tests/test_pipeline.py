from __future__ import annotations

import time
from datetime import UTC, datetime

from PIL import Image

import bird_vision.inference.pipeline as pipeline_module
from bird_vision.domain import (
    Box,
    DetectorOutput,
    FrameJob,
    ObservationContext,
    RawDetection,
    SpeciesCandidate,
    SpeciesPrediction,
    Track,
)
from bird_vision.inference.detectors import MockDetector
from bird_vision.inference.pipeline import VisionPipeline
from bird_vision.inference.species import MockSpeciesProvider


def test_pipeline_confirms_track_and_emits_species_candidate(test_settings) -> None:
    detector = MockDetector()
    detector.load()
    species = MockSpeciesProvider()
    species.load()
    pipeline = VisionPipeline(test_settings, detector, species)
    tracker = pipeline.new_tracker()
    image = Image.new("RGB", (320, 240), (100, 120, 80))

    result = None
    for index in range(3):
        now = datetime.now(UTC)
        result = pipeline.process(
            session_id="vs_test",
            job=FrameJob(
                frame_id=str(index),
                image=image,
                captured_at=now,
                received_at=now,
                received_monotonic=time.monotonic(),
            ),
            tracker=tracker,
            queue_ms=0.0,
            decode_ms=0.0,
        )
    assert result is not None
    assert result.tracks[0].state == "confirmed"
    assert result.tracks[0].species.state == "candidate"
    assert result.tracks[0].species.stability == "stable"
    assert result.tracks[0].species.candidates[0].species_id == "mock_bird"


def test_pipeline_passes_observation_context_to_species_model(test_settings) -> None:
    class RecordingSpeciesProvider(MockSpeciesProvider):
        def __init__(self) -> None:
            super().__init__()
            self.context: ObservationContext | None = None

        def classify(self, images, top_k, region_code=None, context=None):
            self.context = context
            return super().classify(images, top_k, region_code, context)

    settings = test_settings.model_copy(update={"track_confirm_hits": 1})
    detector = MockDetector()
    detector.load()
    species = RecordingSpeciesProvider()
    species.load()
    pipeline = VisionPipeline(settings, detector, species)
    captured_at = datetime.fromisoformat("2025-11-01T00:00:00+08:00")
    job = FrameJob(
        frame_id="metadata",
        image=Image.new("RGB", (320, 240), (100, 120, 80)),
        captured_at=captured_at,
        received_at=datetime.now(UTC),
        received_monotonic=time.monotonic(),
        latitude=39.9042,
        longitude=116.4074,
        region_code="CN",
        coordinate_source="frame",
        capture_time_precision="month",
    )

    pipeline.process(
        session_id="vs_test",
        job=job,
        tracker=pipeline.new_tracker(),
        queue_ms=0.0,
        decode_ms=0.0,
    )

    assert species.context == ObservationContext(
        observed_at=captured_at,
        time_source="captured_at",
        time_precision="month",
        latitude=39.9042,
        longitude=116.4074,
        coordinate_source="frame",
        region_code="CN",
    )


def test_pipeline_returns_predicted_track_without_reclassifying(test_settings) -> None:
    class IntermittentDetector(MockDetector):
        def __init__(self) -> None:
            super().__init__()
            self.calls = 0

        def predict(self, image):
            self.calls += 1
            detections = (
                (RawDetection(Box(80, 40, 180, 160), 0.9),)
                if self.calls == 1
                else tuple()
            )
            return DetectorOutput(detections)

    class CountingSpeciesProvider(MockSpeciesProvider):
        def __init__(self) -> None:
            super().__init__()
            self.calls = 0

        def classify(self, images, top_k, region_code=None, context=None):
            self.calls += 1
            return super().classify(images, top_k, region_code, context)

    settings = test_settings.model_copy(update={"track_confirm_hits": 1})
    detector = IntermittentDetector()
    detector.load()
    species = CountingSpeciesProvider()
    species.load()
    pipeline = VisionPipeline(settings, detector, species)
    tracker = pipeline.new_tracker()
    image = Image.new("RGB", (320, 240), (100, 120, 80))

    def process(frame_id: str):
        now = datetime.now(UTC)
        return pipeline.process(
            session_id="vs_test",
            job=FrameJob(
                frame_id=frame_id,
                image=image,
                captured_at=now,
                received_at=now,
                received_monotonic=time.monotonic(),
            ),
            tracker=tracker,
            queue_ms=0.0,
            decode_ms=0.0,
        )

    detected = process("detected")
    missing = process("missing")

    assert detected.tracks[0].visibility == "detected"
    assert missing.tracks[0].visibility == "temporarily_lost"
    assert missing.tracks[0].bbox == detected.tracks[0].bbox
    assert missing.tracks[0].species.state == "candidate"
    assert missing.tracks[0].species.candidates[0].species_id == "mock_bird"
    assert species.calls == 1


def test_stabilizer_holds_accepted_name_and_requires_confirmed_switch(test_settings) -> None:
    settings = test_settings.model_copy(update={"species_switch_confirmations": 2})
    species = MockSpeciesProvider()
    species.backend = "open-clip"
    pipeline = VisionPipeline(settings, MockDetector(), species)
    candidate_a = SpeciesCandidate(
        species_id="a",
        scientific_name="Avis alpha",
        common_name_zh="甲鸟",
        common_name_en="Alpha",
        score=0.8,
        similarity=0.8,
    )
    candidate_b = SpeciesCandidate(
        species_id="b",
        scientific_name="Avis beta",
        common_name_zh="乙鸟",
        common_name_en="Beta",
        score=0.8,
        similarity=0.8,
    )
    accepted_a = SpeciesPrediction(
        candidates=(candidate_a,),
        accepted=True,
        reason="accepted",
        top_similarity=0.8,
        margin=0.02,
        candidate_count=2,
        region_code="CN",
        catalog_version="test",
    )
    accepted_b = SpeciesPrediction(
        candidates=(candidate_b,),
        accepted=True,
        reason="accepted",
        top_similarity=0.8,
        margin=0.02,
        candidate_count=2,
        region_code="CN",
        catalog_version="test",
    )
    rejected = SpeciesPrediction(
        candidates=(candidate_a,),
        accepted=False,
        reason="ambiguous_candidates",
        top_similarity=0.8,
        margin=0.001,
        candidate_count=2,
        region_code="CN",
        catalog_version="test",
    )
    track = Track(
        track_id=1,
        box=Box(0, 0, 100, 100),
        detection_score=0.9,
        first_seen_at=datetime.now(UTC),
        last_seen_at=datetime.now(UTC),
        species_prediction=accepted_a,
    )

    held = pipeline._stabilize_prediction(track, rejected)
    held_stability = track.species_stability
    first_switch_evidence = pipeline._stabilize_prediction(track, accepted_b)
    pending_stability = track.species_stability
    switched = pipeline._stabilize_prediction(track, accepted_b)

    assert held is accepted_a
    assert held_stability == "held"
    assert first_switch_evidence is accepted_a
    assert pending_stability == "switch_pending"
    assert switched is accepted_b
    assert track.species_stability == "stable"


def test_candidate_scope_change_clears_old_species_evidence(test_settings) -> None:
    pipeline = VisionPipeline(test_settings, MockDetector(), MockSpeciesProvider())
    global_candidate = SpeciesCandidate(
        species_id="global",
        scientific_name="Pericrocotus lansbergei",
        common_name_zh=None,
        common_name_en="Little Minivet",
        score=0.7,
        similarity=0.699707,
    )
    local_candidate = SpeciesCandidate(
        species_id="local",
        scientific_name="Ficedula mugimaki",
        common_name_zh="鸲姬鹟",
        common_name_en="Mugimaki Flycatcher",
        score=0.9,
        similarity=0.689453,
    )
    global_prediction = SpeciesPrediction(
        candidates=(global_candidate,),
        accepted=True,
        reason="accepted",
        top_similarity=0.699707,
        margin=0.01,
        candidate_count=10970,
        region_code="CN",
        catalog_version="test",
        candidate_scope="global",
        fallback_reason="live_occurrence_lookup_pending",
    )
    local_prediction = SpeciesPrediction(
        candidates=(local_candidate,),
        accepted=True,
        reason="accepted",
        top_similarity=0.689453,
        margin=0.03,
        candidate_count=229,
        region_code="CN",
        catalog_version="test",
        candidate_scope="local_seasonal",
        location_profile_id="hefei",
        observation_month=10,
        temporal_window_months=1,
        occurrence_dataset_version="gbif-live",
        coordinates_used=True,
    )
    track = Track(
        track_id=1,
        box=Box(0, 0, 100, 100),
        detection_score=0.9,
        first_seen_at=datetime.now(UTC),
        last_seen_at=datetime.now(UTC),
        species_prediction=global_prediction,
        species_history=[global_prediction, global_prediction],
        species_candidates=(global_candidate,),
        species_stability="switch_pending",
        pending_species_id="local",
        pending_species_hits=1,
    )

    pipeline._reset_species_evidence_for_context_change(track, local_prediction)

    assert track.species_history == []
    assert track.species_prediction is None
    assert track.species_candidates == ()
    assert track.pending_species_id is None
    assert track.pending_species_hits == 0
    assert track.species_stability == "stable"


def test_pipeline_immediately_replaces_global_result_when_local_list_becomes_ready(
    test_settings,
) -> None:
    global_candidate = SpeciesCandidate(
        species_id="global",
        scientific_name="Pericrocotus lansbergei",
        common_name_zh=None,
        common_name_en="Little Minivet",
        score=0.7,
        similarity=0.699707,
    )
    local_candidate = SpeciesCandidate(
        species_id="local",
        scientific_name="Ficedula mugimaki",
        common_name_zh="鸲姬鹟",
        common_name_en="Mugimaki Flycatcher",
        score=0.9,
        similarity=0.689453,
    )
    predictions = [
        SpeciesPrediction(
            candidates=(global_candidate,),
            accepted=True,
            reason="accepted",
            top_similarity=0.699707,
            margin=0.01,
            candidate_count=10970,
            region_code="CN",
            catalog_version="test",
            candidate_scope="global",
            fallback_reason="live_occurrence_lookup_pending",
        ),
        SpeciesPrediction(
            candidates=(local_candidate,),
            accepted=True,
            reason="accepted",
            top_similarity=0.689453,
            margin=0.03,
            candidate_count=229,
            region_code="CN",
            catalog_version="test",
            candidate_scope="local_seasonal",
            location_profile_id="hefei",
            observation_month=10,
            temporal_window_months=1,
            occurrence_dataset_version="gbif-live",
            coordinates_used=True,
        ),
    ]

    class SequentialSpecies(MockSpeciesProvider):
        backend = "open-clip"

        def classify(self, images, top_k, region_code=None, context=None):
            prediction = predictions.pop(0)
            return [prediction for _ in images]

    settings = test_settings.model_copy(
        update={
            "track_confirm_hits": 1,
            "classification_cooldown_seconds": 0,
            "classification_refresh_seconds": 0,
            "species_switch_confirmations": 2,
        }
    )
    detector = MockDetector()
    detector.load()
    species = SequentialSpecies()
    species.load()
    pipeline = VisionPipeline(settings, detector, species)
    tracker = pipeline.new_tracker()
    image = Image.new("RGB", (320, 240), (100, 120, 80))

    results = []
    for index in range(2):
        now = datetime.now(UTC)
        results.append(
            pipeline.process(
                session_id="vs_test",
                job=FrameJob(
                    frame_id=str(index),
                    image=image,
                    captured_at=now,
                    received_at=now,
                    received_monotonic=time.monotonic(),
                ),
                tracker=tracker,
                queue_ms=0.0,
                decode_ms=0.0,
            )
        )

    assert results[0].tracks[0].species.candidates[0].common_name_en == "Little Minivet"
    latest = results[1].tracks[0].species
    assert latest.candidates[0].common_name_zh == "鸲姬鹟"
    assert latest.decision.candidate_scope == "local_seasonal"
    assert latest.decision.coordinates_used


def test_pipeline_emits_unknown_when_open_set_gate_rejects(test_settings) -> None:
    class RejectingSpeciesProvider(MockSpeciesProvider):
        def classify(self, images, top_k, region_code=None, context=None):
            candidate = SpeciesCandidate(
                species_id="bird_a",
                scientific_name="Avis alpha",
                common_name_zh=None,
                common_name_en="Alpha bird",
                score=0.1,
                similarity=0.1,
            )
            return [
                SpeciesPrediction(
                    candidates=(candidate,),
                    accepted=False,
                    reason="below_similarity_threshold",
                    top_similarity=0.1,
                    margin=0.001,
                    candidate_count=10_970,
                    region_code=region_code,
                    catalog_version="v2026",
                )
                for _ in images
            ]

    detector = MockDetector()
    detector.load()
    species = RejectingSpeciesProvider()
    species.load()
    pipeline = VisionPipeline(test_settings, detector, species)
    tracker = pipeline.new_tracker()
    image = Image.new("RGB", (320, 240), (100, 120, 80))

    for index in range(3):
        now = datetime.now(UTC)
        result = pipeline.process(
            session_id="vs_test",
            job=FrameJob(
                frame_id=str(index),
                image=image,
                captured_at=now,
                received_at=now,
                received_monotonic=time.monotonic(),
                region_code="CN",
            ),
            tracker=tracker,
            queue_ms=0.0,
            decode_ms=0.0,
        )

    assert result.tracks[0].species.state == "unknown"
    assert result.tracks[0].species.decision is not None
    assert result.tracks[0].species.decision.reason == "below_similarity_threshold"
    assert result.tracks[0].species.decision.candidate_count == 10_970


def test_pipeline_reclassifies_after_refresh_and_uses_recent_species_evidence(
    test_settings, monkeypatch
) -> None:
    class SequenceSpeciesProvider(MockSpeciesProvider):
        backend = "open-clip"

        def __init__(self) -> None:
            super().__init__()
            self.calls = 0

        def classify(self, images, top_k, region_code=None, context=None):
            self.calls += 1
            species_id, similarity = ("wrong_first", 0.9) if self.calls == 1 else ("correct_later", 0.8)
            candidate = SpeciesCandidate(
                species_id=species_id,
                scientific_name=f"Avis {species_id}",
                common_name_zh=None,
                common_name_en=species_id,
                score=similarity,
                similarity=similarity,
            )
            return [
                SpeciesPrediction(
                    candidates=(candidate,),
                    accepted=True,
                    reason="accepted",
                    top_similarity=similarity,
                    margin=None,
                    candidate_count=2,
                    region_code=region_code,
                    catalog_version="test",
                )
                for _ in images
            ]

    settings = test_settings.model_copy(
        update={
            "classification_cooldown_seconds": 0.0,
            "classification_refresh_seconds": 10.0,
            "species_evidence_window": 3,
            "species_switch_confirmations": 1,
        }
    )
    detector = MockDetector()
    detector.load()
    species = SequenceSpeciesProvider()
    species.load()
    pipeline = VisionPipeline(settings, detector, species)
    tracker = pipeline.new_tracker()
    image = Image.new("RGB", (320, 240), (100, 120, 80))
    monotonic_values = iter((0.0, 1.0, 2.0, 3.0, 13.0))
    monkeypatch.setattr(pipeline_module.time, "monotonic", lambda: next(monotonic_values))

    result = None
    for index in range(5):
        now = datetime.now(UTC)
        result = pipeline.process(
            session_id="vs_test",
            job=FrameJob(
                frame_id=str(index),
                image=image,
                captured_at=now,
                received_at=now,
                received_monotonic=0.0,
            ),
            tracker=tracker,
            queue_ms=0.0,
            decode_ms=0.0,
        )

    assert result is not None
    assert species.calls == 2
    assert result.tracks[0].species.candidates[0].species_id == "correct_later"
    assert tracker._tracks[1].pending_best_crop is None


def test_aggregate_open_clip_uses_raw_similarity_without_region_bonus(test_settings) -> None:
    settings = test_settings.model_copy(update={"species_top_k": 2})
    species = MockSpeciesProvider()
    species.backend = "open-clip"
    pipeline = VisionPipeline(settings, MockDetector(), species)
    candidate_a = SpeciesCandidate(
        species_id="a",
        scientific_name="Avis alpha",
        common_name_zh=None,
        common_name_en="Alpha",
        score=0.60,
        similarity=0.50,
    )
    candidate_b = SpeciesCandidate(
        species_id="b",
        scientific_name="Avis beta",
        common_name_zh=None,
        common_name_en="Beta",
        score=0.40,
        similarity=0.49,
        region_match=True,
    )
    history = [
        SpeciesPrediction(
            candidates=(candidate_a, candidate_b),
            accepted=True,
            reason="accepted",
            top_similarity=0.50,
            margin=0.02,
            candidate_count=100,
            region_code="CN",
            catalog_version="test",
        ),
        SpeciesPrediction(
            candidates=(candidate_b, candidate_a),
            accepted=True,
            reason="accepted",
            top_similarity=0.49,
            margin=0.005,
            candidate_count=100,
            region_code="CN",
            catalog_version="test",
        ),
    ]

    aggregate = pipeline._aggregate_predictions(history)

    assert aggregate.candidates[0].species_id == "a"
    assert aggregate.top_similarity == 0.5
    assert aggregate.accepted is False
    assert aggregate.reason == "latest_prediction_disagrees"


def test_aggregate_top1_uses_latest_margin_and_respects_latest_rejection(test_settings) -> None:
    settings = test_settings.model_copy(update={"species_top_k": 1})
    species = MockSpeciesProvider()
    species.backend = "open-clip"
    pipeline = VisionPipeline(settings, MockDetector(), species)
    candidate = SpeciesCandidate(
        species_id="a",
        scientific_name="Avis alpha",
        common_name_zh=None,
        common_name_en="Alpha",
        score=0.8,
        similarity=0.8,
    )
    accepted = SpeciesPrediction(
        candidates=(candidate,),
        accepted=True,
        reason="accepted",
        top_similarity=0.8,
        margin=0.02,
        candidate_count=100,
        region_code="CN",
        catalog_version="test",
    )
    rejected = SpeciesPrediction(
        candidates=(candidate,),
        accepted=False,
        reason="ambiguous_candidates",
        top_similarity=0.8,
        margin=0.001,
        candidate_count=100,
        region_code="CN",
        catalog_version="test",
    )

    aggregate = pipeline._aggregate_predictions([accepted, accepted])
    rejected_aggregate = pipeline._aggregate_predictions([accepted, rejected])

    assert aggregate.accepted is True
    assert aggregate.margin == 0.02
    assert rejected_aggregate.accepted is False
    assert rejected_aggregate.reason == "ambiguous_candidates"
