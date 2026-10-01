"""Aggregate for `tg_settling_curve_fits` (REACH-07, ADR-024).

The only module that writes the table. Each row is one fit of the global
Settling curve from the View observations, and the newest row is the curve
Reach estimates through (`current_curve`); before the first fit, the seed in
`services/reach.py`. The fit itself is the pure `reach.fit_settling_curve`; this
module gathers its pairs and stores its answer. A fit that learned nothing
(`None`) is not stored, so an empty or thin table never replaces a good curve.

The pairs are read across every account through `unscoped_select`: the curve
is one fact about the corpus, and a Post counts once whoever follows it.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from sqlalchemy import func
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, select

from app.jobs.settings import load_reach_settings
from app.models_tg import Post, SettlingCurveFit, ViewObservation
from app.services.post_filters import (
    VIEW_SORTS,
    TreeGroup,
    ViewMeasure,
    ViewReading,
    tree_measures,
)
from app.services.reach import (
    MS_PER_HOUR,
    SEED_CURVE,
    CurvePoints,
    ObservationPair,
    ReachSettings,
    fit_settling_curve,
    reach_settings_from,
    seed_curve,
)
from app.services.tenancy import unscoped_select
from app.services.view_observations import observation_stride

_CORPUS_REASON = (
    "The Settling curve is one global fact about the corpus (ADR-024): every "
    "observed Post counts once, whoever follows its Channel."
)


class ObservedPairs(NamedTuple):
    pairs: list[ObservationPair]
    post_count: int
    channel_count: int


def newest_fit(session: Session) -> SettlingCurveFit | None:
    return session.exec(
        select(SettlingCurveFit).order_by(col(SettlingCurveFit.id).desc()).limit(1)
    ).first()


def current_curve(session: Session) -> CurvePoints:
    """The newest fit's curve, else the seed."""
    fit = newest_fit(session)
    if fit is None:
        return SEED_CURVE
    return CurvePoints("knots", tuple((age, share) for age, share in fit.knots))


def current_estimate(session: Session) -> tuple[CurvePoints, ReachSettings]:
    """The curve and the reach settings an Estimated View count reads through."""
    return current_curve(session), reach_settings_from(load_reach_settings(session))


def view_reading(
    session: Session, measure: ViewMeasure, *, sort: str = "newest"
) -> ViewReading:
    """What the views orders read for one request (PFB-03, ADR-025).

    The curve and the settings are read only when a views order will read an
    Estimated View count. Per request, never stored, so a refit reaches the
    next page.
    """
    if measure == "views" or sort not in VIEW_SORTS:
        return ViewReading(measure)
    return ViewReading(measure, *current_estimate(session))


def tree_readings(
    session: Session, tree: TreeGroup | None
) -> dict[ViewMeasure, ViewReading]:
    """One reading per measure a Post filter's views bounds name (PTR-03).

    The curve is read only when a bound names the Estimated View count.
    """
    measures = tree_measures(tree) if tree is not None else frozenset()
    readings: dict[ViewMeasure, ViewReading] = {}
    if "views" in measures:
        readings["views"] = ViewReading("views")
    if "estimated" in measures:
        readings["estimated"] = ViewReading("estimated", *current_estimate(session))
    return readings


def observed_pairs(session: Session) -> ObservedPairs:
    """Each Post's consecutive sightings as pairs, and who they came from.

    Consecutive only, because they telescope: a Post seen 100 times gives 99
    pairs rather than 4,950 correlated ones. A pair with a zero View count is
    dropped, since the fit reads the ratio's logarithm.
    """
    # ponytail: every pair in memory at once; the row cap bounds it at ~1M
    # sightings, stream with `yield_per` if the cap grows well past that.
    window: dict[str, Any] = {
        "partition_by": ViewObservation.post_uuid,
        "order_by": ViewObservation.observed_at,
    }
    sightings = (
        sa_select(
            col(ViewObservation.post_uuid),
            col(Post.channel_name),
            (
                func.lag(col(ViewObservation.observed_at)).over(**window)
                - col(ViewObservation.published_at)
            ).label("early_ms"),
            func.lag(col(ViewObservation.views_count))
            .over(**window)
            .label("early_views"),
            (
                col(ViewObservation.observed_at) - col(ViewObservation.published_at)
            ).label("late_ms"),
            col(ViewObservation.views_count).label("late_views"),
        )
        .join(Post, col(Post.id) == col(ViewObservation.post_uuid))
        .subquery()
    )
    rows = session.execute(
        unscoped_select(
            sa_select(sightings).where(
                sightings.c.early_views > 0, sightings.c.late_views > 0
            ),
            reason=_CORPUS_REASON,
        )
    ).all()
    pairs = [
        ObservationPair(
            row.early_ms / MS_PER_HOUR,
            row.early_views,
            row.late_ms / MS_PER_HOUR,
            row.late_views,
        )
        for row in rows
    ]
    return ObservedPairs(
        pairs,
        len({row.post_uuid for row in rows}),
        len({row.channel_name for row in rows}),
    )


def refit(session: Session, settings: ReachSettings) -> dict[str, int] | None:
    """Fit the curve and store it, or store nothing when no span learned.

    Returns the stored row's counts for the job status, `None` for no fit.
    """
    observed = observed_pairs(session)
    knots = fit_settling_curve(observed.pairs, settings.settling_age_hours, seed_curve)
    if knots is None:
        return None
    result = {
        "settlingAgeHours": settings.settling_age_hours,
        "observationStride": observation_stride(session),
        "pairs": len(observed.pairs),
        "posts": observed.post_count,
        "channels": observed.channel_count,
    }
    session.add(
        SettlingCurveFit(
            knots=[list(knot) for knot in knots],
            settling_age_hours=result["settlingAgeHours"],
            observation_stride=result["observationStride"],
            pair_count=result["pairs"],
            post_count=result["posts"],
            channel_count=result["channels"],
        )
    )
    session.commit()
    return result
