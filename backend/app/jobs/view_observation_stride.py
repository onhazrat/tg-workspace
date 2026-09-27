"""The Observation stride adapts to the row cap (REACH-06, ADR-024).

Once an hour, on the Sync worker only like every scheduled job
(`app/worker.py`): read the View observation table's size, its inflow over the
last 6 hours and the rows expiring within the next 6, let `next_stride` decide,
and store the answer. A doubling deletes the rows the new stride no longer
selects, so the table's disk use has a ceiling; a halving deletes nothing and
the sample grows back as sync writes.
"""

from __future__ import annotations

import time

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.async_db import run_db
from app.services.view_observations import (
    apply_stride,
    next_stride,
    observation_stride,
    table_load,
)

VIEW_OBSERVATION_STRIDE_JOB_ID = "view_observation_stride"
VIEW_OBSERVATION_STRIDE_INTERVAL_SECONDS = 60 * 60


def _adapt() -> dict[str, int]:
    with Session(engine) as session:
        load = table_load(session, int(time.time() * 1000))
        old = observation_stride(session)
        new = next_stride(
            load.rows,
            load.inflow,
            load.expiring,
            settings.VIEW_OBSERVATION_ROW_CAP,
            old,
        )
        deleted = apply_stride(session, old, new)
    return {**load._asdict(), "stride": new, "deleted": deleted}


async def run_view_observation_stride() -> dict[str, int]:
    """One controller tick; the scheduler surfaces the numbers it decided on."""
    return await run_db(_adapt)
