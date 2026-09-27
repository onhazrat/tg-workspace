"""The Settling curve is refitted from View observations (REACH-07, ADR-024).

On the Sync worker only, like every scheduled job (`app/worker.py`). A tick is
a check, every minute: a fit is due when the newest one is older than the
`curveRefitIntervalHours` setting, or was anchored at a settling age other
than the one in force, or none exists. Checking rather than scheduling the
fit at the interval is what makes a settling-age change refit within a minute:
the setting is written by the API process, and the worker needs no message to
notice it. A tick that is not due reads three small rows.

A due fit that learns nothing stores no fit, so on its own it would come due
again the next minute and read every View observation 1,440 times a day while
the table is thin. It records the attempt instead (`SETTLING_CURVE_RUNTIME_KEY`)
and is not tried again for `RETRY_AFTER_FAILED_FIT`, unless the settling age
changes.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import Session

from app.core.db import engine
from app.jobs.settings import load_reach_settings
from app.models_tg import utc_now
from app.services.async_db import run_db
from app.services.reach import ReachSettings, reach_settings_from
from app.services.settings_registry import SETTLING_CURVE_RUNTIME_KEY
from app.services.settings_store import get_global_setting, put_global_setting
from app.services.settling_curve import newest_fit, refit

SETTLING_CURVE_FIT_JOB_ID = "settling_curve_fit"
SETTLING_CURVE_CHECK_SECONDS = 60
RETRY_AFTER_FAILED_FIT = timedelta(hours=1)

#: `(settling age, when)` of a fit or of an attempt that learned nothing.
Attempt = tuple[int, datetime]


def fit_is_due(
    newest: Attempt | None,
    failed: Attempt | None,
    settings: ReachSettings,
    now: datetime,
) -> bool:
    """Whether to refit, given the newest fit and the last failed attempt."""
    age = settings.settling_age_hours
    if failed is not None and failed[0] == age:
        if now - failed[1] < RETRY_AFTER_FAILED_FIT:
            return False
    if newest is None:
        return True
    return newest[0] != age or now - newest[1] >= timedelta(
        hours=settings.refit_interval_hours
    )


def _last_failed(session: Session) -> Attempt | None:
    """The recorded failed attempt; a hand-edited row reads as none."""
    stored = get_global_setting(session, SETTLING_CURVE_RUNTIME_KEY)
    try:
        return int(stored["settlingAgeHours"]), datetime.fromisoformat(
            stored["failedAt"]
        )
    except KeyError, TypeError, ValueError:
        return None


def _tick() -> dict[str, int]:
    with Session(engine) as session:
        settings = reach_settings_from(load_reach_settings(session))
        fit = newest_fit(session)
        newest = None if fit is None else (fit.settling_age_hours, fit.fitted_at)
        now = utc_now()
        if not fit_is_due(newest, _last_failed(session), settings, now):
            return {"fitted": 0}
        stored = refit(session, settings)
        if stored is None:
            put_global_setting(
                session,
                SETTLING_CURVE_RUNTIME_KEY,
                {
                    "failedAt": now.isoformat(),
                    "settlingAgeHours": settings.settling_age_hours,
                },
            )
            return {"fitted": 0, "attempted": 1}
    return {"fitted": 1, **stored}


async def run_settling_curve_fit() -> dict[str, int]:
    """One check, and a fit when one is due; the scheduler shows the counts."""
    return await run_db(_tick)
