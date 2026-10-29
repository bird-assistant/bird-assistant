from __future__ import annotations

import pytest

from bird_audio.analyzer import (
    Policy,
    WindowScore,
    decide,
    describe_windows,
    window_diagnostics,
)
from bird_audio.labels import ModelLabel, SpeciesLink
from bird_audio.windows import plan_windows

LABELS = [
    ModelLabel(0, "Turdus merula_Eurasian Blackbird", "Turdus merula", "Eurasian Blackbird", True),
    ModelLabel(1, "Parus major_Great Tit", "Parus major", "Great Tit", True),
    ModelLabel(2, "Corvus corone_Carrion Crow", "Corvus corone", "Carrion Crow", True),
    ModelLabel(3, "Human vocal_Human vocal", "Human vocal", "Human vocal", False),
]
LINKS = [
    SpeciesLink("turdus", "乌鸫", "Eurasian Blackbird", "scientific_name"),
    SpeciesLink("parus", "大山雀", "Great Tit", "scientific_name"),
    SpeciesLink(),
    SpeciesLink(),
]


def window(index: int, scores: list[float], *, padded: bool = False) -> WindowScore:
    return WindowScore(
        index=index,
        start_seconds=index * 1.5,
        end_seconds=index * 1.5 + 3.0,
        padded=padded,
        scores=scores,
        inference_ms=1.0,
    )


def policy(**overrides) -> Policy:
    base = dict(
        min_score=0.5,
        min_confirming_windows=2,
        min_margin=0.0,
        candidate_count=5,
        required_windows=2,
    )
    base.update(overrides)
    return Policy(**base)


def test_candidate_requires_score_and_confirmation() -> None:
    windows = [
        window(0, [0.91, 0.20, 0.10, 0.02]),
        window(1, [0.88, 0.30, 0.05, 0.03]),
    ]
    decision = decide(windows, LABELS, LINKS, policy())
    assert decision.state == "candidate"
    assert decision.reason == "candidate_above_threshold"
    top = decision.candidates[0]
    assert top.species_id == "turdus"
    assert top.scientific_name == "Turdus merula"
    assert top.common_name_zh == "乌鸫"
    assert top.mapped is True
    assert top.match == "scientific_name"
    assert top.score == pytest.approx(0.91)
    assert top.confirming_windows == 2
    assert top.window_scores == (pytest.approx(0.91), pytest.approx(0.88))


def test_short_clip_single_window_can_be_a_candidate() -> None:
    windows = [window(0, [0.77, 0.10, 0.05, 0.01], padded=True)]
    decision = decide(windows, LABELS, LINKS, policy(required_windows=1))
    assert decision.state == "candidate"
    assert decision.required_windows == 1
    assert decision.candidates[0].confirming_windows == 1


def test_single_window_without_confirmation_rule_still_needs_threshold() -> None:
    windows = [window(0, [0.30, 0.10, 0.05, 0.01])]
    decision = decide(windows, LABELS, LINKS, policy(required_windows=1))
    assert decision.state == "unknown"
    assert decision.reason == "no_label_above_threshold"


def test_insufficient_window_confirmation_is_reported() -> None:
    windows = [
        window(0, [0.90, 0.10, 0.05, 0.01]),
        window(1, [0.10, 0.20, 0.05, 0.01]),
        window(2, [0.05, 0.10, 0.02, 0.01]),
    ]
    decision = decide(windows, LABELS, LINKS, policy(required_windows=2))
    assert decision.state == "unknown"
    assert decision.reason == "insufficient_window_confirmation"
    assert decision.candidates == ()
    assert decision.top_labels[0]["model_label"] == "Turdus merula_Eurasian Blackbird"
    assert decision.top_labels[0]["confirming_windows"] == 1


def test_non_bird_dominant_is_reported_separately() -> None:
    windows = [
        window(0, [0.12, 0.05, 0.02, 0.93]),
        window(1, [0.10, 0.04, 0.03, 0.91]),
    ]
    decision = decide(windows, LABELS, LINKS, policy())
    assert decision.state == "unknown"
    assert decision.reason == "non_bird_dominant"
    assert decision.top_non_bird == {
        "model_label": "Human vocal_Human vocal",
        "score": 0.93,
        "above_threshold": True,
    }
    assert decision.candidates == ()


def test_nothing_above_threshold_reports_below_threshold() -> None:
    windows = [window(0, [0.2, 0.1, 0.05, 0.02]), window(1, [0.1, 0.2, 0.04, 0.01])]
    decision = decide(windows, LABELS, LINKS, policy())
    assert decision.state == "unknown"
    assert decision.reason == "no_label_above_threshold"
    assert decision.top_non_bird is not None
    assert decision.top_non_bird["above_threshold"] is False


def test_margin_policy_can_reject_an_ambiguous_top_pair() -> None:
    windows = [window(0, [0.80, 0.78, 0.10, 0.02]), window(1, [0.79, 0.77, 0.10, 0.02])]
    decision = decide(windows, LABELS, LINKS, policy(min_margin=0.05))
    assert decision.state == "unknown"
    assert decision.reason == "top_margin_too_small"


def test_candidates_are_ranked_and_truncated() -> None:
    windows = [
        window(0, [0.60, 0.92, 0.75, 0.01]),
        window(1, [0.55, 0.90, 0.70, 0.01]),
    ]
    decision = decide(windows, LABELS, LINKS, policy(candidate_count=2))
    assert [candidate.scientific_name for candidate in decision.candidates] == [
        "Parus major",
        "Corvus corone",
    ]
    assert decision.candidates[1].species_id is None
    assert decision.candidates[1].mapped is False
    assert decision.candidates[1].match is None


def test_duplicate_species_keeps_the_best_label() -> None:
    labels = [
        ModelLabel(0, "Turdus merula_Eurasian Blackbird", "Turdus merula", "Eurasian Blackbird", True),
        ModelLabel(1, "Turdus merula_Blackbird", "Turdus merula", "Blackbird", True),
    ]
    links = [
        SpeciesLink("turdus", "乌鸫", "Eurasian Blackbird", "scientific_name"),
        SpeciesLink("turdus", "乌鸫", "Eurasian Blackbird", "scientific_name"),
    ]
    windows = [window(0, [0.70, 0.95]), window(1, [0.65, 0.92])]
    decision = decide(windows, labels, links, policy())
    assert len(decision.candidates) == 1
    assert decision.candidates[0].score == pytest.approx(0.95)
    assert decision.candidates[0].model_label == "Turdus merula_Blackbird"


def test_decide_requires_matching_label_and_link_counts() -> None:
    with pytest.raises(ValueError):
        decide([window(0, [0.1])], LABELS, LINKS[:2], policy())


def test_decide_requires_matching_score_vector_length() -> None:
    with pytest.raises(ValueError, match="scores for 4 labels"):
        decide([window(0, [0.1, 0.2])], LABELS, LINKS, policy())


def test_decide_without_windows_is_unknown() -> None:
    decision = decide([], LABELS, LINKS, policy())
    assert decision.state == "unknown"
    assert decision.window_count == 0


def test_window_diagnostics_report_per_window_tops() -> None:
    windows = [window(0, [0.2, 0.8, 0.1, 0.05]), window(1, [0.9, 0.1, 0.05, 0.02])]
    diagnostics = window_diagnostics(windows, LABELS, limit=1)
    assert diagnostics[0]["index"] == 0
    assert diagnostics[0]["padded"] is False
    assert diagnostics[0]["top_labels"][0]["model_label"] == "Parus major_Great Tit"
    assert diagnostics[1]["top_labels"][0]["model_label"] == "Turdus merula_Eurasian Blackbird"


def test_describe_windows_reports_seconds() -> None:
    plans = plan_windows(48_000 * 4, 48_000 * 3, 48_000 * 3 // 2)
    described = describe_windows(plans, 48_000)
    assert described[0] == {"index": 0, "start_seconds": 0.0, "end_seconds": 3.0, "padded": False}
    assert described[1]["padded"] is True
