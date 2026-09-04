"""The quota ledger counts what it says it counts (ticket 08).

Nothing is throttled yet, which is exactly why this file matters. A measurement
nobody acts on is a measurement nobody notices is wrong, and tickets 23 and 24
turn these numbers into a lane choice and a refusal. A ledger that has been
quietly double-counting retries for two releases does not announce itself when
enforcement lands — it announces itself as "the new limits are broken".

So each assertion below pins one half of the definition in
`docs/multi-user-tenancy-plan.md`, decisions 15 and 20:

* one Request is **one attempt Telegram answered**, a 429 and a soft-blocked web
  view included, because those cost Telegram what a 200 costs it;
* an attempt that died in transport is **free**, and so are the retries it
  forces — "a flaky proxy is not the User's doing";
* only the Telegram web view counts — the Bot API and the thumbnail CDNs go
  through the same function and are not what the Budget measures.

The first two rules meet inside `fetch_with_retry`'s retry loop rather than at
its exit, and the first version of this file got that wrong in a way every test
here missed: `httpx.HTTPStatusError` subclasses `httpx.HTTPError`, so a 404 goes
round the retry branch up to `NETWORK_FETCH_RETRIES` (**8**) times, and charging
once per call billed eight real round trips as one. Every test passed because
every test passed `retries=1`.
`test_every_answered_attempt_counts_at_the_production_retry_setting` is pinned to
the real default for that reason.

The mutation to watch each one go red is named on the test.

Async cases run through `asyncio.run` in a sync test rather than a plugin
marker, which is how the rest of this suite does it (`test_scraper_backward.py`,
`test_resolve_start_time.py`).
"""

from __future__ import annotations

import asyncio
import pathlib
import uuid
from collections.abc import Generator
from datetime import date

import httpx
import pytest
from sqlmodel import Session, col, select
from sqlmodel import delete as sa_delete

from app.core import request_meter
from app.core.config import settings
from app.core.db import engine
from app.core.security import get_password_hash
from app.models import User
from app.models_tg import QuotaUsage
from app.services import network
from app.services.channel_setting_groups import SyncOperationMode
from app.services.follows import get_operator_user_id
from app.services.proxy_pool import ProxyWorkerPool
from app.services.quota import (
    Budget,
    budget_for_sync_mode,
    charge_requests,
    today_utc,
    usage_rows,
)
from app.services.telegram_web import TelegramWebViewUnavailable
from tests.utils.partition import direct_partition

TELEGRAM_URL = "https://t.me/s/somechannel"
NOT_TELEGRAM_URL = "https://api.telegram.org/bot123/sendMessage"
DAY = date(2026, 8, 25)


async def _no_sleep(_seconds: float) -> None:
    """Retries here are about *what gets counted*, not about waiting for it."""
    return None


# --------------------------------------------------------------------------
# The meter
# --------------------------------------------------------------------------


def test_counting_outside_a_metered_block_is_a_no_op() -> None:
    """Mutation: raise instead of returning when no meter is active.

    Most callers of `fetch_with_retry` are not a sync — the Bot API publish
    path, a proxy health check, a thumbnail fetch from a route. They run with no
    meter and must not care that the meter exists.
    """
    request_meter.record_telegram_request()  # must not raise


def test_a_meter_counts_the_calls_made_inside_it() -> None:
    with request_meter.metered() as meter:
        request_meter.record_telegram_request()
        request_meter.record_telegram_request()
    assert meter.telegram_requests == 2


def test_a_meter_stops_counting_once_its_block_ends() -> None:
    """Mutation: set the ContextVar without resetting it on exit.

    A meter that outlives its block charges the next job for the last one's
    work, and the symptom is a number that is merely too big — the kind of wrong
    nobody spots without being told what to expect.
    """
    with request_meter.metered() as meter:
        request_meter.record_telegram_request()
    request_meter.record_telegram_request()
    assert meter.telegram_requests == 1


def test_two_concurrent_meters_do_not_share_a_count() -> None:
    """Mutation: hoist the meter to a module-level global.

    Two syncs for two accounts run concurrently in one process today, and will
    run in one worker after ticket 10. A shared counter charges each of them for
    the other's requests, and does it only under concurrency — the failure that
    never reproduces in a single-user test.
    """

    async def job(n: int) -> int:
        with request_meter.metered() as meter:
            for _ in range(n):
                request_meter.record_telegram_request()
                await asyncio.sleep(0)
            return meter.telegram_requests

    async def _run() -> list[int]:
        return list(await asyncio.gather(job(3), job(7)))

    assert asyncio.run(_run()) == [3, 7]


def test_a_meter_reaches_the_tasks_a_job_spawns() -> None:
    """Mutation: read the meter from a local instead of the ContextVar.

    `run_sync_job` opens one meter and then gathers a task per channel. A meter
    that did not reach those tasks would record zero for every sync, which reads
    exactly like "nobody synced anything".
    """

    async def one_channel() -> None:
        request_meter.record_telegram_request()

    async def _run() -> int:
        with request_meter.metered() as meter:
            await asyncio.gather(*[one_channel() for _ in range(4)])
            return meter.telegram_requests

    assert asyncio.run(_run()) == 4


# --------------------------------------------------------------------------
# What counts as a Request
# --------------------------------------------------------------------------


def _http_status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", TELEGRAM_URL)
    return httpx.HTTPStatusError(
        str(status_code), request=request, response=httpx.Response(status_code)
    )


def _count_one_fetch(
    monkeypatch: pytest.MonkeyPatch,
    fetch_once: object,
    *,
    url: str = TELEGRAM_URL,
    retries: int = 1,
    expect_raises: type[BaseException] | None = None,
) -> int:
    """Run one `fetch_with_retry` under a meter and return what it counted."""
    monkeypatch.setattr(network, "_fetch_once", fetch_once)
    monkeypatch.setattr(network.asyncio, "sleep", _no_sleep)

    async def _run() -> int:
        with request_meter.metered() as meter:
            if expect_raises is not None:
                with pytest.raises(expect_raises):
                    await network.fetch_with_retry(
                        url, retries=retries, initial_delay_ms=0
                    )
            else:
                await network.fetch_with_retry(url, retries=retries, initial_delay_ms=0)
            return meter.telegram_requests

    return asyncio.run(_run())


def test_a_fetch_that_needed_three_attempts_counts_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: count `len(telemetry["attempts"])`.

    This is decision 15's whole point. Counting attempts would make a User on a
    flaky proxy pay three times for the page a User on a good one pays once for,
    and the Budget would then be measuring proxy health rather than demand.
    """
    calls = {"n": 0}

    async def flaky(*_args: object, **_kwargs: object) -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("boom")
        return "<html></html>"

    counted = _count_one_fetch(monkeypatch, flaky, retries=5)

    assert calls["n"] == 3
    assert counted == 1


def test_an_error_response_from_telegram_still_counts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: count only on the success path.

    Decision 20: Telegram spent the same resources answering 404 that it spends
    answering 200. Not charging for errors would also hand a User whose channels
    all fail an effectively unlimited Budget.
    """

    async def always_404(*_args: object, **_kwargs: object) -> str:
        raise _http_status_error(404)

    counted = _count_one_fetch(
        monkeypatch, always_404, expect_raises=httpx.HTTPStatusError
    )
    assert counted == 1


def test_every_answered_attempt_counts_at_the_production_retry_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Eight round trips Telegram served are eight Requests, not one.

    Mutation: charge once per `fetch_with_retry` call instead of per answered
    attempt. **This is the version that shipped in review and was wrong**, and
    it looked right because every other test in this file passed `retries=1`.

    `httpx.HTTPStatusError` subclasses `httpx.HTTPError`, so `is_network` is
    true for a 404 and the retry branch takes it round again — up to
    `NETWORK_FETCH_RETRIES`, which is 8 in production. A per-call charge bills
    one Request for eight real round trips, and it undercounts worst for the
    accounts under the most rate-limit pressure, which are precisely the ones
    generating the most load. Pinned at the real default rather than a
    convenient 1 for that reason.
    """
    assert settings.NETWORK_FETCH_RETRIES == 8, (
        "this guard is pinned to the production retry count; if the default "
        "moved, move the expectation with it rather than relaxing the test"
    )

    calls = {"n": 0}

    async def always_404(*_args: object, **_kwargs: object) -> str:
        calls["n"] += 1
        raise _http_status_error(404)

    counted = _count_one_fetch(
        monkeypatch,
        always_404,
        retries=settings.NETWORK_FETCH_RETRIES,
        expect_raises=httpx.HTTPStatusError,
    )

    assert calls["n"] == 8
    assert counted == 8


def test_a_rate_limited_page_that_succeeds_on_retry_costs_two(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 429 then a 200 is two Requests, inside one call.

    Both reached Telegram, so both cost it something, and a User being rate
    limited is precisely a User generating load. The "excluding retries" of
    decision 15 excludes the *transport* attempts a dead proxy forces, not the
    round trips Telegram answered — which is why this counts two from a single
    `fetch_with_retry`.
    """
    calls = {"n": 0}

    async def rate_limited_then_ok(*_args: object, **_kwargs: object) -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            raise _http_status_error(429)
        return "<html></html>"

    counted = _count_one_fetch(monkeypatch, rate_limited_then_ok, retries=4)

    assert calls["n"] == 2
    assert counted == 2


def test_transport_failures_before_an_answer_are_still_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The two rules together: dead proxies free, answered attempts charged.

    Mutation: charge every attempt regardless of how it ended. Two dead proxies
    followed by a served page is one Request, not three — the retries were the
    infrastructure's fault, and decision 15 says the User does not pay for them.
    """
    calls = {"n": 0}

    async def two_dead_proxies_then_ok(*_args: object, **_kwargs: object) -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("no route to host")
        return "<html></html>"

    counted = _count_one_fetch(monkeypatch, two_dead_proxies_then_ok, retries=5)

    assert calls["n"] == 3
    assert counted == 1


def test_a_soft_blocked_web_view_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation: treat `TelegramWebViewUnavailable` as a transport failure.

    It is a `ConnectionError` subclass, so the obvious `isinstance` test files it
    with the dead proxies. It is not one: Telegram served a page, and this is the
    single most common outcome for a restricted channel.
    """

    async def soft_block(*_args: object, **_kwargs: object) -> str:
        raise TelegramWebViewUnavailable()

    counted = _count_one_fetch(
        monkeypatch, soft_block, expect_raises=TelegramWebViewUnavailable
    )
    assert counted == 1


def test_a_fetch_that_never_reached_telegram_counts_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: count unconditionally on the give-up path."""

    async def dead_proxy(*_args: object, **_kwargs: object) -> str:
        raise httpx.ConnectError("no route to host")

    counted = _count_one_fetch(
        monkeypatch, dead_proxy, retries=2, expect_raises=httpx.ConnectError
    )
    assert counted == 0


def test_a_request_somewhere_other_than_the_web_view_counts_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: drop the `is_telegram_web_url` test.

    The Bot API, the thumbnail CDNs and the proxy health check all share this
    function. The Budget is denominated in web-view page fetches, so counting
    those would make one publish look like a sync.
    """

    async def ok(*_args: object, **_kwargs: object) -> dict[str, bool]:
        return {"ok": True}

    assert _count_one_fetch(monkeypatch, ok, url=NOT_TELEGRAM_URL) == 0


# --------------------------------------------------------------------------
# Which Budget
# --------------------------------------------------------------------------


def test_every_sync_mode_maps_to_a_budget() -> None:
    """Mutation: add a sixth `SyncOperationMode` and no mapping for it.

    Three Budgets and five modes, so the mapping is not the identity and cannot
    be eyeballed. A mode with no answer must fail here rather than default into
    whichever Budget an `else` branch happens to name.
    """
    for mode in SyncOperationMode.__args__:  # type: ignore[attr-defined]
        assert isinstance(budget_for_sync_mode(mode), Budget)


def test_the_scheduler_and_the_two_manual_shapes_are_told_apart() -> None:
    """The split that motivated three Budgets: throttled auto, generous manual."""
    assert budget_for_sync_mode("auto") is Budget.AUTO_SYNC
    assert budget_for_sync_mode("individual") is Budget.MANUAL_SINGLE
    assert budget_for_sync_mode("bulk") is Budget.MANUAL_BULK
    assert budget_for_sync_mode("sync_all") is Budget.MANUAL_BULK
    assert budget_for_sync_mode("recheck_restricted") is Budget.MANUAL_BULK


# --------------------------------------------------------------------------
# The ledger
# --------------------------------------------------------------------------


@pytest.fixture
def ledger_user() -> Generator[uuid.UUID]:
    """An account to charge, removed afterwards with its ledger by the cascade."""
    user = User(
        email=f"quota-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=get_password_hash("quota-test-password"),
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


def _rows_for(user_id: uuid.UUID) -> list[QuotaUsage]:
    with Session(engine) as session:
        return list(
            session.exec(select(QuotaUsage).where(QuotaUsage.user_id == user_id)).all()
        )


def test_a_charge_creates_the_row_for_that_day_and_budget(
    ledger_user: uuid.UUID,
) -> None:
    with Session(engine) as session:
        charge_requests(session, ledger_user, Budget.AUTO_SYNC, 5, day=DAY)

    with Session(engine) as session:
        row = session.get(QuotaUsage, (ledger_user, DAY, Budget.AUTO_SYNC.value))
    assert row is not None
    assert row.requests == 5


def test_a_second_charge_adds_rather_than_overwrites(ledger_user: uuid.UUID) -> None:
    """Mutation: `DO UPDATE SET requests = excluded.requests`.

    Every sync that completes today charges the same row. An overwrite would
    leave the ledger holding the size of the most recent sync — entirely
    plausible-looking, and not what anyone is being charged for.
    """
    with Session(engine) as session:
        charge_requests(session, ledger_user, Budget.MANUAL_BULK, 4, day=DAY)
        charge_requests(session, ledger_user, Budget.MANUAL_BULK, 6, day=DAY)

    with Session(engine) as session:
        row = session.get(QuotaUsage, (ledger_user, DAY, Budget.MANUAL_BULK.value))
    assert row is not None
    assert row.requests == 10


def test_budgets_and_days_are_charged_apart(ledger_user: uuid.UUID) -> None:
    """The primary key is all three columns, and each one has to separate rows."""
    with Session(engine) as session:
        charge_requests(session, ledger_user, Budget.AUTO_SYNC, 1, day=DAY)
        charge_requests(session, ledger_user, Budget.MANUAL_SINGLE, 2, day=DAY)
        charge_requests(
            session, ledger_user, Budget.AUTO_SYNC, 3, day=date(2026, 8, 26)
        )

    assert sorted(r.requests for r in _rows_for(ledger_user)) == [1, 2, 3]


def test_a_charge_of_nothing_writes_nothing(ledger_user: uuid.UUID) -> None:
    """A sync that made no Request leaves no row.

    Not a micro-optimisation: a row of zero is indistinguishable from a real day
    of zero usage, and the Admin view would fill with accounts that did nothing.
    """
    with Session(engine) as session:
        charge_requests(session, ledger_user, Budget.AUTO_SYNC, 0, day=DAY)

    assert _rows_for(ledger_user) == []


def test_usage_rows_reports_one_day_across_accounts(ledger_user: uuid.UUID) -> None:
    with Session(engine) as session:
        charge_requests(session, ledger_user, Budget.AUTO_SYNC, 9, day=DAY)
        charge_requests(session, ledger_user, Budget.MANUAL_BULK, 1, day=DAY)
        charge_requests(
            session, ledger_user, Budget.AUTO_SYNC, 99, day=date(2026, 8, 24)
        )

    with Session(engine) as session:
        rows = usage_rows(session, day=DAY)

    mine = [r for r in rows if r.user_id == ledger_user]
    assert {(r.budget, r.requests) for r in mine} == {
        (Budget.AUTO_SYNC.value, 9),
        (Budget.MANUAL_BULK.value, 1),
    }


def test_deleting_an_account_takes_its_ledger_with_it(ledger_user: uuid.UUID) -> None:
    """ "Never pruned" is about retention, not about accounts that cease to exist."""
    with Session(engine) as session:
        charge_requests(session, ledger_user, Budget.AUTO_SYNC, 3, day=DAY)

    with Session(engine) as session:
        session.delete(session.get(User, ledger_user))
        session.commit()

    assert _rows_for(ledger_user) == []


# --------------------------------------------------------------------------
# Charging at completion
# --------------------------------------------------------------------------


def _run_job(
    monkeypatch: pytest.MonkeyPatch,
    *,
    user_id: uuid.UUID | None,
    sync_mode: str,
    requests_per_channel: int,
    channels: int = 3,
    fail: bool = False,
) -> None:
    """Drive `run_sync_job` with the channel sync replaced by a metered stub.

    The stub sits where the real channel sync sits, so everything between the
    meter opening and the charge is exercised for real. Faking the HTTP
    underneath keeps the test about the wiring rather than about the scraper.
    """
    from app.services import sync_orchestrator
    from app.services.scraper_jobs import ChannelSyncState, SyncJobState

    async def fake_sync_channel(
        _job: object, ch_state: ChannelSyncState, **_kwargs: object
    ) -> None:
        for _ in range(requests_per_channel):
            request_meter.record_telegram_request()
            await asyncio.sleep(0)
        if fail:
            raise RuntimeError("sync blew up")
        ch_state.status = "success"

    async def noop(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(sync_orchestrator, "sync_single_channel", fake_sync_channel)
    monkeypatch.setattr(sync_orchestrator, "touch_job", noop)
    monkeypatch.setattr(sync_orchestrator, "persist_job", noop)
    monkeypatch.setattr(sync_orchestrator, "deactivate_job", lambda _job_id: None)
    # The Partition, stubbed, because `run_sync_job` takes Slots out of it
    # rather than sizing a semaphore of its own since ADR-012. Four wide, which
    # is what the `_load_sync_job_concurrency` stub this replaced returned — the
    # concurrency is incidental to the ledger, and keeping the number the same
    # keeps the change to what it is.
    partition = direct_partition(4)

    async def fake_partition() -> ProxyWorkerPool:
        return partition

    monkeypatch.setattr(sync_orchestrator, "get_partition", fake_partition)

    job = SyncJobState(
        job_id=f"quota-job-{uuid.uuid4().hex[:8]}",
        source="test",
        user_id=str(user_id) if user_id else None,
        sync_mode=sync_mode,  # type: ignore[arg-type]
        channels={
            f"ch{i}": ChannelSyncState(channel_id=f"ch{i}", channel_name=f"ch{i}")
            for i in range(channels)
        },
    )

    async def _run() -> None:
        if fail:
            with pytest.raises(RuntimeError):
                await sync_orchestrator.run_sync_job(job, user_id)
        else:
            await sync_orchestrator.run_sync_job(job, user_id)

    asyncio.run(_run())


def test_a_completed_job_charges_every_request_it_made(
    monkeypatch: pytest.MonkeyPatch, ledger_user: uuid.UUID
) -> None:
    """Three channels, four page fetches each, one row of twelve.

    Mutation: charge inside `_run_one` instead of after the gather. The total
    stays right and the write count multiplies by the fan-out — the version that
    looks correct until somebody reads `pg_stat_statements`.
    """
    _run_job(
        monkeypatch,
        user_id=ledger_user,
        sync_mode="bulk",
        requests_per_channel=4,
        channels=3,
    )

    rows = _rows_for(ledger_user)
    assert len(rows) == 1
    assert rows[0].requests == 12
    assert rows[0].budget == Budget.MANUAL_BULK.value
    assert rows[0].day == today_utc()


def test_the_scheduler_and_a_click_land_in_different_budgets(
    monkeypatch: pytest.MonkeyPatch, ledger_user: uuid.UUID
) -> None:
    """Mutation: charge every job to one Budget.

    Decision 16's whole point is throttling the scheduler while leaving manual
    work alone, and that needs the two told apart at the moment they are
    charged, not reconstructed later.
    """
    _run_job(
        monkeypatch,
        user_id=ledger_user,
        sync_mode="auto",
        requests_per_channel=2,
        channels=1,
    )
    _run_job(
        monkeypatch,
        user_id=ledger_user,
        sync_mode="individual",
        requests_per_channel=5,
        channels=1,
    )

    charged = {r.budget: r.requests for r in _rows_for(ledger_user)}
    assert charged == {
        Budget.AUTO_SYNC.value: 2,
        Budget.MANUAL_SINGLE.value: 5,
    }


def test_a_job_that_died_is_still_charged_for_what_it_fetched(
    monkeypatch: pytest.MonkeyPatch, ledger_user: uuid.UUID
) -> None:
    """Mutation: charge after the gather instead of in a `finally`.

    Telegram served those pages. A charge that only happens on the happy path
    makes a job that crashes on its last channel free, which is a discount for
    failing.
    """
    _run_job(
        monkeypatch,
        user_id=ledger_user,
        sync_mode="bulk",
        requests_per_channel=3,
        channels=1,
        fail=True,
    )

    rows = _rows_for(ledger_user)
    assert len(rows) == 1
    assert rows[0].requests == 3


def test_a_job_that_made_no_requests_is_not_charged(
    monkeypatch: pytest.MonkeyPatch, ledger_user: uuid.UUID
) -> None:
    """A skipped sync — nothing due, everything frozen — writes no row."""
    _run_job(
        monkeypatch,
        user_id=ledger_user,
        sync_mode="auto",
        requests_per_channel=0,
        channels=2,
    )
    assert _rows_for(ledger_user) == []


def test_an_ownerless_job_is_charged_to_the_operator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A legacy job with no `user_id` still has to land somewhere.

    Mutation: pass `user_id` straight through to `charge_requests`. The foreign
    key rejects `None`, and the failure surfaces at the very end of a sync that
    otherwise worked perfectly.
    """
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
    assert operator_id is not None, "the test database has no bootstrap superuser"

    _run_job(
        monkeypatch,
        user_id=None,
        sync_mode="auto",
        requests_per_channel=2,
        channels=1,
    )

    try:
        assert [r.requests for r in _rows_for(operator_id)] == [2]
    finally:
        # The operator outlives the test, so its ledger has to be cleared by
        # hand — `_clean_tg_tables_after_test` truncates the table, but only
        # after this test has already asserted against it.
        with Session(engine) as session:
            session.execute(
                sa_delete(QuotaUsage).where(col(QuotaUsage.user_id) == operator_id)
            )
            session.commit()


def test_a_bulk_follow_batch_charges_its_probes_to_manual_bulk(
    monkeypatch: pytest.MonkeyPatch, ledger_user: uuid.UUID
) -> None:
    """The probe phase is one `t.me` fetch per handle, and a batch runs to hundreds.

    Mutation: drop the meter from `run_follow_job`. Bulk follow was the largest
    manual source of Requests that nothing counted — the plan's Budget table
    names "bulk follow" under `manual_bulk`, and only the sync it chains
    afterwards was actually charged.
    """
    from app.services import bulk_follow

    async def fake_probe(_job: object, result: object, **_kwargs: object) -> None:
        request_meter.record_telegram_request()
        await asyncio.sleep(0)
        result.status = "skipped"  # type: ignore[attr-defined]

    async def noop(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(bulk_follow, "_process_one_channel", fake_probe)
    monkeypatch.setattr(bulk_follow, "touch_follow_job", noop)
    monkeypatch.setattr(bulk_follow, "_chain_sync_job", noop)
    monkeypatch.setattr(bulk_follow, "_load_effective_start_time", lambda _uid: 0)
    monkeypatch.setattr(bulk_follow, "_load_proxy_concurrency", lambda _uid: (1, {}))

    job = bulk_follow.FollowJobState(
        follow_job_id=f"follow-{uuid.uuid4().hex[:8]}",
        results=[bulk_follow.FollowChannelResult(name=f"ch{i}") for i in range(5)],
        user_id=str(ledger_user),
    )

    asyncio.run(bulk_follow.run_follow_job(job))

    rows = _rows_for(ledger_user)
    assert len(rows) == 1
    assert rows[0].budget == Budget.MANUAL_BULK.value
    assert rows[0].requests == 5


def test_the_chained_sync_is_not_charged_to_the_follow_job(
    monkeypatch: pytest.MonkeyPatch, ledger_user: uuid.UUID
) -> None:
    """Nested meters must not double-count, and must not cross-count.

    Mutation: make `metered()` set the ContextVar back to `None` on exit rather
    than resetting the token. `run_follow_job` wraps a block that spawns
    `run_sync_job`, which opens a meter of its own — the inner one has to
    restore the outer, not clear it, or the follow job stops counting its own
    remaining probes.
    """
    from app.services import bulk_follow

    async def probe_then_nested_sync(
        _job: object, result: object, **_kwargs: object
    ) -> None:
        request_meter.record_telegram_request()
        # Stands in for the chained sync job: its own meter, its own count.
        with request_meter.metered() as inner:
            request_meter.record_telegram_request()
            request_meter.record_telegram_request()
            assert inner.telegram_requests == 2
        # The outer meter must still be the one in force here.
        request_meter.record_telegram_request()
        result.status = "skipped"  # type: ignore[attr-defined]

    async def noop(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(bulk_follow, "_process_one_channel", probe_then_nested_sync)
    monkeypatch.setattr(bulk_follow, "touch_follow_job", noop)
    monkeypatch.setattr(bulk_follow, "_chain_sync_job", noop)
    monkeypatch.setattr(bulk_follow, "_load_effective_start_time", lambda _uid: 0)
    monkeypatch.setattr(bulk_follow, "_load_proxy_concurrency", lambda _uid: (1, {}))

    job = bulk_follow.FollowJobState(
        follow_job_id=f"follow-{uuid.uuid4().hex[:8]}",
        results=[bulk_follow.FollowChannelResult(name="ch0")],
        user_id=str(ledger_user),
    )

    asyncio.run(bulk_follow.run_follow_job(job))

    rows = _rows_for(ledger_user)
    assert len(rows) == 1
    # Two from the outer block; the inner meter's two went nowhere near it.
    assert rows[0].requests == 2


# --------------------------------------------------------------------------
# Never pruned
# --------------------------------------------------------------------------


def test_retention_cannot_reach_the_ledger() -> None:
    """Mutation: add `QuotaUsage` to retention's model list.

    "Kept forever" (decision 19) is the property that makes the ledger worth
    reading at all — an Admin setting next quarter's limits is looking at last
    quarter's numbers. Retention works from an explicit list of models, and this
    asserts the ledger is not on it rather than trusting that nobody adds it:
    the table is small, so a well-meant "prune everything old" would find no
    resistance and no symptom until somebody asked for a trend.
    """
    from app.jobs import retention

    source = pathlib.Path(retention.__file__).read_text()
    assert "QuotaUsage" not in source
    assert "tg_quota_usage" not in source


def test_the_admin_table_clear_cannot_reach_the_ledger() -> None:
    """Mutation: add the ledger to `stats._TABLE_SECTIONS`.

    `clear_table` deletes every row of one named table, and its inventory
    doubles as the export document's section list. Adding the ledger there would
    put "wipe the billing record" behind a button labelled with a table name.
    """
    from app.services.stats import _TABLE_SECTIONS

    assert QuotaUsage not in [model for _name, model in _TABLE_SECTIONS]
