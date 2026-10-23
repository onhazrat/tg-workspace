"""Sole writer of `tg_request_records` and its two totals tables (RQS-01, ADR-035).

Three tiers of one fact. `flush_recorded_requests` writes each Request from the
buffer `core/request_recording.py` fills. `roll_up_request_totals` rebuilds the
hourly totals of every hour a flush touched, from the Requests, and then the
daily totals of those days, from the hourly ones. The totals are derived, so
they belong to this aggregate the way `post_references.py` owns its citation
tables: nothing else may write them, or a second writer adds where the rollup
replaces.

**The rollup replaces, it never adds.** Each run recomputes whole hours, so
running it twice changes nothing and a late Request (an `at` in an hour already
rolled up) only makes its hour be recomputed. Which hours to recompute comes
from `recorded_at`, the flush time on the database's clock, against a
watermark kept in the `request_rollup` settings row. The watermark is moved
back by `_WATERMARK_OVERLAP` on each read, because a flush whose transaction
began before the last run and committed after it carries a `recorded_at` the
watermark already passed; reading those rows twice costs nothing.

`request_breakdown` reads the tiers for a range cut to the minute: daily totals
for the whole days in it, hourly totals for the whole hours of a cut day, and
the Requests themselves for the minutes left over.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import Date, case, cast, delete, func, insert, or_
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, select

from app.core.db import engine
from app.core.request_recording import Outcome, RequestKind, drain
from app.models_tg import RequestDaily, RequestHourly, RequestRecordRow
from app.services.settings_registry import REQUEST_ROLLUP_KEY
from app.services.settings_store import get_global_setting, put_global_setting

logger = logging.getLogger(__name__)

ChargedFilter = Literal["all", "charged", "uncharged"]

_WATERMARK_OVERLAP = timedelta(minutes=1)
_HOUR = timedelta(hours=1)
_DAY = timedelta(days=1)

#: Held from the drain to the commit, so a flush returns only once every
#: Request buffered before it is written, even one another flush took first.
#: The worker flushes beside the ledger after its job already reads finished,
#: and a reader flushing then would otherwise find the buffer empty and read
#: before that write commits (RQS-11).
_flush_lock = threading.Lock()


def flush_recorded_requests() -> int:
    """Write every buffered Request. Blocking: callers on the loop use a thread.

    Swallows its own failure, as `quota.charge_sync_job` does: a stats write
    must not fail the sync it measures. The records it held are lost, which is
    the gap ADR-035 accepts for a crash.
    """
    with _flush_lock:
        records = drain()
        if not records:
            return 0
        try:
            with Session(engine) as session:
                session.execute(
                    insert(RequestRecordRow), [asdict(record) for record in records]
                )
                session.commit()
        except Exception:  # noqa: BLE001
            logger.exception("Requests: could not record %d Request(s)", len(records))
            return 0
        return len(records)


# --------------------------------------------------------------------------
# The rollup
# --------------------------------------------------------------------------

_TOTALS_KEY = (
    "kind",
    "account_id",
    "channel",
    "outcome",
    "cause",
    "page_type",
    "charged",
)


#: Kinds whose totals carry no Channel: their Requests name the handle they
#: probed, but the tab shows the kind as one aggregate row (RQS-12, tab
#: decision 7). Handle checks join it (RQS-14).
AGGREGATE_KINDS = (RequestKind.PROBE.value, RequestKind.HANDLE.value)


def _sum(column: Any) -> Any:
    return func.coalesce(func.sum(column), 0)


def _totals_channel(model: Any) -> Any:
    """A row's Channel in the totals: null for an aggregate kind."""
    return case((col(model.kind).in_(AGGREGATE_KINDS), None), else_=col(model.channel))


def _rebuild_hours(session: Session, hours: list[datetime]) -> None:
    hour_of = func.date_trunc("hour", col(RequestRecordRow.at))
    keys = [
        *(
            _totals_channel(RequestRecordRow)
            if k == "channel"
            else getattr(RequestRecordRow, k)
            for k in _TOTALS_KEY
        ),
        col(RequestRecordRow.lane),
        col(RequestRecordRow.best_effort),
    ]
    session.execute(delete(RequestHourly).where(col(RequestHourly.hour).in_(hours)))
    rows = (
        sa_select(
            hour_of,
            *keys,
            func.count(),
            _sum(RequestRecordRow.new_posts),
            _sum(RequestRecordRow.repeated_posts),
        )
        .where(
            col(RequestRecordRow.at) >= min(hours),
            col(RequestRecordRow.at) < max(hours) + _HOUR,
            hour_of.in_(hours),
        )
        .group_by(hour_of, *keys)
    )
    session.execute(
        insert(RequestHourly).from_select(
            [
                "hour",
                *_TOTALS_KEY,
                "lane",
                "best_effort",
                "requests",
                "new_posts",
                "repeated_posts",
            ],
            rows,
        )
    )


def _rebuild_days(session: Session, days: list[date]) -> None:
    day_of = cast(col(RequestHourly.hour), Date)
    keys = [getattr(RequestHourly, k) for k in _TOTALS_KEY]
    session.execute(delete(RequestDaily).where(col(RequestDaily.day).in_(days)))
    rows = (
        sa_select(
            day_of,
            *keys,
            _sum(RequestHourly.requests),
            _sum(RequestHourly.new_posts),
            _sum(RequestHourly.repeated_posts),
        )
        .where(
            col(RequestHourly.hour) >= datetime.combine(min(days), datetime.min.time()),
            col(RequestHourly.hour)
            < datetime.combine(max(days), datetime.min.time()) + _DAY,
            day_of.in_(days),
        )
        .group_by(day_of, *keys)
    )
    session.execute(
        insert(RequestDaily).from_select(
            ["day", *_TOTALS_KEY, "requests", "new_posts", "repeated_posts"], rows
        )
    )


def roll_up_request_totals() -> int:
    """Recompute every hour touched since the last run, then those days.

    Returns how many hours it rebuilt. Blocking, and one transaction: the
    watermark moves only if the totals it covers were written.
    """
    with Session(engine) as session:
        now = session.exec(select(func.timezone("utc", func.now()))).one()
        stored = get_global_setting(session, REQUEST_ROLLUP_KEY) or {}
        through = stored.get("through")
        touched = select(func.date_trunc("hour", col(RequestRecordRow.at))).distinct()
        if isinstance(through, str):
            since = datetime.fromisoformat(through) - _WATERMARK_OVERLAP
            touched = touched.where(col(RequestRecordRow.recorded_at) >= since)
        hours = sorted(session.exec(touched).all())
        if hours:
            _rebuild_hours(session, hours)
            _rebuild_days(session, sorted({hour.date() for hour in hours}))
        # Commits the rebuilt totals with it, so they and the watermark move
        # together or not at all.
        put_global_setting(session, REQUEST_ROLLUP_KEY, {"through": now.isoformat()})
        return len(hours)


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------


@dataclass
class Totals:
    """One row of the Breakdown: Requests by outcome, and the Posts they brought."""

    requests: int = 0
    useful: int = 0
    idle: int = 0
    wasted: int = 0
    charged: int = 0
    new_posts: int = 0
    repeated_posts: int = 0

    def add(
        self, outcome: str, charged: bool, requests: int, new: int, repeated: int
    ) -> None:
        self.requests += requests
        if outcome == Outcome.USEFUL:
            self.useful += requests
        elif outcome == Outcome.IDLE:
            self.idle += requests
        else:
            self.wasted += requests
        if charged:
            self.charged += requests
        self.new_posts += new
        self.repeated_posts += repeated


@dataclass
class Breakdown:
    by_kind: dict[str, Totals] = field(default_factory=dict)
    #: Keyed by (Channel, kind); a Channel of `None` is an aggregate row.
    by_channel: dict[tuple[str | None, str], Totals] = field(default_factory=dict)


Span = tuple[datetime, datetime]


def _floor(moment: datetime, step: timedelta) -> datetime:
    if step == _DAY:
        return moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return moment.replace(minute=0, second=0, microsecond=0)


def _ceil(moment: datetime, step: timedelta) -> datetime:
    floored = _floor(moment, step)
    return floored if floored == moment else floored + step


def _split(spans: Iterable[Span], step: timedelta) -> tuple[list[Span], list[Span]]:
    """The whole `step`s inside each span, and the pieces left at either end."""
    whole: list[Span] = []
    rest: list[Span] = []
    for start, end in spans:
        lo, hi = _ceil(start, step), _floor(end, step)
        if lo < hi:
            whole.append((lo, hi))
            rest.extend([(start, lo), (hi, end)])
        else:
            rest.append((start, end))
    return whole, [(a, b) for a, b in rest if a < b]


def request_breakdown(
    session: Session, start: datetime, end: datetime, charged: ChargedFilter
) -> Breakdown:
    """Totals by kind and by Channel for `[start, end)`, naive UTC to the minute."""
    days, cut = _split([(start, end)], _DAY)
    hours, minutes = _split(cut, _HOUR)
    breakdown = Breakdown()
    tiers: list[tuple[Any, Any, list[tuple[Any, Any]]]] = [
        (RequestDaily, RequestDaily.day, [(a.date(), b.date()) for a, b in days]),
        (RequestHourly, RequestHourly.hour, hours),
        (RequestRecordRow, RequestRecordRow.at, minutes),
    ]
    for model, moment, spans in tiers:
        if not spans:
            continue
        within = or_(*((col(moment) >= a) & (col(moment) < b) for a, b in spans))
        _fold(session, breakdown, model, within, charged)
    return breakdown


def _fold(
    session: Session,
    breakdown: Breakdown,
    model: Any,
    within: Any,
    charged: ChargedFilter,
) -> None:
    """Add one tier's rows inside `within` to the Breakdown."""
    keys = [model.kind, _totals_channel(model), model.outcome, model.charged]
    requests = func.count() if model is RequestRecordRow else _sum(model.requests)
    query = sa_select(
        *keys, requests, _sum(model.new_posts), _sum(model.repeated_posts)
    ).where(within)
    if charged != "all":
        query = query.where(col(model.charged).is_(charged == "charged"))
    for kind, channel, outcome, is_charged, n, new, repeated in session.execute(
        query.group_by(*keys)
    ).all():
        for totals in (
            breakdown.by_kind.setdefault(kind, Totals()),
            breakdown.by_channel.setdefault((channel, kind), Totals()),
        ):
            totals.add(outcome, is_charged, int(n), int(new), int(repeated))
