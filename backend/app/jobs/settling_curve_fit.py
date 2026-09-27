"""The Settling curve is refitted from View observations (REACH-07, ADR-024).

On the Sync worker only, like every scheduled job (`app/worker.py`). A tick is
a check, every minute: a fit is due when the newest one is older than the
`curveRefitIntervalHours` setting, or was anchored at a settling age other
than the one in force, or none exists. Checking rather than scheduling the
fit at the interval is what makes a settling-age change refit within a minute:
the setting is written by the API process, and the worker needs no message to
notice it. A tick that is not due reads two small rows.

A due fit that learns nothing stores nothing, so the next tick tries again.
That only happens while the observation table is too thin to fill a span,
which is also when the retry costs least.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import Session

from app.core.db import engine
from app.jobs.settings import load_reach_settings
from app.models_tg import utc_now
from app.services.async_db import run_db
from app.services.reach import ReachSettings, reach_settings_from
from app.services.settling_curve import newest_fit, refit

SETTLING_CURVE_FIT_JOB_ID = "settling_curve_fit"
SETTLING_CURVE_CHECK_SECONDS = 60


def fit_is_due(
    newest: tuple[int, datetime] | None, settings: ReachSettings, now: datetime
) -> bool:
    """Whether to refit, given the newest fit's `(settling age, fitted at)`."""
    if newest is None:
        return True
    settling_age, fitted_at = newest
    return settling_age != settings.settling_age_hours or now - fitted_at >= (
        timedelta(hours=settings.refit_interval_hours)
    )


def _tick() -> dict[str, int]:
    with Session(engine) as session:
        settings = reach_settings_from(load_reach_settings(session))
        fit = newest_fit(session)
        newest = None if fit is None else (fit.settling_age_hours, fit.fitted_at)
        if not fit_is_due(newest, settings, utc_now()):
            return {"fitted": 0}
        stored = refit(session, settings)
    return {"fitted": 0} if stored is None else {"fitted": 1, **stored}


async def run_settling_curve_fit() -> dict[str, int]:
    """One check, and a fit when one is due; the scheduler shows the counts."""
    return await run_db(_tick)
