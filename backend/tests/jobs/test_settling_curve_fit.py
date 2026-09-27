"""The daily Settling curve fit (REACH-07, ADR-024).

Two seams. The fit is a pure function of (pairs, settling age, seed), driven
with synthetic pairs from a known curve. The job is driven through its runner
on database rows: it gathers consecutive sightings, stores a fit when one is
due, and Reach then estimates through the newest stored fit.

## Watched to fail

* skip `_non_decreasing` -> the monotone case
* drop the anchor shift -> the anchored case
* `>` instead of `>=` against `MIN_PAIRS_PER_SPAN` -> the 30-pair span falls back
* learn every span, however thin -> the 29-pair span leaves the seed
* store a fit with no learned span -> the empty-table case gains a row
* pair every sighting with every other rather than the next -> the count case
* compare the fit's age alone, not its settling age -> the settling-age case
* retry a fit that learned nothing every minute, or never after an hour, or
  ignore a settling-age change during the wait -> the retry case
* keep the seed in `reach_by_channel` or the probe -> the two Reach cases
"""

from __future__ import annotations

import asyncio
import math
import random
import time
from datetime import timedelta

import pytest
from sqlmodel import Session, func, select

from app.core.db import engine
from app.jobs.settling_curve_fit import fit_is_due, run_settling_curve_fit
from app.models_tg import Post, SettlingCurveFit, ViewObservation, utc_now
from app.services.channel_directory import record_probe_result
from app.services.channels import reach_by_channel
from app.services.reach import (
    KNOT_AGES_HOURS,
    ObservationPair,
    Reach,
    ReachSettings,
    curve_from_knots,
    fit_settling_curve,
    seed_curve,
)
from app.services.settings_registry import (
    REACH_KEY,
    SETTLING_CURVE_RUNTIME_KEY,
    VIEW_OBSERVATIONS_KEY,
)
from app.services.settings_store import put_global_setting
from tests.utils.setting_groups import add_test_channel

HOUR_MS = 3_600_000
T0 = 1_760_000_000_000


def _truth(age: float) -> float:
    return age / (age + 6)


def _pairs_from_truth(posts: int, seed: int = 7) -> list[ObservationPair]:
    """Six sightings per Post at log-uniform ages from 20 minutes to 8 days."""
    rng = random.Random(seed)
    pairs = []
    for _ in range(posts):
        settled = rng.randint(1_000, 100_000)
        ages = sorted(10 ** rng.uniform(-0.5, 2.3) for _ in range(6))
        for early, late in zip(ages, ages[1:], strict=False):
            pairs.append(
                ObservationPair(
                    early,
                    round(settled * _truth(early)),
                    late,
                    round(settled * _truth(late)),
                )
            )
    return pairs


def _across(knot: int, count: int, ratio: float) -> list[ObservationPair]:
    """`count` pairs from one knot to the next, the later count `ratio` times."""
    early, late = KNOT_AGES_HOURS[knot], KNOT_AGES_HOURS[knot + 1]
    return [ObservationPair(early, 1_000, late, round(1_000 * ratio))] * count


def _share(knots: tuple[tuple[float, float], ...], knot: int) -> float:
    return knots[knot][1]


# --------------------------------------------------------------------------
# The fit
# --------------------------------------------------------------------------


def test_the_fit_recovers_a_known_curve() -> None:
    knots = fit_settling_curve(_pairs_from_truth(400), 24, seed_curve)

    assert knots is not None
    for age, share in knots:
        assert share == pytest.approx(_truth(age) / _truth(24), abs=0.02)


def test_the_fit_is_monotone() -> None:
    """Counts that fall with age are data, and the curve still never falls."""
    rng = random.Random(3)
    pairs = [
        ObservationPair(e, round(1000 * (2 - math.log10(e))), e * 3, 1000)
        for e in (10 ** rng.uniform(-0.3, 1.7) for _ in range(500))
    ] + _pairs_from_truth(100)

    knots = fit_settling_curve(pairs, 24, seed_curve)

    assert knots is not None
    shares = [share for _age, share in knots]
    assert shares == sorted(shares)


@pytest.mark.parametrize("settling", [12, 24, 100])
def test_the_fit_is_anchored_at_the_settling_age(settling: int) -> None:
    knots = fit_settling_curve(_pairs_from_truth(400), settling, seed_curve)

    assert knots is not None
    assert curve_from_knots(knots)(settling) == pytest.approx(1.0)


def test_a_span_below_30_pairs_takes_the_seeds_shape() -> None:
    """Span 2 has 40 pairs and learns 1.5; span 8 learns 1.3 at 30, not at 29."""
    seeded = seed_curve(KNOT_AGES_HOURS[9]) / seed_curve(KNOT_AGES_HOURS[8])

    learned = fit_settling_curve(
        _across(2, 40, 1.5) + _across(8, 30, 1.3), 24, seed_curve
    )
    thin = fit_settling_curve(_across(2, 40, 1.5) + _across(8, 29, 1.3), 24, seed_curve)

    assert learned is not None and thin is not None
    assert _share(learned, 3) / _share(learned, 2) == pytest.approx(1.5, rel=1e-3)
    assert _share(learned, 9) / _share(learned, 8) == pytest.approx(1.3, rel=1e-3)
    assert _share(thin, 9) / _share(thin, 8) == pytest.approx(seeded)


def test_a_fit_with_no_learned_span_is_nothing() -> None:
    assert fit_settling_curve(_across(5, 29, 1.2), 24, seed_curve) is None
    assert fit_settling_curve([], 24, seed_curve) is None


def test_the_seed_holds_where_no_fit_exists() -> None:
    """A curve made from knots is flat outside them and log-linear between."""
    curve = curve_from_knots([[1.0, 0.25], [4.0, 1.0]])

    assert curve(0.1) == pytest.approx(0.25)
    assert curve(2.0) == pytest.approx(0.5)
    assert curve(500) == pytest.approx(1.0)


# --------------------------------------------------------------------------
# The job
# --------------------------------------------------------------------------


def _observe(channel: str, sightings: list[list[tuple[float, int]]]) -> None:
    """One Post per list of `(age in hours, View count)` sightings."""
    with Session(engine) as session:
        add_test_channel(session, channel)
        for post_id, seen in enumerate(sightings, start=1):
            post = Post(
                channel_name=channel, post_id=post_id, text="p", timestamp=T0 + post_id
            )
            session.add(post)
            session.flush()
            for age, views in seen:
                session.add(
                    ViewObservation(
                        post_uuid=post.id,
                        observed_at=post.timestamp + round(age * HOUR_MS),
                        views_count=views,
                        published_at=post.timestamp,
                    )
                )
        session.commit()


def _enough(channel: str) -> None:
    """40 Posts seen at 1h, 5h and 30h: 80 consecutive pairs."""
    _observe(channel, [[(1, 200), (5, 600), (30, 1000)]] * 40)


def _fits() -> list[tuple[int, int, int, int, int]]:
    with Session(engine) as session:
        return [
            (
                f.settling_age_hours,
                f.observation_stride,
                f.pair_count,
                f.post_count,
                f.channel_count,
            )
            for f in session.exec(
                select(SettlingCurveFit).order_by(SettlingCurveFit.id)  # type: ignore[arg-type]
            )
        ]


def _store_fit(
    knots: list[list[float]], *, hours_ago: float, settling: int = 24
) -> None:
    with Session(engine) as session:
        session.add(
            SettlingCurveFit(
                fitted_at=utc_now() - timedelta(hours=hours_ago),
                knots=knots,
                settling_age_hours=settling,
                observation_stride=1,
                pair_count=100,
                post_count=50,
                channel_count=2,
            )
        )
        session.commit()


def _run() -> dict[str, int]:
    return asyncio.run(run_settling_curve_fit())


def test_a_fit_counts_consecutive_pairs_posts_channels_and_the_stride() -> None:
    """A Post seen once teaches nothing; one seen three times gives two pairs."""
    with Session(engine) as session:
        put_global_setting(session, VIEW_OBSERVATIONS_KEY, {"stride": 4})
    _enough("fit-a")
    _observe("fit-b", [[(2, 300), (20, 900)]] * 5 + [[(3, 400)]] * 7)

    assert _run()["fitted"] == 1
    assert _fits() == [(24, 4, 85, 45, 2)]


def test_a_settling_age_change_refits_at_once() -> None:
    _enough("fit-age")
    _run()
    not_due = _run()
    with Session(engine) as session:
        put_global_setting(session, REACH_KEY, {"settlingAgeHours": 12})
    _run()

    assert not_due == {"fitted": 0}
    assert [fit[0] for fit in _fits()] == [24, 12]
    with Session(engine) as session:
        newest = session.exec(
            select(SettlingCurveFit).order_by(SettlingCurveFit.id.desc())  # type: ignore[union-attr]
        ).first()
        assert newest is not None
        assert curve_from_knots(newest.knots)(12) == pytest.approx(1.0)


def test_an_empty_observation_table_leaves_the_previous_fit_current() -> None:
    _store_fit([[1.0, 0.5], [24.0, 1.0]], hours_ago=48)

    assert _run() == {"fitted": 0, "attempted": 1}
    with Session(engine) as session:
        assert (
            session.exec(select(func.count()).select_from(SettlingCurveFit)).one() == 1
        )


def _failed_minutes_ago(minutes: int, settling: int = 24) -> None:
    with Session(engine) as session:
        put_global_setting(
            session,
            SETTLING_CURVE_RUNTIME_KEY,
            {
                "failedAt": (utc_now() - timedelta(minutes=minutes)).isoformat(),
                "settlingAgeHours": settling,
            },
        )


def test_a_fit_that_learned_nothing_waits_an_hour_to_retry() -> None:
    """A thin table is read once an hour, not every minute, until the settling
    age changes."""
    first = _run()
    again = _run()
    _failed_minutes_ago(59)
    within_the_hour = _run()
    _failed_minutes_ago(61)
    after_the_hour = _run()
    _failed_minutes_ago(1)
    with Session(engine) as session:
        put_global_setting(session, REACH_KEY, {"settlingAgeHours": 12})
    new_settling_age = _run()

    assert first == {"fitted": 0, "attempted": 1}
    assert again == within_the_hour == {"fitted": 0}
    assert after_the_hour == new_settling_age == {"fitted": 0, "attempted": 1}


@pytest.mark.parametrize(
    ("newest", "interval", "due"),
    [
        (None, 24, True),
        ((24, 23), 24, False),
        ((24, 24), 24, True),
        ((24, 2), 1, True),
        ((12, 0), 24, True),
    ],
)
def test_a_fit_is_due_at_the_interval_or_a_new_settling_age(
    newest: tuple[int, int] | None, interval: int, due: bool
) -> None:
    now = utc_now()
    last = None if newest is None else (newest[0], now - timedelta(hours=newest[1]))
    settings = ReachSettings(refit_interval_hours=interval)

    assert fit_is_due(last, None, settings, now) is due


# --------------------------------------------------------------------------
# Reach estimates through the newest fit
# --------------------------------------------------------------------------

#: Older fit: a 12 to 13 hour count is a quarter of its Settled value. Newer: half.
_OLDER = [[1.0, 0.25], [13.0, 0.25], [24.0, 1.0], [168.0, 1.0]]
_NEWER = [[1.0, 0.5], [13.0, 0.5], [24.0, 1.0], [168.0, 1.0]]


def test_a_followed_channels_reach_uses_the_newest_fit() -> None:
    with Session(engine) as session:
        add_test_channel(session, "fit-reach")
        for post_id in range(1, 6):
            ts = T0 + post_id
            session.add(
                Post(
                    channel_name="fit-reach",
                    post_id=post_id,
                    text="p",
                    timestamp=ts,
                    views_count=89,
                    views_observed_at=ts + 12 * HOUR_MS,
                )
            )
        session.commit()
    _store_fit(_OLDER, hours_ago=2)
    _store_fit(_NEWER, hours_ago=1)

    with Session(engine) as session:
        assert reach_by_channel(session, ["fit-reach"]) == {
            "fit-reach": Reach(178, estimated=True)
        }


def test_a_directory_probe_estimates_through_the_newest_fit() -> None:
    _store_fit(_OLDER, hours_ago=2)
    _store_fit(_NEWER, hours_ago=1)
    now = int(time.time() * 1000)
    page = {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "samples": [
            {
                "id": 100 + i,
                "text": "words",
                "date": "2026-09-27T00:00:00+00:00",
                "timestamp": now - 13 * HOUR_MS,
                "channelName": "fit_probe",
                "media": {"kinds": [], "viewsCount": 860},
            }
            for i in range(5)
        ],
    }
    with Session(engine) as session:
        after = record_probe_result(session, "fit_probe", page)

    assert (after["reach"], after["reachEstimated"]) == (1720, True)
