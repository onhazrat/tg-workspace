"""The quota ledger: sole writer of `tg_quota_usage` (ticket 08).

Aggregate. It owns one table, and nothing else writes it.

**Nothing here refuses anything, and that is still true.** Ticket 08 recorded
what each account spent; ticket 23 reads it at enqueue and turns it into a lane,
which degrades work rather than blocking it. The refusal — the absolute ceiling
— is ticket 24's, and this module gains no ability to say no until then.

`budget_allowance` is where the three daily limits come from. It is here rather
than beside the lane names because an allowance is a fact about a Budget, and
`sync_lanes.py` is about which queue a message goes on; the ladder that joins
them (`sync_lanes.tier_for_spend`) reads this and stays a pure transform.
Building the measurement a ticket ahead of the enforcement was the point: the
defaults below are set from a week of the deployment's own numbers instead of
from a guess.

## Three Budgets, from the one field that already distinguishes them

Decision 16 splits the allowance three ways — auto sync, manual bulk, manual
single — because the case that motivated it cannot be expressed as a multiplier:
a throttled scheduler alongside generous manual work. `SyncJobState.sync_mode`
already tells the five ways a sync starts apart, so `budget_for_sync_mode` is a
total function over that Literal rather than a new field somebody has to
remember to set. A sixth mode then fails to type-check here instead of quietly
being filed under whichever Budget an `else` branch named.

## The charge accumulates

`ON CONFLICT DO UPDATE` adding to the stored value, because every sync that
finishes today lands on the same row. The obvious `= excluded.requests` leaves
the ledger holding the size of the most recent sync — a number that looks
completely reasonable and is not what anyone spent.

A charge of zero writes nothing. A row of zero is indistinguishable from a real
day of zero usage, and the Admin view would fill up with accounts that did not
do anything.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import QuotaUsage, utc_now
from app.services.channel_setting_groups import SyncOperationMode
from app.services.tenancy import unscoped_select

logger = logging.getLogger(__name__)


class Budget(StrEnum):
    """The three allowances a Request can be charged against.

    The value is what is stored in `tg_quota_usage.budget`, so these strings are
    a persisted format: renaming one needs a migration, not just an edit. Same
    rule as `core/permissions.Permission`.
    """

    AUTO_SYNC = "auto_sync"
    """Work the scheduler decided to do. Throttled first when an account is over."""

    MANUAL_BULK = "manual_bulk"
    """Bulk follow, reset & sync, sync-all — one action, many channels."""

    MANUAL_SINGLE = "manual_single"
    """One channel, because somebody clicked it and is waiting for the result."""


#: Which Budget each way of starting a sync is charged against. Exhaustive over
#: `SyncOperationMode` by construction, and `budget_for_sync_mode` raises rather
#: than guessing for anything missing — see the module docstring.
_BUDGET_BY_SYNC_MODE: dict[SyncOperationMode, Budget] = {
    # Only the scheduler creates jobs in `auto` mode (`jobs/auto_sync.py`,
    # `jobs/auto_summary.py`); every manual path names its shape.
    "auto": Budget.AUTO_SYNC,
    "individual": Budget.MANUAL_SINGLE,
    "bulk": Budget.MANUAL_BULK,
    "sync_all": Budget.MANUAL_BULK,
    "recheck_restricted": Budget.MANUAL_BULK,
}


def budget_for_sync_mode(sync_mode: SyncOperationMode) -> Budget:
    """Which Budget a sync of this shape is charged against."""
    try:
        return _BUDGET_BY_SYNC_MODE[sync_mode]
    except KeyError:  # pragma: no cover — the guard test makes this unreachable
        raise ValueError(
            f"no Budget for sync mode {sync_mode!r}; add it to _BUDGET_BY_SYNC_MODE"
        ) from None


#: An allowance of this or less is unlimited. Negative rather than a sentinel
#: object because the setting is an integer an operator types into `.env`, and
#: this is the one value that cannot collide with a real limit — zero already
#: means something specific (decision 18: always best-effort, never blocked).
UNLIMITED = -1

#: Where each Budget's daily allowance comes from. Keyed by Budget rather than
#: resolved in an `if`/`elif`, so a fourth Budget fails the guard rather than
#: falling through to whichever branch came last — and read through a callable
#: rather than `getattr(settings, "...")`, so renaming a setting is a
#: type error here instead of an `AttributeError` at the next enqueue.
#:
#: Deployment configuration, because ticket 24 owns the Admin-settable default
#: and the per-User override; a settings row here would be that ticket built
#: early and in the wrong table.
_ALLOWANCE_SETTINGS: dict[Budget, Callable[[], int]] = {
    Budget.AUTO_SYNC: lambda: settings.QUOTA_DEFAULT_AUTO_SYNC_REQUESTS,
    Budget.MANUAL_BULK: lambda: settings.QUOTA_DEFAULT_MANUAL_BULK_REQUESTS,
    Budget.MANUAL_SINGLE: lambda: settings.QUOTA_DEFAULT_MANUAL_SINGLE_REQUESTS,
}


def budget_allowance(budget: Budget) -> int | None:
    """How many Requests this Budget grants an account per day, or None for unlimited.

    Read live rather than captured at import, because a test that pins a limit
    and a deployment that changes one both expect the next enqueue to see it.

    Ticket 24 is where this stops being one number for everybody: it gains an
    Admin-settable default and a per-User override, and the signature grows a
    `user_id`. Until then every account gets the same allowance, which is a
    smaller claim than it sounds — the *usage* it is compared against has always
    been per account.
    """
    configured = _ALLOWANCE_SETTINGS[budget]()
    return None if configured <= UNLIMITED else configured


def resolve_charge_owner(
    session: Session, user_id: uuid.UUID | None
) -> uuid.UUID | None:
    """Which account a job's Requests are charged to, falling back to the operator.

    Delegates to `follows.resolve_follow_owner`, which is the same question with
    the same answer: a `user_id` that names no account is treated exactly like
    `None`, because the TG tables have no foreign key to `user.id` and a deleted
    account leaves rows pointing at nothing. `tg_quota_usage` *does* have that
    foreign key, so charging an orphan id would raise `IntegrityError` — here at
    the very end of `run_sync_job`, after all the work is done.

    A thin delegation rather than a copy, so the two cannot drift, and a
    separate name because "who owns a follow" is not what this call site is
    asking. If the rule ever changes, it changes in one place.
    """
    from app.services.follows import resolve_follow_owner

    return resolve_follow_owner(session, user_id)


def charge_sync_job(
    user_id: uuid.UUID | None, sync_mode: SyncOperationMode, requests: int
) -> None:
    """Charge one completed sync job. Opens its own session; safe to call bare.

    The orchestrator's exit path, factored out so it can run through `run_db` in
    a worker thread and so this module — not `sync_orchestrator.py` — owns the
    decision about what happens when there is nobody to charge.

    Swallows its own failures deliberately — **all** of them, including the
    Budget lookup, which is why nothing here is resolved outside the `try`.
    Ticket 23 revisited the swallow rather than inheriting it. This runs after the sync has finished and its Posts are
    committed, so raising would turn a completed sync into a failed one to
    report an accounting problem. Now that the numbers gate a lane, the cost of
    the swallow is bounded and worth stating: one message's Requests go
    unbilled, the account stays on the normal tier marginally longer than it
    earned, and the next charge succeeds. Under-billing repeatedly needs the
    database to be persistently unreachable, and by then the enqueue read, the
    lane read and the sync itself have all stopped too. The log line names the
    `sync_mode` as well as the count, so the unbilled work is attributable.
    """
    if requests <= 0:
        return

    try:
        with Session(engine) as session:
            owner_id = resolve_charge_owner(session, user_id)
            if owner_id is None:
                # No account exists at all. Inventing one to satisfy the foreign
                # key would put a fabricated uuid in the ledger.
                logger.warning(
                    "Quota: %s Requests unattributed, no account to charge", requests
                )
                return
            charge_requests(
                session, owner_id, budget_for_sync_mode(sync_mode), requests
            )
    except Exception:
        # `sync_mode` rather than the Budget, because resolving the Budget is
        # itself one of the things that can fail here — `budget_for_sync_mode`
        # raises for a mode nobody mapped — and a log line that raises while
        # reporting a failure would carry it out of this `except` and into the
        # `finally` in `sync_queue._process_message` that called us. The mapping
        # is one line away in this module, so naming the mode names the Budget.
        logger.exception(
            "Quota: failed to charge %s Requests for %s (sync_mode=%s)",
            requests,
            user_id,
            sync_mode,
        )


def today_utc() -> date:
    """The ledger day. UTC, because the reset is UTC midnight (decision 16).

    Named rather than inlined so every writer and reader crosses the day
    boundary at the same instant. Two callers each spelling their own
    `datetime.now()` is how a reset ends up an hour apart from itself.
    """
    return datetime.now(UTC).date()


def charge_requests(
    session: Session,
    user_id: uuid.UUID,
    budget: Budget,
    requests: int,
    *,
    day: date | None = None,
) -> None:
    """Add `requests` to what this account has spent on `budget` today.

    Commits. Called once per completed sync job, with the count the job actually
    made — decision 19's "account at completion", as against charging a guess at
    enqueue.
    """
    if requests <= 0:
        return

    ledger_day = day if day is not None else today_utc()
    now = utc_now()
    statement = (
        pg_insert(QuotaUsage)
        .values(
            user_id=user_id,
            day=ledger_day,
            budget=budget.value,
            requests=requests,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "day", "budget"],
            set_={
                # Adding to the stored value, not replacing it: today's second
                # sync is not a correction of today's first. The bare column
                # renders as `tg_quota_usage.requests` — the row already there,
                # as against `excluded.requests`, which is what we are inserting.
                "requests": col(QuotaUsage.requests) + requests,
                "updated_at": now,
            },
        )
    )
    session.execute(statement)
    session.commit()


def usage_rows(session: Session, *, day: date | None = None) -> Sequence[QuotaUsage]:
    """Every account's usage on one day. Ordered so a refresh does not reshuffle."""
    ledger_day = day if day is not None else today_utc()
    statement = unscoped_select(
        select(QuotaUsage)
        .where(QuotaUsage.day == ledger_day)
        .order_by(col(QuotaUsage.user_id), col(QuotaUsage.budget)),
        reason=(
            "The Admin quota view reports what every account spent; scoping it "
            "to the caller would report the Admin's own usage and call it the "
            "deployment's. Gated on Permission.QUOTA_READ_ANY at the route."
        ),
    )
    return session.exec(statement).all()


@dataclass(frozen=True)
class AccountUsage:
    """One account's day, with every Budget present even at zero."""

    user_id: uuid.UUID
    email: str
    spent: dict[Budget, int]

    @property
    def total(self) -> int:
        return sum(self.spent.values())


def usage_by_account(
    session: Session, *, day: date | None = None
) -> list[AccountUsage]:
    """The Admin view's whole payload: who spent what, on one day.

    Joins `user` for the address because the alternative is the route holding a
    list of ids and fetching the names itself, which is the business logic in a
    route module that `CLAUDE.md` spends a paragraph on. Reading another table
    does not make this a read model — `quota.py` is an aggregate because it is
    the sole *writer* of `tg_quota_usage`, and that is unaffected.

    Accounts that spent nothing are **absent**, not present with zeros. A day
    with three active accounts out of two hundred should be three rows.
    """
    rows = usage_rows(session, day=day)
    if not rows:
        return []

    user_ids = {row.user_id for row in rows}
    emails = {
        user.id: user.email
        for user in session.exec(select(User).where(col(User.id).in_(user_ids))).all()
    }

    by_account: dict[uuid.UUID, dict[Budget, int]] = {}
    for row in rows:
        try:
            budget = Budget(row.budget)
        except ValueError:
            # A Budget this build does not know — see `usage_for_user`.
            continue
        by_account.setdefault(row.user_id, dict.fromkeys(Budget, 0))[budget] = (
            row.requests
        )

    return [
        AccountUsage(
            user_id=user_id,
            # An account deleted between the two queries. The ledger row is
            # about to be cascaded away; reporting it as blank beats dropping a
            # number out of a total with no explanation.
            email=emails.get(user_id, ""),
            spent=spent,
        )
        for user_id, spent in by_account.items()
    ]


def usage_for_user(
    session: Session, user_id: uuid.UUID, *, day: date | None = None
) -> dict[Budget, int]:
    """What one account has spent today, per Budget. Every Budget is present.

    A Budget with no row is zero, not absent: ticket 23 asks "is this account
    over on this Budget" and a missing key there is a `KeyError` at exactly the
    moment nobody wants one.
    """
    ledger_day = day if day is not None else today_utc()
    rows = session.exec(
        select(QuotaUsage).where(
            QuotaUsage.user_id == user_id,
            QuotaUsage.day == ledger_day,
        )
    ).all()
    spent = dict.fromkeys(Budget, 0)
    for row in rows:
        try:
            spent[Budget(row.budget)] = row.requests
        except ValueError:
            # A Budget this build does not know about — a downgrade, or a row
            # written by a newer image mid-deploy. Reporting it as one of ours
            # would be worse than leaving it out of the totals.
            continue
    return spent
