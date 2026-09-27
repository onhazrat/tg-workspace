"""Reach from (View count, age) pairs, and the settings it reads (REACH-03).

The transform is pure, so this needs no database. Each case is a way the
obvious implementation goes wrong: a threshold on the wrong set, a young count
let through the floor, a curve left unanchored, an absent Reach reported as 0.

## Watched to fail

* gate the measured path on all pairs rather than the Settled ones
* drop the estimation floor, or gate the estimate on the corrected counts alone
* divide by the raw seed share instead of the share anchored at the settling
  age, which reads every estimate about 12% high
* return `Reach(0)` instead of `Reach()` for not measured
* round the median half-up, which reads the tie case as 505
* accept a floor equal to the settling age, or a settling age of 168
* `bisect_left` in the seed lookup, which puts an age on a step boundary in the
  younger step
"""

from __future__ import annotations

import pytest

from app.services.reach import (
    DEFAULT_REACH_SETTINGS,
    REFRESH_HORIZON_HOURS,
    Reach,
    compute_reach,
    reach_settings_from,
    seed_curve,
)

SETTINGS = DEFAULT_REACH_SETTINGS  # settling 24h, floor 3h, 100 Posts


def test_five_settled_counts_are_measured() -> None:
    pairs = [(100, 30.0), (200, 48.0), (300, 24.0), (400, 100.0), (500, 25.0)]

    assert compute_reach(pairs, SETTINGS) == Reach(300)


def test_a_young_count_does_not_join_a_measured_median() -> None:
    """Young counts are ignored once five are Settled, not averaged in."""
    settled = [(100, 30.0)] * 5
    young = [(1, 5.0)] * 20

    assert compute_reach(settled + young, SETTINGS) == Reach(100)


def test_four_settled_counts_are_not_enough_to_measure() -> None:
    pairs = [(100, 30.0)] * 4 + [(1, 1.0)] * 10

    assert compute_reach(pairs, SETTINGS) == Reach()


def test_young_counts_are_corrected_through_the_anchored_curve() -> None:
    """A count at 12 to 24h holds 0.86/0.89 of its Settled value on the seed."""
    share = seed_curve(15.0) / seed_curve(24.0)
    pairs = [(round(100 * share), 15.0)] * 5

    reach = compute_reach(pairs, SETTINGS)

    assert reach == Reach(100, estimated=True)


def test_an_estimate_mixes_settled_and_corrected_counts() -> None:
    pairs = [(100, 30.0)] * 3 + [(round(1000 * seed_curve(4.0) / 0.89), 4.0)] * 2

    reach = compute_reach(pairs, SETTINGS)

    assert reach.estimated
    assert reach.value == 100


def test_the_floor_keeps_counts_too_young_to_correct_out() -> None:
    """Five counts, but one is under the 3h floor: not measured, not estimated."""
    pairs = [(100, 4.0)] * 4 + [(100, 2.9)]

    assert compute_reach(pairs, SETTINGS) == Reach()


def test_the_floor_is_inclusive_and_the_settling_age_starts_settled() -> None:
    at_floor = [(100, 3.0)] * 5
    at_settling = [(100, 24.0)] * 5

    assert compute_reach(at_floor, SETTINGS).estimated
    assert compute_reach(at_settling, SETTINGS) == Reach(100)


def test_nothing_to_read_is_not_measured_rather_than_zero() -> None:
    assert compute_reach([], SETTINGS) == Reach(None, estimated=False)


def test_an_even_set_rounds_its_median_as_the_directory_statistic_does() -> None:
    """504.5 goes to the even integer, as `compute_sample_statistics` does."""
    pairs = [(500, 30.0), (502, 30.0), (507, 30.0), (509, 30.0), (1, 30.0), (600, 30)]

    assert compute_reach(pairs, SETTINGS) == Reach(504)


def test_a_fitted_curve_is_anchored_at_the_settling_age_too() -> None:
    """Any curve works, and an unanchored one is rescaled to 1 at the age."""
    pairs = [(50, 6.0)] * 5

    reach = compute_reach(pairs, SETTINGS, curve=lambda age: age / 12.0)

    assert reach == Reach(200, estimated=True)


def test_the_seed_curve_holds_the_staging_measurement() -> None:
    assert [seed_curve(h) for h in (0, 2.9, 3, 5, 6, 12, 23.9, 24, 500)] == [
        0.20,
        0.20,
        0.59,
        0.59,
        0.70,
        0.86,
        0.86,
        0.89,
        0.89,
    ]


def test_settings_default_when_nothing_is_stored() -> None:
    assert reach_settings_from({}) == DEFAULT_REACH_SETTINGS


@pytest.mark.parametrize(
    ("stored", "fragment"),
    [
        ({"settlingAgeHours": REFRESH_HORIZON_HOURS}, "below 168"),
        ({"settlingAgeHours": 0}, "more than 0"),
        ({"estimationFloorHours": 24}, "below the settling age"),
        ({"settlingAgeHours": 3}, "below the settling age"),
        ({"estimationFloorHours": -1}, "at least 0"),
        ({"reachSampleSize": 4}, "at least 5"),
        ({"reachSampleSize": "100"}, "whole number"),
        ({"settlingAgeHours": True}, "whole number"),
    ],
)
def test_contradictory_settings_are_refused(
    stored: dict[str, object], fragment: str
) -> None:
    with pytest.raises(ValueError, match=fragment):
        reach_settings_from(stored)
