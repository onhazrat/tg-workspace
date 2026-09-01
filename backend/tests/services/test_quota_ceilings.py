"""Ceilings, Admin overrides, and the two meanings of zero (ticket 24).

Ticket 23 made the ledger choose a *priority*. This is where it can say no, and
the whole risk of the ticket is that saying no is one comparison away from
saying no to the wrong thing:

* an allowance of zero must mean "always best-effort", and a ceiling of zero
  must mean "blocked" — the same `>=` on two rungs, which is exactly why
  decision 18 refuses to derive one number from the other;
* three layers resolve each number, and an override that sets one half must not
  pin the other half to whatever the default was that afternoon;
* a lift is scoped to an account, a Budget **and a day**, because that is what
  "auto-lifts at the daily reset" means;
* the refusal has to reach the work, which is not the same as reaching the
  enqueue — ticket 23 chose the tier once per batch and named the ceiling as
  what bounds the resulting overshoot.

The mutation to watch each assertion go red is named on the test.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Generator
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session, col
from sqlmodel import delete as sa_delete

from app.core.config import settings
from app.core.db import engine
from app.core.security import get_password_hash
from app.jobs import sync_queue
from app.jobs.auto_sync import run_auto_sync
from app.jobs.settings import save_settings_section
from app.models import User
from app.models_tg import QuotaUsage
from app.services.channel_setting_groups import SyncOperationMode
from app.services.quota import (
    UNLIMITED,
    Budget,
    QuotaCeilingReached,
    account_budget_states,
    assert_within_ceiling,
    budget_state,
    charge_requests,
    lift_ceiling,
    quota_settings_field,
    resolve_budget_limits,
    today_utc,
)
from app.services.quota_limits import limits_for_user, set_limit
from app.services.scraper_jobs import (
    clear_active_jobs_for_tests,
    clear_jobs_for_tests,
    create_job,
)
from app.services.settings_registry import QUOTA_KEY
from app.services.settings_store import put_global_setting

#: Which `sync_mode` charges each Budget, as `test_lane_selection.py` spells it.
MODE_FOR_BUDGET: dict[Budget, SyncOperationMode] = {
    Budget.AUTO_SYNC: "auto",
    Budget.MANUAL_BULK: "bulk",
    Budget.MANUAL_SINGLE: "individual",
}

#: The shipped ceiling settings, spelled out rather than imported from
#: `quota._CEILING_SETTINGS`. Reading the mapping under test to drive the test
#: makes a setting renamed to nothing pass.
CEILING_SETTING_FOR_BUDGET: dict[Budget, str] = {
    Budget.AUTO_SYNC: "QUOTA_DEFAULT_AUTO_SYNC_CEILING_REQUESTS",
    Budget.MANUAL_BULK: "QUOTA_DEFAULT_MANUAL_BULK_CEILING_REQUESTS",
    Budget.MANUAL_SINGLE: "QUOTA_DEFAULT_MANUAL_SINGLE_CEILING_REQUESTS",
}

ALLOWANCE_SETTING_FOR_BUDGET: dict[Budget, str] = {
    Budget.AUTO_SYNC: "QUOTA_DEFAULT_AUTO_SYNC_REQUESTS",
    Budget.MANUAL_BULK: "QUOTA_DEFAULT_MANUAL_BULK_REQUESTS",
    Budget.MANUAL_SINGLE: "QUOTA_DEFAULT_MANUAL_SINGLE_REQUESTS",
}


@pytest.fixture(autouse=True)
def _clean_jobs() -> Generator[None]:
    clear_jobs_for_tests()
    yield
    clear_active_jobs_for_tests()
    clear_jobs_for_tests()


def _account() -> uuid.UUID:
    user = User(
        email=f"ceiling-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=get_password_hash("ceiling-test-password"),
        is_approved=True,
    )
    with Session(engine) as session:
        session.add(user)
        session.commit()
        session.refresh(user)
        return user.id


@pytest.fixture
def spender() -> Generator[uuid.UUID]:
    """An account whose ledger, limits and lifts all cascade away with it."""
    user_id = _account()
    yield user_id
    with Session(engine) as session:
        row = session.get(User, user_id)
        if row is not None:
            session.delete(row)
            session.commit()


@pytest.fixture(autouse=True)
def _no_stored_defaults() -> Generator[None]:
    """Start every test from `config.py`, not from whatever an earlier one saved.

    The suite's teardown truncates `tg_app_settings` like every other `tg_*`
    table, so this is belt and braces for the ordinary run — but the truncate
    fires *after* a test, and two of the tests below write a deployment default
    partway through their own body. Pinning the row to nulls up front means a
    test that reads a resolved limit gets `config.py`, whatever ran before it
    inside the same test process and however the ordering fell.

    Nulls rather than deleting the row: `stored_default` reads absent, null and
    non-integer identically, so this asserts the fall-through it depends on
    rather than sidestepping it.
    """
    with Session(engine) as session:
        put_global_setting(
            session,
            QUOTA_KEY,
            {
                quota_settings_field(budget, kind): None
                for budget in Budget
                for kind in ("Requests", "Ceiling")
            },
        )
    yield


def _pin(
    monkeypatch: pytest.MonkeyPatch,
    budget: Budget,
    *,
    allowance: int | None = None,
    ceiling: int | None = None,
) -> None:
    if allowance is not None:
        monkeypatch.setattr(settings, ALLOWANCE_SETTING_FOR_BUDGET[budget], allowance)
    if ceiling is not None:
        monkeypatch.setattr(settings, CEILING_SETTING_FOR_BUDGET[budget], ceiling)


def _spend(user_id: uuid.UUID, budget: Budget, requests: int) -> None:
    with Session(engine) as session:
        charge_requests(session, user_id, budget, requests)


def _blocked(user_id: uuid.UUID, budget: Budget) -> bool:
    with Session(engine) as session:
        return budget_state(session, user_id, budget).blocked


# --------------------------------------------------------------------------
# The two meanings of zero — the ticket's fifth checkbox
# --------------------------------------------------------------------------


@pytest.mark.parametrize("budget", list(Budget))
def test_a_zero_allowance_is_best_effort_and_never_blocked(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID, budget: Budget
) -> None:
    """Decision 18, and the reason the ceiling is not a multiple.

    Mutation: derive the ceiling as `N * allowance` anywhere in the resolution.
    A zero allowance then produces a zero ceiling, and an account told to run
    everything at low priority is refused outright instead.
    """
    _pin(monkeypatch, budget, allowance=0, ceiling=1_000)
    _spend(spender, budget, 5)

    with Session(engine) as session:
        state = budget_state(session, spender, budget)
    assert state.degraded, "a zero allowance is past its allowance by arithmetic"
    assert not state.blocked, "a zero allowance must never block"
    assert state.status == "degraded"

    # And the refusal rung agrees with the state it reports.
    assert_within_ceiling(spender, budget)


@pytest.mark.parametrize("budget", list(Budget))
def test_a_zero_ceiling_blocks(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID, budget: Budget
) -> None:
    """Mutation: treat a ceiling of zero like `UNLIMITED`.

    Zero and negative differ on this rung and only on this rung, which is what
    makes "this account runs nothing on this Budget" expressible at all.
    """
    _pin(monkeypatch, budget, allowance=1_000, ceiling=0)
    assert _blocked(spender, budget), "a ceiling of zero blocks before any spend"
    with pytest.raises(QuotaCeilingReached):
        assert_within_ceiling(spender, budget)


@pytest.mark.parametrize("budget", list(Budget))
def test_a_negative_ceiling_never_blocks(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID, budget: Budget
) -> None:
    """The operator's escape hatch. Mutation: treat it as a limit of zero."""
    _pin(monkeypatch, budget, ceiling=UNLIMITED)
    _spend(spender, budget, 10**9)
    with Session(engine) as session:
        assert resolve_budget_limits(session, budget, spender).ceiling is None
    assert not _blocked(spender, budget)


def test_the_ceiling_boundary_is_spent_at_least_ceiling(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Both sides of the one comparison. Mutation: `>` for `>=`.

    The same boundary the allowance uses, for the same reason: a `>` is what
    makes a limit of zero mean one free batch a day.
    """
    _pin(monkeypatch, Budget.AUTO_SYNC, allowance=10**9, ceiling=100)
    _spend(spender, Budget.AUTO_SYNC, 99)
    assert not _blocked(spender, Budget.AUTO_SYNC)
    _spend(spender, Budget.AUTO_SYNC, 1)
    assert _blocked(spender, Budget.AUTO_SYNC)


# --------------------------------------------------------------------------
# Three layers, resolved independently
# --------------------------------------------------------------------------


def test_the_deployment_default_beats_the_shipped_one(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: read `config.py` and ignore the `quota` settings row."""
    _pin(monkeypatch, Budget.MANUAL_BULK, allowance=10, ceiling=20)
    with Session(engine) as session:
        put_global_setting(
            session,
            QUOTA_KEY,
            {
                quota_settings_field(Budget.MANUAL_BULK, "Requests"): 111,
                quota_settings_field(Budget.MANUAL_BULK, "Ceiling"): 222,
            },
        )
        limits = resolve_budget_limits(session, Budget.MANUAL_BULK, spender)
    assert (limits.allowance, limits.ceiling) == (111, 222)


def test_the_per_user_override_beats_the_deployment_default(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: resolve the deployment default and stop."""
    _pin(monkeypatch, Budget.MANUAL_BULK, allowance=10, ceiling=20)
    with Session(engine) as session:
        put_global_setting(
            session,
            QUOTA_KEY,
            {
                quota_settings_field(Budget.MANUAL_BULK, "Requests"): 111,
                quota_settings_field(Budget.MANUAL_BULK, "Ceiling"): 222,
            },
        )
        set_limit(session, spender, Budget.MANUAL_BULK.value, allowance=3, ceiling=4)
        limits = resolve_budget_limits(session, Budget.MANUAL_BULK, spender)
    assert (limits.allowance, limits.ceiling) == (3, 4)


def test_half_an_override_inherits_the_other_half(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: store the resolved pair instead of two nullable columns.

    An Admin capping one account's ceiling must not thereby freeze its
    allowance at whatever the default happened to be that afternoon — the whole
    reason `tg_quota_limits` is two nullable columns rather than a copy.
    """
    _pin(monkeypatch, Budget.MANUAL_SINGLE, allowance=10, ceiling=20)
    with Session(engine) as session:
        set_limit(
            session, spender, Budget.MANUAL_SINGLE.value, allowance=None, ceiling=99
        )
        limits = resolve_budget_limits(session, Budget.MANUAL_SINGLE, spender)
    assert limits.ceiling == 99
    assert limits.allowance == 10, "the un-overridden half must still inherit"

    # And the inheritance is live: moving the default moves it.
    _pin(monkeypatch, Budget.MANUAL_SINGLE, allowance=12)
    with Session(engine) as session:
        assert (
            resolve_budget_limits(session, Budget.MANUAL_SINGLE, spender).allowance
            == 12
        )


def test_clearing_both_halves_removes_the_override_row(spender: uuid.UUID) -> None:
    """Mutation: keep a row of two nulls.

    A row that overrides nothing shows up in the Admin view as an account with
    limits set and no limits.
    """
    with Session(engine) as session:
        set_limit(session, spender, Budget.AUTO_SYNC.value, allowance=5, ceiling=6)
        assert Budget.AUTO_SYNC.value in limits_for_user(session, spender)
        set_limit(
            session, spender, Budget.AUTO_SYNC.value, allowance=None, ceiling=None
        )
        assert Budget.AUTO_SYNC.value not in limits_for_user(session, spender)


def test_the_three_budgets_resolve_three_independent_pairs(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: resolve one Budget's limits and use them for all three.

    Decision 16's independence, restated on the ceiling rung. Two Budgets
    sharing a source is invisible on a deployment that gives them the same
    number, which is exactly what a template does.
    """
    for index, budget in enumerate(Budget):
        _pin(monkeypatch, budget, allowance=index + 1, ceiling=(index + 1) * 10)
    with Session(engine) as session:
        resolved = [
            (
                resolve_budget_limits(session, budget, spender).allowance,
                resolve_budget_limits(session, budget, spender).ceiling,
            )
            for budget in Budget
        ]
    assert resolved == [(1, 10), (2, 20), (3, 30)]


def test_exhausting_one_ceiling_leaves_the_other_two_alone(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: compare against the day's total across Budgets."""
    for budget in Budget:
        _pin(monkeypatch, budget, allowance=10**9, ceiling=100)
    _spend(spender, Budget.MANUAL_BULK, 100)

    assert _blocked(spender, Budget.MANUAL_BULK)
    assert not _blocked(spender, Budget.AUTO_SYNC)
    assert not _blocked(spender, Budget.MANUAL_SINGLE)


def test_one_accounts_spend_never_blocks_another(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: read the ledger across accounts."""
    _pin(monkeypatch, Budget.AUTO_SYNC, allowance=10**9, ceiling=10)
    other = _account()
    _spend(other, Budget.AUTO_SYNC, 500)
    assert not _blocked(spender, Budget.AUTO_SYNC)
    assert _blocked(other, Budget.AUTO_SYNC)


# --------------------------------------------------------------------------
# The lift
# --------------------------------------------------------------------------


def test_a_lift_stops_the_refusal(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Decision 18's "an Admin can lift early". Mutation: ignore the column."""
    _pin(monkeypatch, Budget.AUTO_SYNC, allowance=10**9, ceiling=10)
    _spend(spender, Budget.AUTO_SYNC, 50)
    assert _blocked(spender, Budget.AUTO_SYNC)

    with Session(engine) as session:
        lift_ceiling(session, spender, Budget.AUTO_SYNC)
    assert not _blocked(spender, Budget.AUTO_SYNC)
    assert_within_ceiling(spender, Budget.AUTO_SYNC)

    with Session(engine) as session:
        lift_ceiling(session, spender, Budget.AUTO_SYNC, lifted=False)
    assert _blocked(spender, Budget.AUTO_SYNC)


def test_a_lift_does_not_reach_another_budget_or_another_day(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: key the lift by account alone, or by account and Budget.

    "Auto-lifts at the daily reset" is only true because the row it lives on is
    keyed by day. A lift stored anywhere less specific stays lifted for ever,
    silently, which is the failure an Admin would never notice.
    """
    for budget in Budget:
        _pin(monkeypatch, budget, allowance=10**9, ceiling=10)
        _spend(spender, budget, 50)

    with Session(engine) as session:
        lift_ceiling(session, spender, Budget.AUTO_SYNC)

    assert not _blocked(spender, Budget.AUTO_SYNC)
    assert _blocked(spender, Budget.MANUAL_BULK), "the lift reached another Budget"

    tomorrow = today_utc() + timedelta(days=1)
    with Session(engine) as session:
        charge_requests(session, spender, Budget.AUTO_SYNC, 50, day=tomorrow)
        state = budget_state(session, spender, Budget.AUTO_SYNC, day=tomorrow)
    assert state.blocked, "the lift survived the daily reset"


def test_a_lift_writes_a_row_without_inventing_spend(spender: uuid.UUID) -> None:
    """Mutation: have `lift_ceiling` add to `requests`, or reset it.

    A lift is the one thing that writes a `requests = 0` row, and it must not
    disturb a row that is already carrying real spend — the ledger is kept
    forever precisely so nothing silently rewrites it.
    """
    with Session(engine) as session:
        lift_ceiling(session, spender, Budget.MANUAL_SINGLE)
        fresh = session.get(
            QuotaUsage, (spender, today_utc(), Budget.MANUAL_SINGLE.value)
        )
        assert fresh is not None and fresh.requests == 0
        assert fresh.ceiling_lifted_at is not None

    _spend(spender, Budget.MANUAL_SINGLE, 42)
    with Session(engine) as session:
        lift_ceiling(session, spender, Budget.MANUAL_SINGLE)
        row = session.get(
            QuotaUsage, (spender, today_utc(), Budget.MANUAL_SINGLE.value)
        )
        assert row is not None and row.requests == 42, "a lift rewrote the spend"


# --------------------------------------------------------------------------
# The refusal reaches the work
# --------------------------------------------------------------------------


def test_an_account_under_its_ceiling_is_untouched(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """The control. Mutation: refuse unconditionally."""
    _pin(monkeypatch, Budget.MANUAL_SINGLE, allowance=10**9, ceiling=10**9)
    assert_within_ceiling(spender, Budget.MANUAL_SINGLE)


def test_enqueue_refuses_past_the_ceiling_and_marks_the_job(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: let `enqueue_sync_job` send anyway.

    The job row is marked *before* the raise, so a caller that catches the
    exception and one that does not leave the same record — three of the four
    callers are unattended, and a job stuck at `pending` is what
    `has_active_sync_job` reads.
    """
    _pin(monkeypatch, Budget.MANUAL_SINGLE, allowance=10**9, ceiling=1)
    _spend(spender, Budget.MANUAL_SINGLE, 5)

    async def run() -> None:
        job = await create_job(
            channel_entries=[("c1", "c1"), ("c2", "c2")],
            source="Ticket 24 guard",
            user_id=str(spender),
            sync_mode=MODE_FOR_BUDGET[Budget.MANUAL_SINGLE],
        )
        with pytest.raises(QuotaCeilingReached):
            await sync_queue.enqueue_sync_job(job, spender)
        assert job.status == "failed"
        assert all(ch.status == "failed" for ch in job.channels.values())
        assert all("ceiling" in (ch.error or "") for ch in job.channels.values()), (
            "the refusal has to say why, in the record somebody reads"
        )

    asyncio.run(run())


def test_enqueue_still_sends_for_an_account_inside_its_ceiling(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """The other half of the control. Mutation: refuse unconditionally.

    Without this, "refuses past the ceiling" is satisfied by a function that
    refuses everything, and every other test in this file passes.
    """
    _pin(monkeypatch, Budget.MANUAL_SINGLE, allowance=10**9, ceiling=10**9)

    async def run() -> None:
        job = await create_job(
            channel_entries=[("c1", "c1")],
            source="Ticket 24 guard",
            user_id=str(spender),
            sync_mode=MODE_FOR_BUDGET[Budget.MANUAL_SINGLE],
        )
        await sync_queue.enqueue_sync_job(job, spender)
        assert job.status != "failed"

    asyncio.run(run())


def test_the_ceiling_stops_a_batch_already_on_a_lane(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """The half of the ceiling that actually bounds anything.

    Mutation: check only in `enqueue_sync_job`. Ticket 23 chooses the tier once
    per enqueue call for the whole batch, so the 2,000-Channel `sync_all` that
    crosses the ceiling was enqueued while the account was still under it — a
    ceiling checked only at enqueue bounds nothing at all.

    The walk is replaced, so a version that refuses and a version that scrapes
    anyway differ in whether Telegram was reached, not merely in the status
    reported afterwards.
    """
    from app.services import sync_orchestrator
    from app.services.scraper_jobs import ChannelSyncState, SyncJobState
    from tests.utils.setting_groups import add_test_channel

    walked: list[str] = []

    async def _never(*args: object, **kwargs: object) -> None:
        walked.append("walked")

    monkeypatch.setattr(sync_orchestrator, "_walk_channel_pages", _never)
    _pin(monkeypatch, Budget.MANUAL_SINGLE, allowance=10**9, ceiling=1)
    _spend(spender, Budget.MANUAL_SINGLE, 5)

    # A real, followable Channel: without one the mutation fails for the wrong
    # reason — `_prepare_channel_sync` raises on a missing row, so "the ceiling
    # stopped it" and "there was nothing to sync" look identical.
    with Session(engine) as session:
        add_test_channel(session, "ceil-1", name="ceil_1", user_id=spender)

    ch_state = ChannelSyncState(channel_id="ceil-1", channel_name="ceil_1")
    job = SyncJobState(
        job_id=f"ceiling-{uuid.uuid4().hex[:8]}",
        source="Ticket 24 guard",
        channels={"ceil-1": ch_state},
        user_id=str(spender),
        sync_mode="individual",
    )

    asyncio.run(sync_orchestrator.sync_single_channel(job, ch_state, user_id=spender))

    assert not walked, "the Channel was scraped past the account's ceiling"
    assert ch_state.status == "skipped", (
        "a refusal is a skip, not a failure: nothing went wrong with the Channel"
    )
    assert "ceiling" in (ch_state.error or "")


def test_the_probe_phase_is_refused_past_the_manual_bulk_ceiling(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: check only the chained sync.

    Bulk follow's probe phase is one `t.me` fetch per handle, on no lane, so
    ticket 23's ladder cannot reach it — a refusal can, because a refusal needs
    no lane. A batch of hundreds of probes is the runaway the ceiling exists
    for, and covering only the chained sync stops the cheap half of a bulk
    follow and not the expensive one.
    """
    from app.services import bulk_follow

    probed: list[str] = []

    async def _never(*args: object, **kwargs: object) -> None:
        probed.append("probed")

    monkeypatch.setattr(bulk_follow, "_process_one_channel", _never)
    _pin(monkeypatch, Budget.MANUAL_BULK, allowance=10**9, ceiling=1)
    _spend(spender, Budget.MANUAL_BULK, 5)

    async def run() -> None:
        job = await bulk_follow.create_follow_job(
            channels=[{"name": "alpha"}, {"name": "beta"}], user_id=str(spender)
        )
        await bulk_follow.run_follow_job(job)
        assert not probed, "handles were probed past the account's bulk ceiling"
        assert job.status == "failed"
        assert all("ceiling" in (r.error or "") for r in job.results)

    asyncio.run(run())
    bulk_follow.clear_follow_jobs_for_tests()


def test_reading_all_three_budgets_does_not_read_the_limits_three_times(
    spender: uuid.UUID,
) -> None:
    """Mutation: `[budget_state(...) for budget in Budget]`, the obvious body.

    `GET /quota/me` is polled by every open browser every sixty seconds. The
    naive version reads the override rows, the settings row and the ledger once
    *per Budget* — nine queries where three do — which is the "compute it for
    everything, read one field" defect this repo has already paid for in the
    auto-sync tick and the channel list. Counting statements rather than timing
    anything, because the cost is the round trips and a fast test machine hides
    them.
    """
    from sqlalchemy import event

    statements: list[str] = []

    def _record(_conn, _cursor, statement, *_args) -> None:  # type: ignore[no-untyped-def]
        if "tg_quota" in statement or "tg_app_settings" in statement:
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        with Session(engine) as session:
            account_budget_states(session, spender)
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert len(statements) <= 3, (
        "reading three Budgets took "
        f"{len(statements)} quota/settings queries:\n  "
        + "\n  ".join(statements)
        + "\n\nAll three read the same two rows and one day of one account's "
        "ledger; resolving them per Budget triples that on a polled endpoint."
    )


def test_an_unreadable_ledger_refuses(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Fail closed, deliberately unlike `lane_for_job`.

    Mutation: wrap the read in `try`/`except` and return, as the lane read
    does. Ticket 23 fails open because nothing is refused at that rung and
    being wrong costs one batch at the wrong priority; a rung whose only job
    *is* refusal must not become a no-op exactly when the deployment is
    unhealthy — that is a guard that cannot fail.

    The assertion is that the error reaches the caller rather than being turned
    into permission. Every caller treats an exception here as "do not run": the
    route answers 500 rather than syncing, and `sync_single_channel` fails the
    Channel through the handler it already has.
    """
    from app.services import quota

    def _boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("ledger unavailable")

    monkeypatch.setattr(quota, "budget_state", _boom)
    with pytest.raises(RuntimeError, match="ledger unavailable"):
        assert_within_ceiling(spender, Budget.AUTO_SYNC)


def test_a_partly_invalid_limits_body_writes_nothing(
    spender: uuid.UUID,
) -> None:
    """Mutation: validate each Budget name inside the write loop.

    `set_limit` commits per entry, so parsing as it goes means a body whose
    second entry is misspelled writes the first and *then* answers 422 — the
    Admin sees a rejected request and half of it landed, which is the worst of
    both readings. `_budget_or_422`'s own docstring promises to refuse the whole
    request; this is what makes that true.
    """
    from fastapi import HTTPException

    from app.api.routes.quota import set_quota_limits_for_user
    from app.schemas.quota import BudgetLimitsPayload, SetQuotaLimitsRequest

    body = SetQuotaLimitsRequest(
        budgets=[
            BudgetLimitsPayload(budget=Budget.AUTO_SYNC.value, allowance=5, ceiling=6),
            # camelCase, which is how the browser spells every other field.
            BudgetLimitsPayload(budget="manualBulk", allowance=5, ceiling=6),
        ]
    )
    with Session(engine) as session:
        with pytest.raises(HTTPException) as caught:
            set_quota_limits_for_user(session, spender, body)
        assert caught.value.status_code == 422
        assert limits_for_user(session, spender) == {}, (
            "the valid half of a refused body was written anyway"
        )


def test_a_valid_limits_body_still_writes(spender: uuid.UUID) -> None:
    """The control for the test above. Mutation: refuse every body.

    Without this, "a partly invalid body writes nothing" is satisfied by a
    handler that writes nothing at all.
    """
    from app.api.routes.quota import set_quota_limits_for_user
    from app.schemas.quota import BudgetLimitsPayload, SetQuotaLimitsRequest

    body = SetQuotaLimitsRequest(
        budgets=[
            BudgetLimitsPayload(budget=Budget.AUTO_SYNC.value, allowance=5, ceiling=6)
        ]
    )
    with Session(engine) as session:
        set_quota_limits_for_user(session, spender, body)
        stored = limits_for_user(session, spender)
    assert stored[Budget.AUTO_SYNC.value].allowance == 5
    assert stored[Budget.AUTO_SYNC.value].ceiling == 6


@patch("app.jobs.auto_sync.enqueue_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_a_blocked_account_files_no_job_row_at_all(
    mock_create: AsyncMock,
    mock_enqueue: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: let `enqueue_sync_job` do the refusing, as the first cut did.

    The ceiling has to be checked *before* `create_job`, not after. Refusing at
    enqueue is correct and unusable: `_refuse_at_ceiling` makes the job terminal
    at once, so `active_sync_job_owners` never sees the owner as busy and the
    next tick — sixty seconds later — plans and creates another one. A blocked
    account would file roughly 1,400 `failed` job rows a day and paint the Jobs
    panel red for a condition that is not a failure.

    Asserting on `create_job` rather than on a row count is the point: the row
    is the cost, and the only way not to pay it is not to create it.
    """
    from tests.utils.setting_groups import add_test_channel, freeze_channels_except
    from tests.utils.user import create_random_user

    clear_jobs_for_tests()
    now = int(time.time() * 1000)

    with Session(engine) as session:
        blocked_user = create_random_user(session)
        blocked_id = blocked_user.id
        save_settings_section(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        add_test_channel(
            session,
            "t24-blocked-ch",
            name="t24-blocked-channel",
            user_id=blocked_id,
            last_updated=now - 120 * 60 * 1000,
            next_regular_sync_at=now - 1_000,
        )
        freeze_channels_except(session, {"t24-blocked-ch"})
        session.commit()

    try:
        _pin(monkeypatch, Budget.AUTO_SYNC, allowance=10**9, ceiling=10)
        _spend(blocked_id, Budget.AUTO_SYNC, 50)

        mock_job = MagicMock()
        mock_job.job_id = "t24-tick"
        mock_job.status = "pending"
        mock_create.return_value = mock_job

        result = asyncio.run(run_auto_sync())

        planned = {call.kwargs["user_id"] for call in mock_create.await_args_list}
        assert str(blocked_id) not in planned, (
            "a job row was created for an account past its auto_sync ceiling; "
            "at one tick a minute that is ~1,400 failed rows a day"
        )
        assert result.get("reason") == "quota_ceiling", (
            "a tick that refused every owner must say so rather than looking "
            f"like an ordinary quiet tick; got {result}"
        )
    finally:
        clear_jobs_for_tests()
        with Session(engine) as session:
            session.exec(sa_delete(User).where(col(User.id) == blocked_id))
            session.commit()
