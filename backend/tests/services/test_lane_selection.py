"""Enqueue reads the ledger and picks a tier (ticket 23).

Ticket 08 built the measurement and said the numbers it needed were a guess
until there was a week of them. This is the file where the numbers become a
decision, so what it has to pin is the *joins*, not the arithmetic on its own:

* the allowance is compared against **this Budget's** row, so exhausting one
  Budget leaves the other two on the normal tier — decision 16's whole reason
  for splitting them;
* the usage is read for the account that will be **charged**, which is not
  always the id the caller passed;
* nothing is refused at this rung, including at an allowance of zero, which
  decision 18 says means "always best-effort" rather than "blocked";
* a ledger the enqueue cannot read picks the normal lane, because the cost of
  being wrong here is a priority and not a refusal.

The strict-tier half — best-effort runs only when normal work is idle — is
ticket 12's and is guarded in `test_sync_lanes.py` (as arithmetic) and
`test_lane_draining.py` (under real load). This file adds the selector in front
of those, not a second copy of them. It does close the composition, though:
`test_work_over_budget_is_degraded_rather_than_dropped` runs the real drain over
a real best-effort message, because "degraded" and "silently discarded" look
identical from the enqueue side and only one of them is the ticket.

The ticket's remaining sentence — an account over its Budget still receives
Posts from Channels other people sync — needs no assertion here and no code:
`Post` is follow-scoped corpus (`services/tenancy.py`), so a Channel synced by
anyone is readable by everyone who follows it, and that is guarded in
`test_post_tenancy_scoping.py`. Lane selection does not touch it.

The mutation to watch each assertion go red is named on the test.
"""

from __future__ import annotations

import ast
import asyncio
import pathlib
import time
import uuid
from collections.abc import Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session, col, select
from sqlmodel import delete as sa_delete

from app.core.config import settings
from app.core.db import engine
from app.core.security import get_password_hash
from app.jobs import sync_queue
from app.jobs.auto_sync import run_auto_sync
from app.jobs.settings import save_settings_section
from app.models import User
from app.models_tg import QuotaUsage
from app.services import pgmq
from app.services.channel_setting_groups import SyncOperationMode
from app.services.follows import get_operator_user_id
from app.services.network_settings import get_network_setting_row
from app.services.proxy_pool import ProxyWorkerPool, build_workers
from app.services.quota import (
    UNLIMITED,
    Budget,
    budget_allowance,
    charge_requests,
)
from app.services.scraper_jobs import (
    active_sync_job_owners,
    clear_active_jobs_for_tests,
    clear_jobs_for_tests,
    create_job,
)
from app.services.sync_lanes import (
    DRAIN_ORDER,
    TIER_BEST_EFFORT,
    TIER_NORMAL,
    lane_for_budget,
    lane_for_spend,
    tier_for_spend,
)
from tests.utils.setting_groups import add_test_channel, freeze_channels_except
from tests.utils.user import create_random_user

#: The `sync_mode` that charges each Budget. `budget_for_sync_mode` owns the
#: mapping; this is the inverse, spelled out because a test that wants "a job on
#: the manual-bulk Budget" has to name a mode to `create_job`.
MODE_FOR_BUDGET: dict[Budget, SyncOperationMode] = {
    Budget.AUTO_SYNC: "auto",
    Budget.MANUAL_BULK: "bulk",
    Budget.MANUAL_SINGLE: "individual",
}

#: Which setting caps each Budget, so a test can pin one without repeating the
#: name three times. Deliberately spelled out rather than imported from
#: `quota._ALLOWANCE_SETTINGS`: reading the mapping under test to drive the test
#: makes a renamed-to-nothing setting pass.
SETTING_FOR_BUDGET: dict[Budget, str] = {
    Budget.AUTO_SYNC: "QUOTA_DEFAULT_AUTO_SYNC_REQUESTS",
    Budget.MANUAL_BULK: "QUOTA_DEFAULT_MANUAL_BULK_REQUESTS",
    Budget.MANUAL_SINGLE: "QUOTA_DEFAULT_MANUAL_SINGLE_REQUESTS",
}


def _drain_queue(lane: str) -> None:
    with Session(engine) as session:
        while True:
            msgs = pgmq.read(session, lane, vt_seconds=0, qty=50)
            if not msgs:
                break
            for m in msgs:
                pgmq.delete(session, lane, m.msg_id)
            session.commit()


@pytest.fixture(autouse=True)
def _clean_lanes() -> Generator[None]:
    clear_jobs_for_tests()
    for lane in DRAIN_ORDER:
        _drain_queue(lane)
    yield
    for lane in DRAIN_ORDER:
        _drain_queue(lane)


@pytest.fixture
def spender() -> Generator[uuid.UUID]:
    """An account with a ledger, removed afterwards by the cascade."""
    user = User(
        email=f"lane-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=get_password_hash("lane-test-password"),
        is_approved=True,
    )
    with Session(engine) as session:
        session.add(user)
        session.commit()
        session.refresh(user)
        user_id = user.id
    yield user_id
    with Session(engine) as session:
        row = session.get(User, user_id)
        if row is not None:
            session.delete(row)
            session.commit()


def _pin_allowance(
    monkeypatch: pytest.MonkeyPatch, budget: Budget, allowance: int
) -> None:
    monkeypatch.setattr(settings, SETTING_FOR_BUDGET[budget], allowance)


def _spend(user_id: uuid.UUID, budget: Budget, requests: int) -> None:
    with Session(engine) as session:
        charge_requests(session, user_id, budget, requests)


def _lane_chosen(
    user_id: uuid.UUID | None,
    budget: Budget,
    *,
    job_owner: uuid.UUID | None = None,
) -> str:
    """The lane `lane_for_job` picks for a fresh job on this Budget.

    `job_owner` is the id written to `tg_sync_jobs`, separate from the id handed
    to `lane_for_job`, because those are not the same argument. Ticket 21 PR 1
    closed every path that persists a job with no owner, so the row always has
    one; the *enqueue* still takes an optional owner, which is the parameter
    `resolve_charge_owner` exists for. Defaults to the caller's own id, which is
    every live call site today.
    """

    async def run() -> str:
        job = await create_job(
            channel_entries=[("c", "c")],
            source="Ticket 23 guard",
            user_id=str(job_owner if job_owner is not None else user_id),
            sync_mode=MODE_FOR_BUDGET[budget],
        )
        return sync_queue.lane_for_job(job, user_id)

    return asyncio.run(run())


def _lane_enqueued_onto(user_id: uuid.UUID, budget: Budget) -> set[str]:
    """Which lanes actually hold a message after a real `enqueue_sync_job`."""

    async def run() -> None:
        job = await create_job(
            channel_entries=[("c1", "c1"), ("c2", "c2")],
            source="Ticket 23 guard",
            user_id=str(user_id),
            sync_mode=MODE_FOR_BUDGET[budget],
        )
        await sync_queue.enqueue_sync_job(job, user_id)

    asyncio.run(run())
    occupied: set[str] = set()
    with Session(engine) as session:
        for lane in DRAIN_ORDER:
            if pgmq.read(session, lane, vt_seconds=0, qty=1):
                occupied.add(lane)
        session.commit()
    return occupied


# --------------------------------------------------------------------------
# The ladder, as arithmetic
# --------------------------------------------------------------------------


@pytest.mark.parametrize("budget", list(Budget))
def test_inside_the_allowance_is_the_normal_tier(
    monkeypatch: pytest.MonkeyPatch, budget: Budget
) -> None:
    """Mutation: return `TIER_BEST_EFFORT` unconditionally."""
    _pin_allowance(monkeypatch, budget, 100)
    assert tier_for_spend(budget, 99) == TIER_NORMAL


@pytest.mark.parametrize("budget", list(Budget))
def test_past_the_allowance_is_the_best_effort_tier(
    monkeypatch: pytest.MonkeyPatch, budget: Budget
) -> None:
    """Mutation: return `TIER_NORMAL` unconditionally."""
    _pin_allowance(monkeypatch, budget, 100)
    assert tier_for_spend(budget, 101) == TIER_BEST_EFFORT


def test_the_boundary_is_spent_at_least_allowance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both sides of the one comparison, pinned. Mutation: `>` for `>=`.

    Not a rounding preference. `>=` is what makes an allowance of zero mean
    "always best-effort" without a special case, and `>` would hand a
    zero-Budget account exactly one batch a day at normal priority — the shape
    of defect nobody notices until they cannot make a ledger add up.
    """
    _pin_allowance(monkeypatch, Budget.AUTO_SYNC, 100)
    assert tier_for_spend(Budget.AUTO_SYNC, 99) == TIER_NORMAL
    assert tier_for_spend(Budget.AUTO_SYNC, 100) == TIER_BEST_EFFORT


def test_an_allowance_of_zero_is_always_best_effort_and_never_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Decision 18. Mutation: treat 0 as unlimited, or raise on it.

    Ticket 24 owns the checkbox that says so, and it is asserted here because
    this is the ticket that introduces the comparison it falls out of — a `>`
    here would make that checkbox fail two tickets later, in code nobody was
    editing at the time.
    """
    _pin_allowance(monkeypatch, Budget.MANUAL_SINGLE, 0)
    assert tier_for_spend(Budget.MANUAL_SINGLE, 0) == TIER_BEST_EFFORT
    # A lane, not an exception and not `None`: every lane runs, so this is
    # degraded rather than blocked.
    assert lane_for_spend(Budget.MANUAL_SINGLE, 0) in DRAIN_ORDER


def test_a_negative_allowance_is_unlimited(monkeypatch: pytest.MonkeyPatch) -> None:
    """The operator's escape hatch. Mutation: treat it as a limit of zero."""
    _pin_allowance(monkeypatch, Budget.AUTO_SYNC, UNLIMITED)
    assert budget_allowance(Budget.AUTO_SYNC) is None
    assert tier_for_spend(Budget.AUTO_SYNC, 10**9) == TIER_NORMAL


def test_every_budget_reads_its_own_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation: point two Budgets at the same setting.

    The three allowances being independent is what the whole ladder rests on;
    two of them sharing a source would be invisible on a deployment that sets
    them to the same number, which is exactly what a template does.
    """
    for index, budget in enumerate(Budget):
        _pin_allowance(monkeypatch, budget, index + 1)
    assert [budget_allowance(budget) for budget in Budget] == [1, 2, 3]


def test_the_selector_can_only_name_a_lane_that_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: compose a tier name in `lane_for_spend` instead of using one.

    A lane exists because a migration created it, and `pgmq.send` to a queue
    that does not exist raises — at enqueue, in a request handler.
    """
    for budget in Budget:
        _pin_allowance(monkeypatch, budget, 10)
        assert lane_for_spend(budget, 0) in DRAIN_ORDER
        assert lane_for_spend(budget, 10) in DRAIN_ORDER


# --------------------------------------------------------------------------
# The ladder, against a real ledger
# --------------------------------------------------------------------------


def test_an_account_inside_its_budget_enqueues_at_normal_priority(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Checkbox 1, the easy direction. Mutation: route everything best-effort."""
    _pin_allowance(monkeypatch, Budget.MANUAL_SINGLE, 100)
    _spend(spender, Budget.MANUAL_SINGLE, 40)

    assert _lane_enqueued_onto(spender, Budget.MANUAL_SINGLE) == {
        lane_for_budget(Budget.MANUAL_SINGLE, TIER_NORMAL)
    }


def test_an_account_over_its_budget_enqueues_best_effort(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Checkbox 1, the direction that matters.

    Mutation: drop the ledger read in `lane_for_job` and always answer normal —
    which is exactly the code this ticket replaces, so the test is also the
    proof the ticket did something.
    """
    _pin_allowance(monkeypatch, Budget.MANUAL_SINGLE, 100)
    _spend(spender, Budget.MANUAL_SINGLE, 100)

    assert _lane_enqueued_onto(spender, Budget.MANUAL_SINGLE) == {
        lane_for_budget(Budget.MANUAL_SINGLE, TIER_BEST_EFFORT)
    }


def test_exhausting_one_budget_leaves_the_other_two_at_normal_priority(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Checkbox 2, and the reason decision 16 split the Budgets at all.

    Mutation: compare the day's *total* spend against the allowance instead of
    this Budget's row. Every lane it picks is still a real lane, so nothing
    fails anywhere else — the deployment just quietly stops being able to run a
    single manual sync after the scheduler has had a busy morning.
    """
    for budget in Budget:
        _pin_allowance(monkeypatch, budget, 100)
    _spend(spender, Budget.AUTO_SYNC, 5_000)

    assert _lane_chosen(spender, Budget.AUTO_SYNC) == lane_for_budget(
        Budget.AUTO_SYNC, TIER_BEST_EFFORT
    )
    assert _lane_chosen(spender, Budget.MANUAL_BULK) == lane_for_budget(
        Budget.MANUAL_BULK, TIER_NORMAL
    )
    assert _lane_chosen(spender, Budget.MANUAL_SINGLE) == lane_for_budget(
        Budget.MANUAL_SINGLE, TIER_NORMAL
    )


def test_one_accounts_spend_does_not_deprioritise_another(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """The ledger is read per account, which only a second account can show.

    Mutation: read `usage_rows` for the day rather than `usage_for_user`. Every
    single-account assertion above stays green, because with one account the
    deployment's usage and the account's usage are the same number.
    """
    _pin_allowance(monkeypatch, Budget.MANUAL_BULK, 100)
    _spend(spender, Budget.MANUAL_BULK, 500)

    other = User(
        email=f"lane-other-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=get_password_hash("lane-test-password"),
        is_approved=True,
    )
    with Session(engine) as session:
        session.add(other)
        session.commit()
        session.refresh(other)
        other_id = other.id
    try:
        assert _lane_chosen(spender, Budget.MANUAL_BULK) == lane_for_budget(
            Budget.MANUAL_BULK, TIER_BEST_EFFORT
        )
        assert _lane_chosen(other_id, Budget.MANUAL_BULK) == lane_for_budget(
            Budget.MANUAL_BULK, TIER_NORMAL
        )
    finally:
        with Session(engine) as session:
            row = session.get(User, other_id)
            if row is not None:
                session.delete(row)
                session.commit()


def test_an_unattributable_enqueue_is_judged_against_the_operator(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """The read and the charge must resolve the same owner.

    Mutation: read usage for the raw `user_id`. Neither id below matches a
    ledger row, so both would come back at zero and run at normal priority
    forever while `charge_sync_job` billed the operator for all of it — a leak
    visible only in a ledger nobody was reading yet.

    Two shapes, because `resolve_charge_owner` answers for both and only one of
    them is obvious. `None` is the optional parameter every enqueue still takes.
    The stale uuid is the realistic one: the TG tables have no foreign key to
    `user.id`, so a deleted account leaves jobs and messages naming an id that
    is not an account any more.
    """
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
    assert operator_id is not None, "the test database has no bootstrap superuser"

    _pin_allowance(monkeypatch, Budget.AUTO_SYNC, 100)
    _spend(operator_id, Budget.AUTO_SYNC, 250)
    over = lane_for_budget(Budget.AUTO_SYNC, TIER_BEST_EFFORT)
    try:
        assert _lane_chosen(None, Budget.AUTO_SYNC, job_owner=spender) == over
        assert _lane_chosen(uuid.uuid4(), Budget.AUTO_SYNC, job_owner=spender) == over
    finally:
        # The operator outlives the test, so its ledger is cleared by hand.
        with Session(engine) as session:
            session.execute(
                sa_delete(QuotaUsage).where(col(QuotaUsage.user_id) == operator_id)
            )
            session.commit()


def test_a_ledger_read_that_fails_enqueues_at_normal_priority(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Fail open. Mutation: let the exception out of `lane_for_job`.

    It would surface as a 500 from `POST /jobs/sync` and as an auto-sync tick
    that enqueued nothing — a transient ledger problem taking the sync path down
    with it, to answer a question whose worst wrong answer is a priority.
    """
    _pin_allowance(monkeypatch, Budget.MANUAL_SINGLE, 1)
    _spend(spender, Budget.MANUAL_SINGLE, 999)

    def explode(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("ledger unavailable")

    monkeypatch.setattr(sync_queue, "usage_for_user", explode)

    assert _lane_chosen(spender, Budget.MANUAL_SINGLE) == lane_for_budget(
        Budget.MANUAL_SINGLE, TIER_NORMAL
    )


def test_a_deployment_with_no_account_still_enqueues(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Nobody to charge means nobody can be over. Mutation: return None here.

    `charge_sync_job` logs and drops the charge in the same case, so the two
    agree about a database that has not created its first superuser yet.
    """
    _pin_allowance(monkeypatch, Budget.AUTO_SYNC, 0)
    monkeypatch.setattr(sync_queue, "resolve_charge_owner", lambda *_a, **_k: None)

    assert _lane_chosen(None, Budget.AUTO_SYNC, job_owner=spender) == lane_for_budget(
        Budget.AUTO_SYNC, TIER_NORMAL
    )


def test_the_defaults_this_deployment_ships_are_real_limits() -> None:
    """The shipped configuration actually engages the ladder.

    Mutation: set a default to `UNLIMITED`. A selector wired to three unlimited
    allowances is a mechanism with no caller — every assertion above would still
    pass, because every one pins its own allowance.
    """
    for budget in Budget:
        allowance = budget_allowance(budget)
        assert allowance is not None and allowance > 0, (
            f"{budget.value} ships unlimited, so the ladder never engages"
        )


def test_the_ledger_row_the_selector_reads_is_the_one_the_charge_writes(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """The two halves of decision 19 meet on one row, or they meet on none.

    Mutation: charge a different `day`, or a different Budget. Both leave every
    other test in this file and in `test_quota_ledger.py` green, because each
    file only ever looks at its own half.
    """
    _pin_allowance(monkeypatch, Budget.MANUAL_BULK, 10)
    sync_queue.charge_sync_job(spender, MODE_FOR_BUDGET[Budget.MANUAL_BULK], 10)

    with Session(engine) as session:
        rows = list(
            session.exec(select(QuotaUsage).where(QuotaUsage.user_id == spender)).all()
        )
    assert [(r.budget, r.requests) for r in rows] == [(Budget.MANUAL_BULK.value, 10)]

    assert _lane_chosen(spender, Budget.MANUAL_BULK) == lane_for_budget(
        Budget.MANUAL_BULK, TIER_BEST_EFFORT
    )


def test_work_over_budget_is_degraded_rather_than_dropped(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """The ticket's own sentence, end to end: "keeps working, more slowly".

    Mutation: have the drain skip the best-effort tier. Every other test in this
    file stays green, because they all stop at "which lane did the message land
    on" — and a message on a lane nothing drains is indistinguishable from a
    correct enqueue right up until somebody notices their syncs stopped.

    The tier *ordering* is ticket 12's and is guarded under real load in
    `test_lane_draining.py`. What this adds is the composition: the selector in
    front of that drain, over a lane that had never held a message before.
    """
    _pin_allowance(monkeypatch, Budget.MANUAL_SINGLE, 10)
    _spend(spender, Budget.MANUAL_SINGLE, 10)

    dispatched: list[str] = []

    async def fake_process(msg: pgmq.PgmqMessage, _slot: object) -> None:
        dispatched.append(str(msg.message.get("channelId")))

    partition = ProxyWorkerPool(build_workers([], 1))

    async def fake_partition() -> ProxyWorkerPool:
        return partition

    monkeypatch.setattr(sync_queue, "_process_message", fake_process)
    monkeypatch.setattr(sync_queue, "_partition", fake_partition)

    async def run() -> None:
        job = await create_job(
            channel_entries=[("c1", "c1"), ("c2", "c2")],
            source="Ticket 23 guard",
            user_id=str(spender),
            sync_mode=MODE_FOR_BUDGET[Budget.MANUAL_SINGLE],
        )
        await sync_queue.enqueue_sync_job(job, spender)
        await sync_queue.drain_sync_lanes()

    asyncio.run(run())

    assert sorted(dispatched) == ["c1", "c2"], (
        "an account over its Budget had its work enqueued and never run; "
        f"the drain dispatched {dispatched}"
    )


# --------------------------------------------------------------------------
# The seam is exclusive
# --------------------------------------------------------------------------

#: Every module allowed to start a sync **without** going through
#: `enqueue_sync_job`, and why. A sync reached any other way never touches the
#: quota ladder: it is not on a lane, so there is no tier for `tier_for_spend`
#: to choose and no drain to deprioritise it — it simply runs, at full speed,
#: charging the Budget it is over.
#:
#: Ticket 31's nine by-id writes and ticket 33's `_resolve_bot_token` are the
#: same shape reached from other directions: a rule applied at the door somebody
#: was looking at, while a second door stayed open. The declaration is what turns
#: a third door into a red test instead of a discovery.
RUN_SYNC_JOB_CALLERS: dict[str, str] = {
    "app/jobs/sync_queue.py": (
        "The pre-ticket-10 message shape, whose payload names a whole job "
        "rather than a Channel. It arrived *through* a lane, so the ladder "
        "already chose its tier at enqueue; running it here is how a message "
        "written before the deploy is honoured rather than stranded."
    ),
    "app/jobs/auto_summary.py": (
        "`_sync_stale_channels` needs the sync finished before it can "
        "summarise, so enqueueing would invert its control flow — ticket 10 "
        "declined to build the probe-shaped message that would take, and "
        "ticket 13's docstring still carries the forward reference. It is "
        "therefore outside the ladder, charged to `auto_sync` like the "
        "scheduler's own work but never deprioritised with it. The same "
        "exception in the same words as `bulk_follow.run_follow_job`'s probe "
        "phase, which is metered, charged to `manual_bulk`, and equally "
        "unreachable from a lane."
    ),
}

APP_ROOT = pathlib.Path(__file__).resolve().parents[2] / "app"


def _modules_calling(function_name: str) -> set[str]:
    """Modules with a call to `function_name`, from the AST rather than a grep.

    A grep counts the twenty-odd docstrings in this codebase that discuss
    `run_sync_job` by name, which is the noise that makes a grep-based guard get
    loosened until it stops failing.
    """
    found: set[str] = set()
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "alembic" in path.parts:
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else None
            )
            if name == function_name:
                found.add(str(path.relative_to(APP_ROOT.parent)))
    return found


def test_no_new_path_starts_a_sync_outside_the_ladder() -> None:
    """Mutation: add a `run_sync_job` call anywhere else, or delete a reason.

    The claim this ticket makes is that `enqueue_sync_job` is the one seam. It
    is true of every path that *enqueues*, and the two exceptions below do not —
    which is exactly why they have to be written down rather than assumed away.
    """
    callers = _modules_calling("run_sync_job") - {"app/services/sync_orchestrator.py"}
    undeclared = callers - set(RUN_SYNC_JOB_CALLERS)
    assert not undeclared, (
        f"{sorted(undeclared)} starts a sync without going through "
        "enqueue_sync_job, so the quota ladder cannot see it at all: it is on "
        "no lane, so there is no tier to choose and nothing to deprioritise. "
        "Route it through enqueue_sync_job, or add it to RUN_SYNC_JOB_CALLERS "
        "with the reason it cannot be."
    )

    stale = set(RUN_SYNC_JOB_CALLERS) - callers
    assert not stale, (
        f"{sorted(stale)} is declared as an exception and no longer calls "
        "run_sync_job — an exemption nothing explains is the shape CLAUDE.md's "
        "guard-table preamble warns about"
    )

    for module, reason in RUN_SYNC_JOB_CALLERS.items():
        assert len(reason.strip()) >= 40, f"{module}'s reason does not explain itself"


def test_the_guard_can_actually_see_the_call_sites() -> None:
    """A walk that finds nothing passes for the wrong reason.

    `enqueue_sync_job` is the control: it has four callers and the walk has to
    find them, or the exclusivity assertion above is vacuous.
    """
    enqueuers = _modules_calling("enqueue_sync_job") - {"app/jobs/sync_queue.py"}
    assert enqueuers == {
        "app/api/routes/jobs.py",
        "app/jobs/auto_sync.py",
        "app/services/bulk_follow.py",
        "app/services/bulk_channels.py",
    }, (
        f"the four enqueueing paths are now {sorted(enqueuers)}. A new one is "
        "fine and needs no code — it goes through the ladder by construction — "
        "but check it before updating this list, and a *removed* one means a "
        "sync path moved somewhere this file cannot see."
    )


# --------------------------------------------------------------------------
# The gate the ladder made per-account
# --------------------------------------------------------------------------


def test_one_accounts_queued_backlog_does_not_stop_another_accounts_scheduler(
    monkeypatch: pytest.MonkeyPatch, spender: uuid.UUID
) -> None:
    """Mutation: gate `run_auto_sync` on `has_active_sync_job()` again.

    The interaction this ticket creates, and the one that costs the most if it
    is wrong. An account over its `auto_sync` Budget enqueues onto the
    best-effort tier, which is served only when every normal lane is empty — so
    its job can stay non-terminal for as long as manual work keeps arriving.
    Under the deployment-wide gate that one account's backlog silently stopped
    the scheduler for **every** account, and the daily reset would not have
    rescued it: a message's lane is fixed at enqueue.

    Driven through the real functions rather than by stubbing the gate, because
    the thing under test is that `active_sync_job_owners` answers per owner and
    that `run_auto_sync` uses that answer to filter rather than to return.
    """
    _pin_allowance(monkeypatch, Budget.AUTO_SYNC, 10)
    _spend(spender, Budget.AUTO_SYNC, 10)

    async def run() -> None:
        job = await create_job(
            channel_entries=[("c1", "c1")],
            source="Ticket 23 guard",
            user_id=str(spender),
            sync_mode="auto",
        )
        await sync_queue.enqueue_sync_job(job, spender)

    asyncio.run(run())

    busy = active_sync_job_owners()
    assert spender in busy, (
        "an account whose auto-sync batch is queued on the best-effort lane is "
        "not reported busy, so the next tick would stack a second batch on it"
    )

    other = User(
        email=f"lane-idle-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=get_password_hash("lane-test-password"),
        is_approved=True,
    )
    with Session(engine) as session:
        session.add(other)
        session.commit()
        session.refresh(other)
        other_id = other.id
    try:
        assert other_id not in busy, (
            "an idle account is reported busy because a *different* account has "
            "work queued; that is the deployment-wide gate, and it stops every "
            "account's scheduler behind the slowest one"
        )
    finally:
        with Session(engine) as session:
            row = session.get(User, other_id)
            if row is not None:
                session.delete(row)
                session.commit()


@patch("app.jobs.auto_sync.enqueue_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_the_tick_skips_the_busy_account_and_plans_the_other_one(
    mock_create: AsyncMock,
    mock_enqueue: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The gate filters; it does not return. Mutation: `owners = [] if busy else owners`.

    The assertion above proves `active_sync_job_owners` answers per owner. This
    proves `run_auto_sync` *uses* that answer as a filter — which is the half
    that matters, because a per-owner answer consumed as a boolean is the
    deployment-wide gate with extra steps, and the mutation that does exactly
    that passed everything else in this file.

    Both directions, because only one of them is a change: the busy account must
    be skipped (the gate still works) and the idle one must be planned (the gate
    is no longer deployment-wide).
    """
    clear_jobs_for_tests()
    now = int(time.time() * 1000)

    with Session(engine) as session:
        busy_user = create_random_user(session)
        idle_user = create_random_user(session)
        busy_id, idle_id = busy_user.id, idle_user.id

        net_row = get_network_setting_row(session)
        if net_row:
            net_row.user_id = busy_id
            session.add(net_row)
        save_settings_section(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        for channel_id, name, owner in (
            ("t23-busy-ch", "t23-busy-channel", busy_id),
            ("t23-idle-ch", "t23-idle-channel", idle_id),
        ):
            add_test_channel(
                session,
                channel_id,
                name=name,
                user_id=owner,
                last_updated=now - 120 * 60 * 1000,
                next_regular_sync_at=now - 1_000,
            )
        freeze_channels_except(session, {"t23-busy-ch", "t23-idle-ch"})
        session.commit()

    try:
        # Put the busy account past its auto-sync allowance, so its batch really
        # does land on the best-effort lane the stall would come from.
        _pin_allowance(monkeypatch, Budget.AUTO_SYNC, 10)
        _spend(busy_id, Budget.AUTO_SYNC, 10)

        async def enqueue_for_busy() -> None:
            job = await create_job(
                channel_entries=[("t23-busy-ch", "t23-busy-channel")],
                source="Ticket 23 guard",
                user_id=str(busy_id),
                sync_mode="auto",
            )
            await sync_queue.enqueue_sync_job(job, busy_id)

        asyncio.run(enqueue_for_busy())
        clear_active_jobs_for_tests()  # only the queued row remains, as in the worker

        mock_job = MagicMock()
        mock_job.job_id = "t23-tick"
        mock_job.status = "pending"
        mock_create.return_value = mock_job

        result = asyncio.run(run_auto_sync())

        planned = {call.kwargs["user_id"] for call in mock_create.await_args_list}
        assert str(idle_id) in planned, (
            "the idle account's tick was skipped because a *different* account "
            f"had work queued on the best-effort lane; run_auto_sync returned "
            f"{result}"
        )
        assert str(busy_id) not in planned, (
            "the busy account was given a second batch on top of the one still "
            "queued, which is what the gate exists to prevent"
        )
    finally:
        clear_jobs_for_tests()
        with Session(engine) as session:
            session.exec(sa_delete(User).where(col(User.id).in_([busy_id, idle_id])))
            session.commit()
