"""Candidate aggregation, ranking and open-set rejection.

Pure logic: no model, no I/O. The policy knobs are deliberately explicit so the
thresholds validated on field recordings can be changed without touching the
API layer.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from bird_audio.labels import ModelLabel, SpeciesLink
from bird_audio.windows import WindowPlan

State = Literal["candidate", "unknown"]

REASON_CANDIDATE = "candidate_above_threshold"
REASON_BELOW_THRESHOLD = "no_label_above_threshold"
REASON_INSUFFICIENT_WINDOWS = "insufficient_window_confirmation"
REASON_NON_BIRD_DOMINANT = "non_bird_dominant"
REASON_BELOW_MARGIN = "top_margin_too_small"


@dataclass(frozen=True, slots=True)
class WindowScore:
    index: int
    start_seconds: float
    end_seconds: float
    padded: bool
    scores: Sequence[float]
    inference_ms: float


@dataclass(frozen=True, slots=True)
class Candidate:
    label_index: int
    model_label: str
    scientific_name: str
    common_name_en: str | None
    species_id: str | None
    common_name_zh: str | None
    mapped: bool
    match: str | None
    score: float
    confirming_windows: int
    window_scores: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class Decision:
    state: State
    reason: str
    candidates: tuple[Candidate, ...]
    required_windows: int
    window_count: int
    top_non_bird: dict[str, object] | None
    top_labels: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class Policy:
    min_score: float
    min_confirming_windows: int
    min_margin: float
    candidate_count: int
    required_windows: int


def _label_ranking(
    windows: Sequence[WindowScore], labels: Sequence[ModelLabel]
) -> list[tuple[float, int, tuple[float, ...]]]:
    """Per-label max score, count of windows above the threshold, window scores.

    Ranking is computed once for every label so diagnostics and candidates share
    exactly the same numbers.
    """
    if not windows:
        return []
    label_count = len(labels)
    best = [0.0] * label_count
    per_window: list[list[float]] = [[0.0] * len(windows) for _ in range(label_count)]
    for column, window in enumerate(windows):
        scores = window.scores
        if len(scores) != label_count:
            raise ValueError(f"window {window.index} returned {len(scores)} scores for {label_count} labels")
        for index in range(label_count):
            score = float(scores[index])
            per_window[index][column] = score
            if score > best[index]:
                best[index] = score
    ranked = [(best[index], index, tuple(per_window[index])) for index in range(label_count)]
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return ranked


def decide(
    windows: Sequence[WindowScore],
    labels: Sequence[ModelLabel],
    links: Sequence[SpeciesLink],
    policy: Policy,
) -> Decision:
    if len(labels) != len(links):
        raise ValueError("label and species link counts differ")
    ranked = _label_ranking(windows, labels)
    if not ranked:
        return Decision(
            state="unknown",
            reason=REASON_BELOW_THRESHOLD,
            candidates=(),
            required_windows=policy.required_windows,
            window_count=0,
            top_non_bird=None,
            top_labels=(),
        )

    top_labels = tuple(
        {
            "model_label": labels[index].model_label,
            "scientific_name": labels[index].scientific_name,
            "score": round(score, 6),
            "is_bird": labels[index].is_bird,
            "confirming_windows": sum(1 for value in window_scores if value >= policy.min_score),
        }
        for score, index, window_scores in ranked[:5]
    )
    top_non_bird = None
    for score, index, _ in ranked:
        if not labels[index].is_bird:
            top_non_bird = {
                "model_label": labels[index].model_label,
                "score": round(score, 6),
                "above_threshold": score >= policy.min_score,
            }
            break

    candidates: list[Candidate] = []
    best_by_species: dict[str, Candidate] = {}
    for score, index, window_scores in ranked:
        label = labels[index]
        if not label.is_bird:
            continue
        confirming = sum(1 for value in window_scores if value >= policy.min_score)
        if score < policy.min_score:
            break
        if confirming < policy.required_windows:
            continue
        link = links[index]
        candidate = Candidate(
            label_index=index,
            model_label=label.model_label,
            scientific_name=label.scientific_name,
            common_name_en=link.common_name_en or label.common_name or None,
            species_id=link.species_id,
            common_name_zh=link.common_name_zh,
            mapped=link.mapped,
            match=link.match,
            score=score,
            confirming_windows=confirming,
            window_scores=window_scores,
        )
        key = link.species_id or f"label:{label.index}"
        existing = best_by_species.get(key)
        if existing is None or candidate.score > existing.score:
            best_by_species[key] = candidate
    candidates = sorted(best_by_species.values(), key=lambda item: (-item.score, item.label_index))

    if not candidates:
        bird_above = any(labels[index].is_bird and score >= policy.min_score for score, index, _ in ranked)
        if bird_above:
            reason = REASON_INSUFFICIENT_WINDOWS
        elif top_non_bird is not None and bool(top_non_bird["above_threshold"]):
            reason = REASON_NON_BIRD_DOMINANT
        else:
            reason = REASON_BELOW_THRESHOLD
        return Decision(
            state="unknown",
            reason=reason,
            candidates=(),
            required_windows=policy.required_windows,
            window_count=len(windows),
            top_non_bird=top_non_bird,
            top_labels=top_labels,
        )

    if policy.min_margin > 0.0 and len(candidates) > 1:
        margin = candidates[0].score - candidates[1].score
        if margin < policy.min_margin:
            return Decision(
                state="unknown",
                reason=REASON_BELOW_MARGIN,
                candidates=(),
                required_windows=policy.required_windows,
                window_count=len(windows),
                top_non_bird=top_non_bird,
                top_labels=top_labels,
            )

    return Decision(
        state="candidate",
        reason=REASON_CANDIDATE,
        candidates=tuple(candidates[: policy.candidate_count]),
        required_windows=policy.required_windows,
        window_count=len(windows),
        top_non_bird=top_non_bird,
        top_labels=top_labels,
    )


def window_diagnostics(
    windows: Sequence[WindowScore], labels: Sequence[ModelLabel], *, limit: int = 5
) -> tuple[dict[str, object], ...]:
    """Per-window top labels, useful when a real recording misbehaves."""
    entries = []
    for window in windows:
        order = sorted(range(len(labels)), key=lambda index: -float(window.scores[index]))[:limit]
        entries.append(
            {
                "index": window.index,
                "start_seconds": round(window.start_seconds, 3),
                "end_seconds": round(window.end_seconds, 3),
                "padded": window.padded,
                "inference_ms": round(window.inference_ms, 3),
                "top_labels": [
                    {
                        "model_label": labels[index].model_label,
                        "score": round(float(window.scores[index]), 6),
                        "is_bird": labels[index].is_bird,
                    }
                    for index in order
                ],
            }
        )
    return tuple(entries)


def describe_windows(plans: Sequence[WindowPlan], sample_rate: int) -> tuple[dict[str, object], ...]:
    return tuple(
        {
            "index": plan.index,
            "start_seconds": round(plan.start_seconds(sample_rate), 3),
            "end_seconds": round(plan.end_seconds(sample_rate), 3),
            "padded": plan.padded,
        }
        for plan in plans
    )
