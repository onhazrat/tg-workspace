"""A Channel's Reach from its View counts (REACH-03, ADR-024).

A **pure transform**: no `Session`, no network, no clock. Two callers share it,
which is the reason it is its own module. A followed Channel's Reach is computed
on read from its stored Posts (`channels.reach_by_channel`); a Directory entry's
from its probe sample (REACH-04). Both hand it (View count, age at observation)
pairs, so the two numbers cannot drift apart by being written twice.

**Reach is the median Settled View count** of a Channel's newest Posts. A View
count keeps climbing for about a day after publication, so a young one reads
low, and a Channel posting twenty times a day has nothing but young ones on its
first page. When fewer than `MIN_SAMPLES` counts are Settled, each count between
the estimation floor and the settling age is divided by the Settling curve's
share at its age, and Reach is the median of the Settled and corrected counts,
marked as an estimate. Below the floor a count is too young to correct: the seed
curve puts a 0 to 3 hour count at a fifth of its Settled value, so a small error
in its age becomes a large one in the estimate.

**Not measured is `None`, never zero.** Zero reach and no measurement are
different claims, the rule `directory_statistics` already follows.

**The curve is a function of age in hours**, not a table, so the seed step curve
below and the fitted piecewise-linear one (REACH-07) are interchangeable. It is
rescaled here to share 1 at the settling age, which makes an already-anchored
fitted curve a no-op and lets the seed stay written relative to the 14-day
median it was measured against.
"""

from __future__ import annotations

import bisect
import statistics
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from app.services.directory_statistics import MIN_SAMPLES

#: A Settling curve: the share of its reference View count a Post typically
#: holds at an age in hours.
Curve = Callable[[float], float]

#: Staging, 2026-09-27, 491,420 Posts: the median View count of Posts captured
#: at each age, relative to the median of those captured at 14 days or older.
#: `(start of the age range in hours, share)`, flat past the last one. Cross-Post
#: data confounded by Channel growth, so a starting point rather than a
#: measurement; REACH-09 replaces it with a fitted curve.
SEED_CURVE_STEPS: tuple[tuple[float, float], ...] = (
    (0.0, 0.20),
    (3.0, 0.59),
    (6.0, 0.70),
    (12.0, 0.86),
    (24.0, 0.89),
)

_SEED_STARTS = [start for start, _share in SEED_CURVE_STEPS]


def seed_curve(age_hours: float) -> float:
    """The seed curve's share at `age_hours`: the step whose range holds it."""
    index = max(bisect.bisect_right(_SEED_STARTS, age_hours) - 1, 0)
    return SEED_CURVE_STEPS[index][1]


#: The refresh horizon: sync stops refreshing a stored Post's View count at 7
#: days (ADR-024). A settling age at or past it would call a count Settled that
#: sync could never have observed that old.
REFRESH_HORIZON_HOURS = 7 * 24


@dataclass(frozen=True)
class ReachSettings:
    """The three deployment settings Reach reads, stored under `reach`."""

    settling_age_hours: int = 24
    estimation_floor_hours: int = 3
    sample_size: int = 100


DEFAULT_REACH_SETTINGS = ReachSettings()

#: Wire name of each field, as the `reach` settings row stores it.
REACH_SETTING_FIELDS = {
    "settlingAgeHours": "settling_age_hours",
    "estimationFloorHours": "estimation_floor_hours",
    "reachSampleSize": "sample_size",
}


def reach_settings_from(stored: Mapping[str, Any]) -> ReachSettings:
    """Validate a stored or submitted `reach` row, defaults filling the gaps.

    Raises `ValueError` with a sentence an Operator can act on; the settings
    route answers it as a 422 and the settings panel shows it verbatim.
    """
    values = {
        attr: stored.get(wire, getattr(DEFAULT_REACH_SETTINGS, attr))
        for wire, attr in REACH_SETTING_FIELDS.items()
    }
    for wire, attr in REACH_SETTING_FIELDS.items():
        value = values[attr]
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{wire} must be a whole number.")
    result = ReachSettings(**values)
    if not 0 < result.settling_age_hours < REFRESH_HORIZON_HOURS:
        raise ValueError(
            "The settling age must be more than 0 and below "
            f"{REFRESH_HORIZON_HOURS} hours, the age sync stops refreshing a "
            "View count at."
        )
    if not 0 <= result.estimation_floor_hours < result.settling_age_hours:
        raise ValueError(
            "The estimation floor must be at least 0 and below the settling age."
        )
    if result.sample_size < MIN_SAMPLES:
        raise ValueError(
            f"Reach needs at least {MIN_SAMPLES} Posts to read; "
            f"the sample size cannot be below that."
        )
    return result


@dataclass(frozen=True)
class Reach:
    """A Channel's Reach, `value=None` when it is not measured."""

    value: int | None = None
    estimated: bool = False


def _median(counts: list[float]) -> int:
    # `round`, a tie to the even integer, as `compute_sample_statistics` rounds
    # its median: the two are the same statistic and must agree on 504.5.
    return round(statistics.median(counts))


def compute_reach(
    observations: Iterable[tuple[int, float]],
    settings: ReachSettings,
    curve: Curve = seed_curve,
) -> Reach:
    """Reach from `(View count, age at observation in hours)` pairs.

    The caller has already picked the Channel's newest `settings.sample_size`
    Posts and dropped any without a View count.
    """
    settling = settings.settling_age_hours
    pairs = list(observations)
    settled: list[float] = [views for views, age in pairs if age >= settling]
    if len(settled) >= MIN_SAMPLES:
        return Reach(_median(settled))
    anchor = curve(settling)
    corrected = [
        views * anchor / curve(age)
        for views, age in pairs
        if settings.estimation_floor_hours <= age < settling
    ]
    counts = settled + corrected
    if len(counts) >= MIN_SAMPLES:
        return Reach(_median(counts), estimated=True)
    return Reach()
