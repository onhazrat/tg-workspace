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
the Requests themselves for the minutes left over. `request_trend` reads them
as buckets: 5 minutes from the Requests, hours, then days. Both read the finest
tier still kept for each stretch: past `REQUEST_RECORD_DAYS` a cut hour is read
whole from the hourly totals, and past `REQUEST_HOURLY_DAYS` a cut day whole
from the daily ones (RQS-06).
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import Date, Integer, case, cast, delete, func, insert, or_
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.core.request_recording import Outcome, RequestKind, drain
from app.models import User
from app.models_tg import (
    DirectoryProbeUsage,
    QuotaUsage,
    RequestDaily,
    RequestHourly,
    RequestRecordRow,
    utc_now,
)
from app.services.quota import Budget, resolve_charge_owner, usage_rows
from app.services.settings_registry import REQUEST_ROLLUP_KEY
from app.services.settings_store import get_global_setting, put_global_setting
from app.services.tenancy import unscoped_select

logger = logging.getLogger(__name__)

ChargedFilter = Literal["all", "charged", "uncharged"]

_WATERMARK_OVERLAP = timedelta(minutes=1)
_FIVE_MINUTES = timedelta(minutes=5)
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


def _syncs(model: Any) -> list[Any]:
    """Sync runs and failed ones: marked on one Request each, summed in the totals."""
    if model is RequestRecordRow:
        flag = col(RequestRecordRow.sync_failed)
        return [func.count(flag), _sum(cast(flag, Integer))]
    return [_sum(model.syncs), _sum(model.failed_syncs)]


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
            *_syncs(RequestRecordRow),
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
                "syncs",
                "failed_syncs",
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
            *_syncs(RequestHourly),
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
            [
                "day",
                *_TOTALS_KEY,
                "requests",
                "new_posts",
                "repeated_posts",
                "syncs",
                "failed_syncs",
            ],
            rows,
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
# Keeping (RQS-02)
# --------------------------------------------------------------------------

#: Rows per delete, each its own transaction, so a backlog never holds one
#: long transaction that pins the vacuum horizon (see `prune_finished_jobs`).
REQUEST_DELETE_BATCH = 5000


def _delete_before(session: Session, model: Any, moment: Any, cutoff: datetime) -> int:
    deleted = 0
    while True:
        batch = (
            sa_select(model.id).where(col(moment) < cutoff).limit(REQUEST_DELETE_BATCH)
        )
        result = session.execute(delete(model).where(col(model.id).in_(batch)))
        session.commit()
        count = int(getattr(result, "rowcount", 0) or 0)
        deleted += count
        if count < REQUEST_DELETE_BATCH:
            return deleted


def prune_request_stats(session: Session, now: datetime) -> tuple[int, int]:
    """Delete Requests past `REQUEST_RECORD_DAYS` and hourly totals past
    `REQUEST_HOURLY_DAYS`, measured on `at` and `hour`. Returns both counts.

    The daily totals are never pruned: they are the only tier reaching back
    past a month.
    """
    records = _delete_before(
        session,
        RequestRecordRow,
        RequestRecordRow.at,
        now - timedelta(days=settings.REQUEST_RECORD_DAYS),
    )
    hourly = _delete_before(
        session,
        RequestHourly,
        RequestHourly.hour,
        now - timedelta(days=settings.REQUEST_HOURLY_DAYS),
    )
    return records, hourly


# --------------------------------------------------------------------------
# The ledger check (RQS-15)
# --------------------------------------------------------------------------


def _recorded_charges(session: Session, day: date) -> Counter[tuple[Any, str]]:
    """The day's charged Requests per (who the ledger bills, Budget).

    Read from the per-Request rows, the one tier that keeps the Budget; the
    check runs the day after, well inside `REQUEST_RECORD_DAYS`. An Account
    that is null or gone is billed to the Operator, as `charge_sync_job` does.
    """
    start = datetime.combine(day, datetime.min.time())
    rows = session.execute(
        sa_select(
            col(RequestRecordRow.account_id),
            col(RequestRecordRow.budget),
            func.count(),
        )
        .where(
            col(RequestRecordRow.charged),
            col(RequestRecordRow.at) >= start,
            col(RequestRecordRow.at) < start + _DAY,
        )
        .group_by(col(RequestRecordRow.account_id), col(RequestRecordRow.budget))
    ).all()
    charges: Counter[tuple[Any, str]] = Counter()
    for account_id, budget, n in rows:
        charges[(resolve_charge_owner(session, account_id), str(budget))] += int(n)
    return charges


def check_request_ledger(day: date) -> int:
    """Compare a closed UTC day's charged Requests with the quota ledger.

    Per Account and Budget. Logs one warning naming every pair that differs,
    carrying the metric, and returns the total difference; a clean day logs
    nothing and returns 0. A sync running across midnight is charged on the
    day it finished but recorded on the day of each Request, so a busy
    midnight can show a small mismatch on both days.
    """
    with Session(engine) as session:
        recorded = _recorded_charges(session, day)
        ledger: Counter[tuple[Any, str]] = Counter(
            {
                (row.user_id, row.budget): row.requests
                for row in usage_rows(session, day=day)
            }
        )
    pairs = sorted(
        (str(account), budget, recorded[(account, budget)], ledger[(account, budget)])
        for account, budget in recorded.keys() | ledger.keys()
        if recorded[(account, budget)] != ledger[(account, budget)]
    )
    difference = sum(abs(r - booked) for _, _, r, booked in pairs)
    if pairs:
        # ponytail: the metric rides the log record, as there is no metrics
        # backend; a counter belongs there once one exists.
        logger.warning(
            "Requests: %s's charged Requests differ from the ledger: %s",
            day.isoformat(),
            "; ".join(
                f"{account} {budget} recorded {r}, ledger {booked}"
                for account, budget, r, booked in pairs
            ),
            extra={"metric": "request_ledger_mismatch", "value": difference},
        )
    return difference


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
    syncs: int = 0
    failed_syncs: int = 0
    #: Of `requests`, those known from the ledger alone: no outcome (RQS-16).
    ledger_only: int = 0

    def add(
        self,
        outcome: str,
        charged: bool,
        requests: int,
        new: int,
        repeated: int,
        syncs: tuple[int, int] = (0, 0),
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
        self.syncs += syncs[0]
        self.failed_syncs += syncs[1]

    def add_ledger(self, requests: int, charged: bool) -> None:
        """Requests the ledger alone knows of: no outcome, no Posts (RQS-16)."""
        self.requests += requests
        self.ledger_only += requests
        if charged:
            self.charged += requests


@dataclass
class Breakdown:
    by_kind: dict[str, Totals] = field(default_factory=dict)
    #: Keyed by (Channel, kind); a Channel of `None` is an aggregate row.
    by_channel: dict[tuple[str | None, str], Totals] = field(default_factory=dict)
    #: Keyed by (Account, kind): each Account's charged Requests alone, as an
    #: Uncharged one is no Account's spend (RQS-05).
    by_account: dict[tuple[uuid.UUID, str], Totals] = field(default_factory=dict)


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


@dataclass(frozen=True)
class Kept:
    """Where the two pruned tiers start: the Requests on an hour, the hourly
    totals on a day. Rounded up, so each tier is whole from there on."""

    records: datetime
    hourly: datetime


def _kept() -> Kept:
    now = utc_now()
    hourly = _ceil(now - timedelta(days=settings.REQUEST_HOURLY_DAYS), _DAY)
    records = _ceil(now - timedelta(days=settings.REQUEST_RECORD_DAYS), _HOUR)
    return Kept(records=max(records, hourly), hourly=hourly)


def _widen(start: datetime, end: datetime, kept: Kept) -> Span:
    """The range grown at either end to the grain of the finest tier kept there.

    A minute cut older than the Requests reads its whole hour, and an hour cut
    older than the hourly totals its whole day: the finest tier covering it,
    rather than nothing.
    """
    for step, horizon in ((_HOUR, kept.records), (_DAY, kept.hourly)):
        if start < horizon:
            start = _floor(start, step)
        if _floor(end, step) < horizon:
            end = _ceil(end, step)
    return start, end


@dataclass(frozen=True)
class Picked:
    """What the tab narrows every number to, besides the range."""

    charged: ChargedFilter = "all"
    accounts: Sequence[uuid.UUID] = ()
    #: Channels left out, by handle (RQS-04).
    left_out: Sequence[str] = ()
    #: Aggregate rows left out, by kind: the work with no Channel (RQS-04).
    left_out_kinds: Sequence[str] = ()


def _owner(model: Any) -> Any:
    """Who a row's charge is billed to: its Account, or the Operator when it
    names none, as the ledger bills it (`quota.resolve_charge_owner`)."""
    operator = (
        sa_select(col(User.id))
        .where(col(User.email) == settings.FIRST_SUPERUSER)
        .scalar_subquery()
    )
    return func.coalesce(col(model.account_id), operator)


def _filtered(query: Any, model: Any, picked: Picked) -> Any:
    """The tab's filters, the same on every tier and on every endpoint.

    Picking Accounts keeps their charged Requests alone: no Account pays for
    an Uncharged one, even one made for its sync (RQS-05). A Channel left out
    takes its own row with it, never an aggregate row's Requests that name its
    handle: a Handle check of it stays a Handle check (RQS-04).
    """
    if picked.charged != "all":
        query = query.where(col(model.charged).is_(picked.charged == "charged"))
    if picked.accounts:
        query = query.where(
            col(model.charged).is_(True), _owner(model).in_(picked.accounts)
        )
    channel = _totals_channel(model)
    if picked.left_out:
        query = query.where(channel.is_(None) | channel.not_in(picked.left_out))
    if picked.left_out_kinds:
        query = query.where(
            channel.is_not(None) | col(model.kind).not_in(picked.left_out_kinds)
        )
    return query


def _requests(model: Any) -> Any:
    return func.count() if model is RequestRecordRow else _sum(model.requests)


def request_breakdown(
    session: Session,
    start: datetime,
    end: datetime,
    picked: Picked = Picked(),  # noqa: B008
) -> Breakdown:
    """Totals by kind and by Channel for `[start, end)`, naive UTC to the minute."""
    days, cut = _split([_widen(start, end, _kept())], _DAY)
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
        _fold(session, breakdown, model, within, picked)
    for day in ledger_history(session, start, end, picked):
        parts = [breakdown.by_kind.setdefault(day.kind, Totals())]
        if day.account is not None:
            parts.append(
                breakdown.by_account.setdefault((day.account, day.kind), Totals())
            )
        for totals in parts:
            totals.add_ledger(day.requests, day.charged)
    return breakdown


def _fold(
    session: Session,
    breakdown: Breakdown,
    model: Any,
    within: Any,
    picked: Picked,
) -> None:
    """Add one tier's rows inside `within` to the Breakdown."""
    keys = [
        model.kind,
        _totals_channel(model),
        model.outcome,
        model.charged,
        _owner(model),
    ]
    query = sa_select(
        *keys,
        _requests(model),
        _sum(model.new_posts),
        _sum(model.repeated_posts),
        *_syncs(model),
    ).where(within)
    for kind, channel, outcome, is_charged, account, n, new, repeated, *runs in (
        session.execute(_filtered(query, model, picked).group_by(*keys))
    ).all():
        parts = [
            breakdown.by_kind.setdefault(kind, Totals()),
            breakdown.by_channel.setdefault((channel, kind), Totals()),
        ]
        if is_charged and account is not None:
            parts.append(breakdown.by_account.setdefault((account, kind), Totals()))
        for totals in parts:
            totals.add(
                outcome,
                is_charged,
                int(n),
                int(new),
                int(repeated),
                (int(runs[0]), int(runs[1])),
            )


def account_emails(session: Session, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Each Account's email; an Account deleted since is left out."""
    users = session.exec(select(User).where(col(User.id).in_(set(ids)))).all()
    return {user.id: user.email for user in users}


# --------------------------------------------------------------------------
# History before recording (RQS-16, decision 17)
# --------------------------------------------------------------------------

#: The work each Budget pays for. A Follow is charged to manual bulk, so the
#: ledger files it there.
_BUDGET_KINDS = {
    Budget.AUTO_SYNC.value: RequestKind.AUTO.value,
    Budget.MANUAL_BULK.value: RequestKind.BULK.value,
    Budget.MANUAL_SINGLE.value: RequestKind.SINGLE.value,
}


@dataclass(frozen=True)
class LedgerDay:
    """One of the ledger's daily totals: no Channel, no outcome."""

    day: date
    kind: str
    charged: bool
    account: uuid.UUID | None
    requests: int


def _recording_started(session: Session) -> date:
    """The first day with recorded Requests; today while none is rolled up."""
    first = session.exec(select(func.min(col(RequestDaily.day)))).one()
    return first or utc_now().date()


def ledger_history(
    session: Session, start: datetime, end: datetime, picked: Picked
) -> list[LedgerDay]:
    """The ledger's totals for each day `[start, end)` touches before recording.

    Read, never backfilled: the quota ledger's charged Requests per Account
    and Budget, and the probe lane's tally. Only a day's total is kept, so a
    day the range cuts is read whole. The tab's filters read them as rows
    with no Channel: a Channel left out keeps them all.
    """
    lo = start.date()
    hi = min(_ceil(end, _DAY).date(), _recording_started(session))
    if lo >= hi:
        return []
    days: list[LedgerDay] = []
    if picked.charged != "uncharged":
        query = select(QuotaUsage).where(
            col(QuotaUsage.day) >= lo, col(QuotaUsage.day) < hi
        )
        if picked.accounts:
            query = query.where(col(QuotaUsage.user_id).in_(picked.accounts))
        rows = session.exec(
            unscoped_select(
                query,
                reason=(
                    "The Requests tab reports every account's spend before "
                    "recording started. Gated on Permission.QUOTA_READ_ANY."
                ),
            )
        ).all()
        days += [
            LedgerDay(
                row.day,
                _BUDGET_KINDS.get(row.budget, RequestKind.OTHER.value),
                True,
                row.user_id,
                row.requests,
            )
            for row in rows
        ]
    if picked.charged != "charged" and not picked.accounts:
        probes = select(DirectoryProbeUsage).where(
            col(DirectoryProbeUsage.day) >= lo, col(DirectoryProbeUsage.day) < hi
        )
        days += [
            LedgerDay(row.day, RequestKind.PROBE.value, False, None, row.requests)
            for row in session.exec(probes).all()
        ]
    return [day for day in days if day.kind not in picked.left_out_kinds]


@dataclass
class TrendBucket:
    """One kind's Charged or Uncharged Requests in `[start, end)`, by outcome."""

    start: datetime
    end: datetime
    kind: str
    charged: bool
    useful: int = 0
    idle: int = 0
    wasted: int = 0
    #: A day before recording started, from the ledger: no outcome (RQS-16).
    ledger_only: int = 0


#: Where 5-minute buckets start: any midnight puts them on the clock's grid.
_GRID = datetime(2000, 1, 1)


def request_trend(
    session: Session,
    start: datetime,
    end: datetime,
    picked: Picked = Picked(),  # noqa: B008
) -> list[TrendBucket]:
    """`[start, end)` in buckets at the finest tier kept for each stretch.

    5 minutes from the Requests, hours from the hourly totals before them, and
    days from the daily totals before those. A bucket the range cuts is
    clipped to it; only a tier's own grain widens one, as in `_widen`.
    """
    kept = _kept()
    start, end = _widen(start, end, kept)
    buckets: dict[tuple[datetime, str, bool], TrendBucket] = {}
    stretches: list[tuple[Any, Any, Any, timedelta, Span]] = [
        (
            RequestDaily,
            col(RequestDaily.day),
            col(RequestDaily.day),
            _DAY,
            (start, min(end, kept.hourly)),
        ),
        (
            RequestHourly,
            col(RequestHourly.hour),
            col(RequestHourly.hour),
            _HOUR,
            (max(start, kept.hourly), min(end, kept.records)),
        ),
        (
            RequestRecordRow,
            col(RequestRecordRow.at),
            func.date_bin(_FIVE_MINUTES, col(RequestRecordRow.at), _GRID),
            _FIVE_MINUTES,
            (max(start, kept.records), end),
        ),
    ]
    for model, moment, bucket_of, step, (lo, hi) in stretches:
        if lo >= hi:
            continue
        keys = [bucket_of, model.kind, model.charged, model.outcome]
        query = sa_select(*keys, _requests(model)).where(moment >= lo, moment < hi)
        for at, kind, is_charged, outcome, n in session.execute(
            _filtered(query, model, picked).group_by(*keys)
        ).all():
            first = max(_as_datetime(at), lo)
            bucket = buckets.setdefault(
                (first, kind, is_charged),
                TrendBucket(first, min(_as_datetime(at) + step, hi), kind, is_charged),
            )
            setattr(bucket, outcome, getattr(bucket, outcome) + int(n))
    for day in ledger_history(session, start, end, picked):
        at = _as_datetime(day.day)
        first = max(at, start)
        bucket = buckets.setdefault(
            (first, day.kind, day.charged),
            TrendBucket(first, min(at + _DAY, end), day.kind, day.charged),
        )
        bucket.ledger_only += day.requests
    return [buckets[key] for key in sorted(buckets)]


@dataclass(frozen=True)
class SpreadBucket:
    """Every Request in `[start, end)`: an hour, or a day past the hourly span."""

    start: datetime
    end: datetime
    requests: int


def request_spread(
    session: Session,
    picked: Picked = Picked(),  # noqa: B008
) -> list[SpreadBucket]:
    """When Requests were made, over everything kept, for the range picker (RQS-09).

    Hours from the hourly totals inside their span, whole days from the daily
    totals before it. Split on that span, so hourly rows retention has not
    pruned yet are never counted twice. Days before recording started come
    from the ledger, as on the Breakdown, so the picker can reach them (RQS-16).
    """
    hourly = _kept().hourly
    tiers: list[tuple[Any, Any, timedelta, Any]] = [
        (RequestDaily, col(RequestDaily.day), _DAY, hourly.date()),
        (RequestHourly, col(RequestHourly.hour), _HOUR, hourly),
    ]
    spread: list[SpreadBucket] = []
    for model, moment, step, edge in tiers:
        within = moment < edge if model is RequestDaily else moment >= edge
        query = sa_select(moment, _requests(model)).where(within)
        for at, n in session.execute(
            _filtered(query, model, picked).group_by(moment).order_by(moment)
        ).all():
            start = _as_datetime(at)
            spread.append(SpreadBucket(start, start + step, int(n)))
    ledger: Counter[date] = Counter()
    for day in ledger_history(session, _GRID, utc_now(), picked):
        ledger[day.day] += day.requests
    before = [
        SpreadBucket(_as_datetime(day), _as_datetime(day) + _DAY, n)
        for day, n in sorted(ledger.items())
    ]
    return before + spread


@dataclass(frozen=True)
class RecordsPage:
    """One page of a row's Requests, and what every page holds (RQS-10)."""

    #: The range's start, moved up to the oldest Request kept.
    start: datetime
    outcomes: Counter[str]
    records: list[RequestRecordRow]


def request_records(
    session: Session,
    start: datetime,
    end: datetime,
    row: tuple[str | None, str | None],
    picked: Picked,
    page: tuple[int, int],
    hidden: tuple[Sequence[str], Sequence[str]] = ((), ()),
) -> RecordsPage:
    """The Requests of one Channel table row in `[start, end)`, newest first.

    `row` is `(channel, None)` for a Channel's row or `(None, kind)` for an
    aggregate row, matched as the totals key them, so a Handle check naming
    a Channel stays on the Handle checks row. `page` is `(offset, limit)`.
    `hidden` is `(kinds, outcomes)` the tab hides: they leave the list and
    its counts, so every page stays whole.
    """
    week = utc_now() - timedelta(days=settings.REQUEST_RECORD_DAYS)
    start = max(start, week.replace(second=0, microsecond=0))
    channel, kind = row
    on_row = _totals_channel(RequestRecordRow)
    at = col(RequestRecordRow.at)
    within = [at >= start, at < end]
    if channel is not None:
        within.append(on_row == channel)
    else:
        within += [on_row.is_(None), col(RequestRecordRow.kind) == kind]
    outcome = col(RequestRecordRow.outcome)
    within += [
        col(RequestRecordRow.kind).not_in(hidden[0]),
        outcome.not_in(hidden[1]),
    ]
    counts = sa_select(outcome, func.count()).where(*within)
    grouped = _filtered(counts, RequestRecordRow, picked).group_by(outcome)
    outcomes = Counter({o: int(n) for o, n in session.execute(grouped).all()})
    listed = (
        _filtered(select(RequestRecordRow).where(*within), RequestRecordRow, picked)
        .order_by(at.desc(), col(RequestRecordRow.attempt).desc())
        .offset(page[0])
        .limit(page[1])
    )
    return RecordsPage(start, outcomes, list(session.exec(listed).all()))


def _as_datetime(moment: date | datetime) -> datetime:
    """A bucket's start: a daily total's day is its midnight."""
    if isinstance(moment, datetime):
        return moment
    return datetime.combine(moment, datetime.min.time())
