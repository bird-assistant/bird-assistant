from __future__ import annotations

import array

import pytest

from bird_audio.windows import extract_window, plan_windows, required_confirmations

WINDOW = 3 * 48_000
HOP = 48_000 * 3 // 2


def test_short_clip_yields_single_padded_window() -> None:
    plans = plan_windows(48_000, WINDOW, HOP)
    assert len(plans) == 1
    assert plans[0].padded is True
    assert plans[0].start_sample == 0
    assert plans[0].length_samples == 48_000


def test_exact_window_is_not_padded() -> None:
    plans = plan_windows(WINDOW, WINDOW, HOP)
    assert len(plans) == 1
    assert plans[0].padded is False


def test_long_clip_uses_hop_overlap_and_pads_the_tail() -> None:
    plans = plan_windows(48_000 * 10, WINDOW, HOP)
    assert [plan.start_sample for plan in plans] == [0, 72_000, 144_000, 216_000, 288_000, 360_000]
    assert [plan.padded for plan in plans] == [False, False, False, False, False, True]
    assert plans[-1].length_samples == 48_000 * 2.5


def test_plan_rejects_empty_signal() -> None:
    with pytest.raises(ValueError):
        plan_windows(0, WINDOW, HOP)
    with pytest.raises(ValueError):
        plan_windows(10, 0, HOP)


def test_extract_window_pads_with_zeros() -> None:
    samples = array.array("f", [0.5] * 48_000)
    plan = plan_windows(len(samples), WINDOW, HOP)[0]
    window = extract_window(samples, plan, WINDOW)
    assert len(window) == WINDOW
    assert window[0] == pytest.approx(0.5)
    assert window[47_999] == pytest.approx(0.5)
    assert window[48_000] == 0.0
    assert sum(window[48_000:]) == 0.0


def test_extract_window_copies_without_padding() -> None:
    samples = array.array("f", range(10))
    plan = plan_windows(len(samples), 6, 3)[0]
    window = extract_window(samples, plan, 6)
    assert list(window) == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]


@pytest.mark.parametrize(
    ("window_count", "minimum", "expected"),
    [(0, 2, 0), (1, 2, 1), (1, 1, 1), (2, 2, 2), (6, 2, 2), (3, 10, 3)],
)
def test_required_confirmations(window_count: int, minimum: int, expected: int) -> None:
    assert required_confirmations(window_count, minimum) == expected


def test_window_timing_helpers() -> None:
    plan = plan_windows(48_000 * 4, WINDOW, HOP)[1]
    assert plan.start_seconds(48_000) == pytest.approx(1.5)
    # The final window is clipped to the recording and reports its real end.
    assert plan.end_seconds(48_000) == pytest.approx(4.0)
