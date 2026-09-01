"""The quota ledger: sole writer of `tg_quota_usage` (ticket 08).

Aggregate. It owns one table, and nothing else writes it.

**This module now refuses.** Ticket 08 recorded what each account spent; ticket
23 read it at enqueue and turned it into a lane, which degrades work rather than
blocking it; ticket 24 adds the rung above that. `assert_within_ceiling` is the
one function here that says no, and `QuotaCeilingReached` is how it says it.

`resolve_budget_limits` is where the numbers come from, and there are three
layers of them: the account's `tg_quota_limits` override, the deployment's
`quota` settings row, then `config.py`. It is here rather than beside the lane
names because a limit is a fact about a Budget, and `sync_lanes.py` is about
which queue a message goes on; the ladder that joins them
(`sync_lanes.tier_for_spend`) takes the resolved allowance as an argument and
stays a pure transform. Building the measurement a ticket ahead of the
enforcement was the point: the shipped defaults are set from a week of the
deployment's own numbers instead of from a guess.

**The allowance degrades and the ceiling refuses, and they are two numbers.**
Decision 18 spells the ceiling as an absolute daily count rather than a multiple
of the allowance, because a multiple makes a zero allowance a zero ceiling — and
a zero allowance means "always best-effort", never "blocked". Nothing in this
module multiplies one by the other; the ten-times relationship lives only in the
three literals in `config.py`.

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
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import QuotaLimit, QuotaUsage, utc_now
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
#: The shipped floor of ticket 24's three-layer resolution: an Admin's
#: deployment-wide `quota` settings row sits above this, and a per-User
#: `tg_quota_limits` override above that. It stays in code because the other two
#: are rows, and on the deploy that introduces them every database has neither.
_ALLOWANCE_SETTINGS: dict[Budget, Callable[[], int]] = {
    Budget.AUTO_SYNC: lambda: settings.QUOTA_DEFAULT_AUTO_SYNC_REQUESTS,
    Budget.MANUAL_BULK: lambda: settings.QUOTA_DEFAULT_MANUAL_BULK_REQUESTS,
    Budget.MANUAL_SINGLE: lambda: settings.QUOTA_DEFAULT_MANUAL_SINGLE_REQUESTS,
}

#: The same for the absolute ceiling (ticket 24, decision 18). A separate map
#: rather than a multiple of the allowance, and that is the whole of decision
#: 18's "absolute daily number, not a multiple": a multiple evaluated here makes
#: a zero allowance a zero ceiling, and a zero allowance must mean "always
#: best-effort" rather than "blocked". The multiple survives only as the
#: literals in `config.py`, which are ten times the allowance defaults.
_CEILING_SETTINGS: dict[Budget, Callable[[], int]] = {
    Budget.AUTO_SYNC: lambda: settings.QUOTA_DEFAULT_AUTO_SYNC_CEILING_REQUESTS,
    Budget.MANUAL_BULK: lambda: settings.QUOTA_DEFAULT_MANUAL_BULK_CEILING_REQUESTS,
    Budget.MANUAL_SINGLE: (
        lambda: settings.QUOTA_DEFAULT_MANUAL_SINGLE_CEILING_REQUESTS
    ),
}


def quota_settings_field(budget: Budget, kind: str) -> str:
    """The `quota` settings row's field name for one Budget's allowance or ceiling.

    camelCase because every settings row on the wire is, and *derived* from the
    Budget value rather than listed, so a fourth Budget cannot be filed under a
    key nobody spelled. `kind` is `"Requests"` or `"Ceiling"`, which is what
    makes `autoSyncRequests` and `autoSyncCeiling` fall out of one rule.
    """
    head, _, tail = budget.value.partition("_")
    return f"{head}{tail.capitalize()}{kind}"


def stored_default(stored: dict[str, Any], budget: Budget, kind: str) -> int | None:
    """One number out of the Admin's `quota` row, or `None` if it is not there.

    Absent, null, or a non-integer all mean "no deployment default set" and fall
    through to `config.py` rather than to zero. The row is a JSON blob an Admin
    PUTs, which makes it the one untyped input in this resolution, and reading a
    typo as a limit of zero would block an account on a spelling mistake.
    """
    value = stored.get(quota_settings_field(budget, kind))
    # `bool` is an `int` in Python, and `True` would resolve to a limit of one.
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _limit_or_unlimited(configured: int) -> int | None:
    """`None` for unlimited, the number otherwise. Zero is a number."""
    return None if configured <= UNLIMITED else configured


def budget_allowance(budget: Budget) -> int | None:
    """The shipped allowance for `budget`, before any Admin has said otherwise.

    Read live rather than captured at import, because a test that pins a limit
    and a deployment that changes one both expect the next enqueue to see it.

    This is layer three of three. `resolve_budget_limits` is what a caller with
    a `Session` and an account should use; this is kept as its own function
    because the deployment default and the per-User override are both allowed to
    be absent, and something has to be underneath them.
    """
    return _limit_or_unlimited(_ALLOWANCE_SETTINGS[budget]())


def budget_ceiling(budget: Budget) -> int | None:
    """The shipped ceiling for `budget`. Layer three, as `budget_allowance` is."""
    return _limit_or_unlimited(_CEILING_SETTINGS[budget]())


@dataclass(frozen=True)
class BudgetLimits:
    """One Budget's two resolved numbers. `None` on either means unlimited.

    A pair rather than two lookups, because every caller wants both and
    resolving them separately means two reads of the same two rows — and,
    worse, a window in which an Admin's save lands between them and an account
    is measured against one afternoon's allowance and the next one's ceiling.
    """

    allowance: int | None
    ceiling: int | None


def resolve_budget_limits(
    session: Session, budget: Budget, user_id: uuid.UUID | None
) -> BudgetLimits:
    """This account's allowance and ceiling for one Budget (ticket 24).

    Most specific first: the account's `tg_quota_limits` row, then the
    deployment-wide `quota` settings row, then `config.py`. Each of the two
    numbers resolves **independently** — an override that sets a ceiling and
    leaves the allowance null inherits the allowance, rather than pinning it to
    whatever the default happened to be when the Admin clicked.

    `user_id` may be `None`, which skips the override layer rather than
    erroring: an ownerless job resolves the deployment's numbers, which is the
    same answer every account gets before an Admin says otherwise.
    """
    stored, overrides = _limit_inputs(session, user_id)
    return _resolve_from(stored, overrides.get(budget.value), budget)


def _limit_inputs(
    session: Session, user_id: uuid.UUID | None
) -> tuple[dict[str, Any], dict[str, QuotaLimit]]:
    """The two rows every limit resolution reads: the defaults and the overrides.

    Factored out so a caller resolving all three Budgets reads them **once**
    rather than once per Budget. That is not a micro-optimisation: `GET
    /quota/me` is polled by every open browser every sixty seconds, and the
    obvious version turns three answers into nine queries — which is the
    "compute it for everything, read one field" shape this repo has already had
    to fix twice, once in the auto-sync tick and once in the channel list.
    """
    from app.services.quota_limits import limits_for_user
    from app.services.settings_registry import QUOTA_KEY
    from app.services.settings_store import get_global_setting

    overrides = limits_for_user(session, user_id) if user_id is not None else {}
    return get_global_setting(session, QUOTA_KEY), overrides


def _resolve_from(
    stored: dict[str, Any], override: QuotaLimit | None, budget: Budget
) -> BudgetLimits:
    """Apply the three layers to one Budget, given rows already in hand.

    Pure, so the layering rule is stated once and both the single-Budget and
    the all-three callers reach it. Two copies of a most-specific-first cascade
    is how the browser and the enqueue come to disagree about a limit.
    """
    allowance = (
        override.allowance
        if override is not None and override.allowance is not None
        else stored_default(stored, budget, "Requests")
    )
    ceiling = (
        override.ceiling
        if override is not None and override.ceiling is not None
        else stored_default(stored, budget, "Ceiling")
    )
    return BudgetLimits(
        allowance=(
            _limit_or_unlimited(allowance)
            if allowance is not None
            else budget_allowance(budget)
        ),
        ceiling=(
            _limit_or_unlimited(ceiling)
            if ceiling is not None
            else budget_ceiling(budget)
        ),
    )


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


class QuotaCeilingReached(Exception):
    """This account is at or past its ceiling on this Budget today (ticket 24).

    Carries the Budget rather than a formatted sentence, because the three
    callers that catch it answer in three different registers — a 429 body, a
    channel-level error string, and a scheduler log line — and a message
    composed here would be right for at most one of them.
    """

    def __init__(self, budget: Budget) -> None:
        self.budget = budget
        super().__init__(f"daily {budget.value} request ceiling reached")


def lift_ceiling(
    session: Session,
    user_id: uuid.UUID,
    budget: Budget,
    *,
    day: date | None = None,
    lifted: bool = True,
) -> None:
    """Stop enforcing this account's ceiling on this Budget for this day. Commits.

    Decision 18's "an Admin can lift early". The auto-lift needs no code at all:
    tomorrow is a different ledger row, so a lift expires at the same UTC
    midnight the spend resets at, by arithmetic rather than by a job.

    Writes a row even when the account has spent nothing, which is the one place
    the ledger holds a `requests = 0` row on purpose — `charge_requests` refuses
    a zero charge because a zero row is indistinguishable from a quiet day, and
    a row carrying a lift is distinguishable.

    `lifted=False` takes it back, for an Admin who lifted the wrong account. It
    clears the timestamp rather than deleting the row, because by then the row
    may be carrying real spend.
    """
    ledger_day = day if day is not None else today_utc()
    now = utc_now()
    statement = (
        pg_insert(QuotaUsage)
        .values(
            user_id=user_id,
            day=ledger_day,
            budget=budget.value,
            requests=0,
            ceiling_lifted_at=now if lifted else None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "day", "budget"],
            # `requests` is deliberately absent from the update: a lift is not a
            # correction of what the account has already spent, and the whole
            # value of the ledger is that nothing silently resets it.
            set_={"ceiling_lifted_at": now if lifted else None, "updated_at": now},
        )
    )
    session.execute(statement)
    session.commit()


@dataclass(frozen=True)
class BudgetState:
    """What one account may do on one Budget right now.

    `spent` against `limits`, plus the two facts a caller cannot recompute from
    them: whether an Admin has lifted the ceiling today, and the resulting
    verdict. `blocked` is the one the enforcement points read; the rest is what
    the browser renders, and both come from one read so a banner cannot say
    "degraded" while the enqueue behind it says "blocked".
    """

    budget: Budget
    spent: int
    limits: BudgetLimits
    lifted: bool

    @property
    def degraded(self) -> bool:
        """At or past the allowance: still running, on the best-effort tier."""
        return self.limits.allowance is not None and self.spent >= self.limits.allowance

    @property
    def blocked(self) -> bool:
        """At or past the ceiling, and no Admin has lifted it today.

        **A ceiling of zero blocks and an allowance of zero does not**, which is
        decision 18 in one line. The two comparisons are the same `>=`; what
        differs is which rung they are on, and that is why the ceiling is its own
        number rather than a multiple of the allowance.
        """
        if self.lifted or self.limits.ceiling is None:
            return False
        return self.spent >= self.limits.ceiling

    @property
    def status(self) -> str:
        """`blocked`, `degraded` or `normal`. What the browser renders."""
        if self.blocked:
            return "blocked"
        return "degraded" if self.degraded else "normal"


def budget_state(
    session: Session,
    user_id: uuid.UUID | None,
    budget: Budget,
    *,
    day: date | None = None,
) -> BudgetState:
    """Resolve this account's limits and spend on one Budget, in one read pass."""
    ledger_day = day if day is not None else today_utc()
    limits = resolve_budget_limits(session, budget, user_id)
    if user_id is None:
        return BudgetState(budget=budget, spent=0, limits=limits, lifted=False)
    row = session.get(QuotaUsage, (user_id, ledger_day, budget.value))
    return BudgetState(
        budget=budget,
        spent=row.requests if row else 0,
        limits=limits,
        lifted=bool(row and row.ceiling_lifted_at is not None),
    )


def assert_within_ceiling(user_id: uuid.UUID | None, budget: Budget) -> None:
    """Raise `QuotaCeilingReached` if this account may not start work on `budget`.

    The refusal rung. **Opens its own `Session`, and takes none.** The first cut
    had an optional `session` keyword "for the call sites that have one in
    hand", and not one of the four does — every path here is async and reaches
    this through `run_db` or `to_thread`, which supply no session. An escape
    hatch nothing takes is a leftover nobody dares remove later, so it is gone
    rather than left beside the branch that is actually used.

    Four queries per call, and the placement is what pays for them: this runs
    once per Channel, and a Channel sync is seconds of work and up to fifty HTTP
    round trips to Telegram. Hoisting it to once per batch would halve nothing
    that matters and would give back exactly the bounding the per-Channel check
    exists for.

    **Resolved for the account that will be charged**, through
    `resolve_charge_owner` rather than a second copy of the rule — the same
    argument `lane_for_job` makes one rung down. Reading the raw id would let
    every ownerless enqueue run past every ceiling forever while the operator
    paid for it.

    **Fails closed, deliberately unlike `lane_for_job`.** Ticket 23 fails open on
    a ledger error and wrote down why: nothing is refused at that rung, so being
    wrong costs one batch at the wrong priority. It also wrote down that this
    ticket "may want the other answer", and it does — a rung whose only job is
    refusal must not become a no-op exactly when the deployment is unhealthy,
    which is a guard that cannot fail. The cost is bounded: the sync writes its
    Posts to this same database, so a database that cannot answer this read is
    one where the sync was going to fail anyway. What failing closed adds is
    that the Requests to Telegram are not made first.

    A deployment with no account at all is not refused — there is nobody to be
    over anything, which is the case `charge_sync_job` logs and drops.
    """
    with Session(engine) as session:
        _assert_within_ceiling(session, user_id, budget)


def _assert_within_ceiling(
    session: Session, user_id: uuid.UUID | None, budget: Budget
) -> None:
    owner_id = resolve_charge_owner(session, user_id)
    if owner_id is None:
        return
    if budget_state(session, owner_id, budget).blocked:
        raise QuotaCeilingReached(budget)


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
    #: Which Budgets an Admin has lifted the ceiling on for this day (ticket
    #: 24). Reported beside the spend rather than from a second endpoint,
    #: because "this account is over its ceiling" and "somebody let it through
    #: anyway" are one question when an Admin is looking at why work is running.
    lifted: dict[Budget, bool] = field(
        default_factory=lambda: dict.fromkeys(Budget, False)
    )

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

    One exception since ticket 24, and it is deliberate: `lift_ceiling` writes a
    `requests = 0` row, so an account an Admin lifted before it spent anything
    appears here with a total of zero. That is the row an Admin most needs to
    see — "somebody let this account past its ceiling today" is the answer to
    why work is running — and hiding it to keep the sentence above literally
    true would hide the administrative act rather than the noise the rule is
    about.
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
    lifted_by_account: dict[uuid.UUID, dict[Budget, bool]] = {}
    for row in rows:
        try:
            budget = Budget(row.budget)
        except ValueError:
            # A Budget this build does not know — see `usage_for_user`.
            continue
        by_account.setdefault(row.user_id, dict.fromkeys(Budget, 0))[budget] = (
            row.requests
        )
        lifted_by_account.setdefault(row.user_id, dict.fromkeys(Budget, False))[
            budget
        ] = row.ceiling_lifted_at is not None

    return [
        AccountUsage(
            user_id=user_id,
            # An account deleted between the two queries. The ledger row is
            # about to be cascaded away; reporting it as blank beats dropping a
            # number out of a total with no explanation.
            email=emails.get(user_id, ""),
            spent=spent,
            lifted=lifted_by_account.get(user_id, dict.fromkeys(Budget, False)),
        )
        for user_id, spent in by_account.items()
    ]


def account_budget_states(
    session: Session, user_id: uuid.UUID, *, day: date | None = None
) -> list[BudgetState]:
    """All three Budgets for one account: what it spent, what it may spend.

    The payload behind `GET /quota/me` and the warning the browser shows. All
    three are resolved even when two are untouched, because the panel renders
    three rows and an absent Budget there is a missing row rather than a zero.

    **Three queries, not nine.** The naive body is
    `[budget_state(...) for budget in Budget]`, and each of those reads the
    overrides, the settings row and the ledger for itself. Every open browser
    polls this every sixty seconds, so that is the "compute it for everything,
    read one field" defect this repo has already paid for twice — and it costs
    nothing to avoid, because all three Budgets read the same two rows and one
    day of one account's ledger.
    """
    ledger_day = day if day is not None else today_utc()
    stored, overrides = _limit_inputs(session, user_id)
    rows = {
        row.budget: row
        for row in session.exec(
            select(QuotaUsage).where(
                QuotaUsage.user_id == user_id,
                QuotaUsage.day == ledger_day,
            )
        ).all()
    }
    return [
        BudgetState(
            budget=budget,
            spent=rows[budget.value].requests if budget.value in rows else 0,
            limits=_resolve_from(stored, overrides.get(budget.value), budget),
            lifted=(
                budget.value in rows
                and rows[budget.value].ceiling_lifted_at is not None
            ),
        )
        for budget in Budget
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
