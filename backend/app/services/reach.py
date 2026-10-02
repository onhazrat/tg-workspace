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
curve puts a 30-minute count at a tenth of its Settled value and a 2-hour one at
about two fifths, so a small error in its age becomes a large one in the
estimate.

**Not measured is `None`, never zero.** Zero reach and no measurement are
different claims, the rule `directory_statistics` already follows.

**The curve is a function of age in hours**, not a table, so the seed below
and a stored fit (REACH-07) are interchangeable. It is rescaled here to share 1
at the settling age, which makes a curve anchored at that age a no-op and keeps
the seed, anchored at the default 24 hours, right under any other settling
age.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import cached_property
from typing import Any, NamedTuple

import numpy as np

from app.services.directory_statistics import MIN_SAMPLES, SamplePost, views_of

#: A Settling curve: the share of its reference View count a Post typically
#: holds at an age in hours.
Curve = Callable[[float], float]

#: The refresh horizon: sync stops refreshing a stored Post's View count at 7
#: days (ADR-024). A settling age at or past it would call a count Settled that
#: sync could never have observed that old.
REFRESH_HORIZON_HOURS = 7 * 24

#: The fitted curve's knots: ages log-spaced from 30 minutes to the refresh
#: horizon, the last age sync sees a View count at.
KNOT_AGES_HOURS: tuple[float, ...] = tuple(
    float(age) for age in np.geomspace(0.5, REFRESH_HORIZON_HOURS, 16)
)

#: `(age in hours, share)` per knot, share 1 at the settling age.
Knots = tuple[tuple[float, float], ...]


def curve_from_knots(knots: Sequence[Sequence[float]]) -> Curve:
    """Piecewise-linear log share over log age, flat outside the knots."""
    log_ages = [math.log(age) for age, _share in knots]
    log_shares = [math.log(share) for _age, share in knots]

    def curve(age_hours: float) -> float:
        at = math.log(max(age_hours, knots[0][0]))
        return math.exp(float(np.interp(at, log_ages, log_shares)))

    return curve


#: Staging's fit #5 of 2026-10-01 (REACH-09): 235,626 pairs from 21,575 Posts in
#: 238 Channels, Observation stride 1, anchored at the default settling age of
#: 24 hours. Every span was crossed by at least 14,000 pairs, so none took the
#: older seed's shape. The flat 1.1 to 1.6 hour span is where the fit learned a
#: dip and pool-adjacent-violators levelled it. The fit was already anchored at
#: 24 hours, so rescaling to 1 there changed nothing; rounding to 4 places
#: leaves the share at 24 hours within 2e-5 of 1.
#: It replaces the first seed, a cross-Post measurement confounded by Channel
#: growth, so a fresh deployment estimates through real View observations.
SEED_KNOTS: Knots = tuple(
    zip(
        KNOT_AGES_HOURS,
        (
            0.0999,
            0.2196,
            0.3585,
            0.3585,
            0.4792,
            0.4986,
            0.5894,
            0.6753,
            0.7755,
            0.8797,
            1.0023,
            1.1165,
            1.2232,
            1.3564,
            1.6181,
            1.903,
        ),
        strict=True,
    )
)

#: The seed curve: Reach estimates through it before the first stored fit.
seed_curve: Curve = curve_from_knots(SEED_KNOTS)


@dataclass(frozen=True)
class ReachSettings:
    """The deployment settings Reach reads, stored under `reach`."""

    settling_age_hours: int = 24
    estimation_floor_hours: int = 3
    sample_size: int = 100
    # How often the worker refits the Settling curve (REACH-07).
    refit_interval_hours: int = 24


DEFAULT_REACH_SETTINGS = ReachSettings()

#: Wire name of each field, as the `reach` settings row stores it.
REACH_SETTING_FIELDS = {
    "settlingAgeHours": "settling_age_hours",
    "estimationFloorHours": "estimation_floor_hours",
    "reachSampleSize": "sample_size",
    "curveRefitIntervalHours": "refit_interval_hours",
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
    if result.refit_interval_hours < 1:
        raise ValueError("The curve refit interval must be at least 1 hour.")
    return result


@dataclass(frozen=True)
class Reach:
    """A Channel's Reach, `value=None` when it is not measured."""

    value: int | None = None
    estimated: bool = False


def _median(counts: list[float]) -> int:
    # `round`, a tie to the even integer. The counts are parsed from Telegram's
    # abbreviated display (`9.74K` is 9,740), so the half view an even set
    # produces sits below the precision of the input.
    return round(statistics.median(counts))


def estimated_views(
    views: int | None,
    age_hours: float | None,
    settings: ReachSettings,
    curve: Curve = seed_curve,
) -> float | None:
    """One Post's Estimated View count (ADR-025), `None` when too new to judge.

    Its View count once it was observed at the settling age or older; between
    the estimation floor and the settling age, the count divided by the curve's
    share at that age, anchored at the settling age. Reach's corrected counts
    are exactly these. `post_filters.estimated_views_sql` and the browser's
    `lib/posts/estimated-views.ts` are the other two copies, held to this one
    by `tests/fixtures/estimated_views.json`.
    """
    if views is None or age_hours is None:
        return None
    if age_hours < settings.estimation_floor_hours:
        return None
    if age_hours >= settings.settling_age_hours:
        return float(views)
    return views * curve(settings.settling_age_hours) / curve(age_hours)


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
    corrected = [
        estimate
        for views, age in pairs
        if age < settling
        and (estimate := estimated_views(views, age, settings, curve)) is not None
    ]
    counts = settled + corrected
    if len(counts) >= MIN_SAMPLES:
        return Reach(_median(counts), estimated=True)
    return Reach()


MS_PER_HOUR = 3_600_000


def sample_reach(
    posts: Sequence[SamplePost],
    probed_at_ms: int,
    settings: ReachSettings,
    curve: Curve = seed_curve,
) -> Reach:
    """A Directory entry's Reach from its probe sample (REACH-04).

    Each sample's age is the probe time minus its publication time, and the
    newest `settings.sample_size` samples are read, as `reach_by_channel` reads
    a followed Channel's newest Posts.
    """
    newest = sorted(posts, key=lambda post: post.timestamp, reverse=True)
    return compute_reach(
        (
            (views, (probed_at_ms - post.timestamp) / MS_PER_HOUR)
            for post in newest[: settings.sample_size]
            if post.timestamp > 0 and (views := views_of(post)) is not None
        ),
        settings,
        curve,
    )


# --------------------------------------------------------------------------
# Fitting the Settling curve (REACH-07)
# --------------------------------------------------------------------------

#: A span between two knots learns its shape from the data only when at
#: least this many pairs cross it; below, it takes the seed's.
MIN_PAIRS_PER_SPAN = 30


class ObservationPair(NamedTuple):
    """Two consecutive sightings of one Post, `early_age < late_age` (hours)."""

    early_age: float
    early_views: int
    late_age: float
    late_views: int


@dataclass(frozen=True)
class CurvePoints:
    """A Settling curve as data, so SQL and the browser can read it too (PFB-03).

    The knots of a fit or the seed, piecewise-linear log share over log age.
    Callable, so it is a `Curve` wherever one is taken.
    """

    points: Knots

    @cached_property
    def _curve(self) -> Curve:
        return curve_from_knots(self.points)

    def __call__(self, age_hours: float) -> float:
        return self._curve(age_hours)

    def wire(self) -> dict[str, Any]:
        return {"points": [list(point) for point in self.points]}


#: The seed curve as data (PFB-03).
SEED_CURVE = CurvePoints(SEED_KNOTS)


def _non_decreasing(values: Sequence[float]) -> list[float]:
    """Pool-adjacent-violators: the nearest non-decreasing sequence."""
    blocks: list[tuple[float, int]] = []  # (mean, size)
    for value in values:
        mean, size = value, 1
        while blocks and blocks[-1][0] > mean:
            prev_mean, prev_size = blocks.pop()
            mean = (prev_mean * prev_size + mean * size) / (prev_size + size)
            size += prev_size
        blocks.append((mean, size))
    return [mean for mean, size in blocks for _ in range(size)]


def fit_settling_curve(
    pairs: Iterable[ObservationPair], settling_age_hours: float, seed: Curve
) -> Knots | None:
    """The Settling curve the pairs describe, or `None` when no span has data.

    The unknowns are the curve's log rise across each span between knots. A
    pair says `log F(late) - log F(early) = log(late_views / early_views)`, and
    the left side is each span's rise times the share of that span, in log
    age, the pair covers: one equation however many knots it crosses. Spans
    crossed by fewer than `MIN_PAIRS_PER_SPAN` pairs keep the seed's rise, the
    rest are solved by least squares; the knot values are then made
    non-decreasing and shifted so the share at the settling age is 1. Every
    pair weighs the same, whichever Channel it came from.
    """
    rows = [
        (p.early_age, p.late_age, math.log(p.late_views / p.early_views))
        for p in pairs
        if p.early_views > 0 and p.late_views > 0
    ]
    data = np.array(rows, dtype=float).reshape(-1, 3)
    log_knots = np.log(KNOT_AGES_HOURS)
    starts, ends = log_knots[:-1], log_knots[1:]
    ages = np.log(np.clip(data[:, :2], KNOT_AGES_HOURS[0], KNOT_AGES_HOURS[-1]))
    covered = np.minimum(ages[:, 1:2], ends) - np.maximum(ages[:, 0:1], starts)
    cover = np.clip(covered, 0.0, None) / (ends - starts)
    learned = (cover > 0).sum(axis=0) >= MIN_PAIRS_PER_SPAN
    if not learned.any():
        return None
    rises = np.diff(np.log([seed(age) for age in KNOT_AGES_HOURS]))
    target = data[:, 2] - cover[:, ~learned] @ rises[~learned]
    rises[learned] = np.linalg.lstsq(cover[:, learned], target, rcond=None)[0]
    log_shares = _non_decreasing([0.0, *np.cumsum(rises).tolist()])
    anchor = float(np.interp(math.log(settling_age_hours), log_knots, log_shares))
    return tuple(
        (age, math.exp(share - anchor))
        for age, share in zip(KNOT_AGES_HOURS, log_shares, strict=True)
    )
