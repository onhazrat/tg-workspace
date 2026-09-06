"""What the probe lane spent: sole writer of `tg_directory_probe_usage` (ticket 04).

Aggregate. It owns one table, and nothing else writes it.

A module of its own rather than more of `channel_directory.py`, for the reason
`quota_limits.py` is separate from `quota.py`: an aggregate owns one table, and
folding a second one in is how the sole-writer rule stops being checkable.

## Why this is not a Budget

Ticket 23 closed probe traffic as charged to nobody and the argument is
untouched here. `DirectoryEntry` is `Scope.CORPUS`, so a verdict is deployment-
wide knowledge every account benefits from; billing one account for it makes
that account's Budget a proxy for deployment load, which is what splitting the
three Budgets exists to stop. And the three derive totally from
`SyncJobState.sync_mode`, so there is no mode a fourth could come from — adding
one would mean `budget_for_sync_mode` stops being a total function over that
Literal.

What ticket 04 changed is not who pays but how the traffic starts. The harvest
sweep enqueues handles nobody asked for, so probing became something that runs
unprompted rather than something an Operator triggers. A tally is the answer to
that, and a tally is not a limit: nothing here refuses anything, and there is no
`assert_within_ceiling` twin. The rate control stays where the spec put it —
the refresh window, the probe lane's position behind every sync lane, and the
adaptive per-proxy wait.

## The charge accumulates

`ON CONFLICT DO UPDATE` adding to the stored value, exactly as
`quota.charge_requests` does and for the same reason: every probe that finishes
today lands on the same row, and `= excluded.requests` would leave the table
holding the size of the most recent probe.

A charge of zero writes nothing. A row of zero is indistinguishable from a real
day with no probing, and the day an Operator disabled the job should read as
absent rather than as measured-and-idle.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, func, select

from app.core.db import engine
from app.models_tg import DirectoryProbeUsage, utc_now
from app.services.tenancy import unscoped_select

logger = logging.getLogger(__name__)

#: Why the reads here do not go through `scoped_select`.
#:
#: Named once and passed to every call, so the three cannot drift into stating
#: different reasons for the same decision — the same discipline
#: `channel_directory.PROBE_SCOPE_REASON` keeps.
USAGE_SCOPE_REASON = (
    "The probe lane's spend is one number for the deployment, not one per "
    "account. The table has no owner column to scope by, deliberately: a probe "
    "answers a question about the corpus, so there is nobody whose Request it "
    "is. See `DirectoryProbeUsage`."
)


def today_utc() -> date:
    """The ledger day. UTC, because the reset is UTC midnight."""
    return datetime.now(UTC).date()


def record_probe_requests(
    session: Session, requests: int, *, day: date | None = None
) -> None:
    """Add `requests` to what the probe lane has spent today. Commits."""
    if requests <= 0:
        return

    ledger_day = day if day is not None else today_utc()
    now = utc_now()
    statement = (
        pg_insert(DirectoryProbeUsage)
        .values(
            day=ledger_day,
            requests=requests,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["day"],
            set_={
                # The bare column renders as `tg_directory_probe_usage.requests`
                # — the row already there, as against `excluded.requests`, which
                # is what we are inserting.
                "requests": col(DirectoryProbeUsage.requests) + requests,
                "updated_at": now,
            },
        )
    )
    session.execute(statement)
    session.commit()


def charge_probe_requests(requests: int) -> None:
    """Record one drained probe message's Requests. Opens its own session.

    The lane consumer's exit path, factored out here so this module — not
    `jobs/sync_queue.py` — owns what happens when the write fails.

    Swallows its own failures, for the reason `quota.charge_sync_job` does: this
    runs after the probe has finished and its verdict is committed, so raising
    would turn a recorded verdict into a failed message to report an accounting
    problem. The cost of the swallow is bounded and worth stating — one
    message's Requests go unreported and the next write succeeds. Nothing reads
    this number to decide anything, so under-reporting costs an Operator
    accuracy on a dashboard and costs the crawl nothing.
    """
    if requests <= 0:
        return
    try:
        with Session(engine) as session:
            record_probe_requests(session, requests)
    except Exception:  # noqa: BLE001
        logger.warning("could not record %s probe-lane request(s)", requests)


def requests_on(session: Session, day: date | None = None) -> int:
    """What the probe lane spent on one day. Absent row reads as zero."""
    ledger_day = day if day is not None else today_utc()
    row = session.get(DirectoryProbeUsage, ledger_day)
    return int(row.requests) if row is not None else 0


def requests_since(session: Session, since: date) -> int:
    """What the probe lane spent from `since` to now, inclusive.

    One `sum`, never `sum(row.requests for row in ...)`: the caller wants an
    integer and hydrating a row per day to produce it is the "compute it for
    everything, read one field" shape this repo has already had to unwind.
    """
    statement = unscoped_select(
        select(func.coalesce(func.sum(col(DirectoryProbeUsage.requests)), 0)).where(
            col(DirectoryProbeUsage.day) >= since
        ),
        reason=USAGE_SCOPE_REASON,
    )
    return int(session.exec(statement).one())
