"""Deterministic window planning for the fixed 3 s BirdNET input.

The model cannot change its input length, so a recording is cut into 3 s windows
and the final window is zero-padded. Short recordings therefore produce exactly
one padded window; the decision layer lowers the cross-window confirmation
requirement for them instead of pretending there is more evidence.
"""

from __future__ import annotations

import array
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WindowPlan:
    index: int
    start_sample: int
    length_samples: int
    padded: bool

    def start_seconds(self, sample_rate: int) -> float:
        return self.start_sample / sample_rate

    def end_seconds(self, sample_rate: int) -> float:
        return (self.start_sample + self.length_samples) / sample_rate


def plan_windows(total_samples: int, window_samples: int, hop_samples: int) -> list[WindowPlan]:
    if total_samples <= 0:
        raise ValueError("cannot plan windows for an empty signal")
    if window_samples <= 0 or hop_samples <= 0:
        raise ValueError("window and hop must be positive")
    plans: list[WindowPlan] = []
    start = 0
    index = 0
    while True:
        available = total_samples - start
        if available >= window_samples:
            plans.append(WindowPlan(index, start, window_samples, padded=False))
        else:
            plans.append(WindowPlan(index, start, max(available, 0), padded=True))
        index += 1
        if start + window_samples >= total_samples:
            return plans
        start += hop_samples


def extract_window(samples: Sequence[float], plan: WindowPlan, window_samples: int) -> array.array:
    """Copy one window out of the recording, zero-padding to the model length."""
    chunk = samples[plan.start_sample : plan.start_sample + plan.length_samples]
    window = array.array("f", chunk)
    missing = window_samples - len(window)
    if missing > 0:
        window.frombytes(bytes(missing * window.itemsize))
    elif missing < 0:  # pragma: no cover - plans never exceed the window length
        del window[window_samples:]
    return window


def required_confirmations(window_count: int, min_confirming_windows: int) -> int:
    """How many windows must agree before a label becomes a candidate."""
    if window_count <= 0:
        return 0
    return max(1, min(min_confirming_windows, window_count))
