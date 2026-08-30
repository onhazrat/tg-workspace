"""Weighted, tiered, per-account draining, and lane control (ticket 12).

`test_sync_lanes.py` drives the policy as arithmetic. This file drives it as
**load**: real PGMQ queues, the real `drain_sync_lanes` loop, real messages, with
only the work at the bottom stubbed out. That distinction is the point — the
ticket's own words are "a steady trickle of manual work cannot starve automatic
sync", which is a property of the running worker and not of a dictionary of
weights. A test that asserted `BUDGET_WEIGHTS == {...}` would pass against a
drain loop that ignored them entirely.

The seam is `sync_queue._process_message`, replaced by a recorder. Everything
above it is the real thing: the buffers, the reads, the scheduler, the
concurrency gate and the slot handling.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlmodel import Session, col, delete

from app.core.config import settings
from app.core.db import engine
from app.jobs import sync_queue
from app.models import User
from app.models_tg import Channel
from app.services import pgmq, sync_lane_control, sync_orchestrator
from app.services.channels import try_claim_channel_sync
from app.services.proxy_pool import ProxyWorkerPool, build_workers
from app.services.scraper_jobs import (
    ChannelSyncState,
    SyncJobState,
    clear_jobs_for_tests,
    create_job,
    get_job,
)
from app.services.settings_registry import SYNC_LANES_KEY
from app.services.settings_store import replace_global_setting
from app.services.sync_lanes import (
    AUTO_SYNC_NORMAL_LANE,
    DRAIN_ORDER,
    MANUAL_BULK_NORMAL_LANE,
    MANUAL_SINGLE_BEST_EFFORT_LANE,
    MANUAL_SINGLE_NORMAL_LANE,
)
from tests.utils.setting_groups import add_test_channel
from tests.utils.tenancy import ANY_READER
from tests.utils.user import create_random_user

CHANNEL_ID = "t12-shared"
CHANNEL_NAME = "t12shared"


def _empty(lane: str) -> None:
    with Session(engine) as session:
        while True:
            msgs = pgmq.read(session, lane, vt_seconds=0, qty=100)
            if not msgs:
                break
            for msg in msgs:
                pgmq.delete(session, lane, msg.msg_id)
            session.commit()


@pytest.fixture(autouse=True)
def _clean() -> Iterator[None]:
    clear_jobs_for_tests()
    sync_queue.reset_worker_partition_for_tests()
    sync_queue.stop_lane_consumer()
    sync_queue._claimed_messages.clear()
    for lane in DRAIN_ORDER:
        _empty(lane)
    with Session(engine) as session:
        replace_global_setting(session, SYNC_LANES_KEY, {})
    yield
    for lane in DRAIN_ORDER:
        _empty(lane)
    with Session(engine) as session:
        replace_global_setting(session, SYNC_LANES_KEY, {})


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _fill(lane: str, count: int, *, owner: str | None = None, tag: str = "c") -> None:
    payloads = [
        {"jobId": "j", "channelId": f"{tag}{i}", "userId": owner} for i in range(count)
    ]
    with Session(engine) as session:
        pgmq.send_batch(session, lane, payloads)
        session.commit()


class _Recorder:
    """Stands in for the work, and records the order it was dispatched in."""

    def __init__(self, delays: dict[str, float] | None = None) -> None:
        self.lanes: list[str] = []
        self.messages: list[dict[str, Any]] = []
        self.started_at: dict[str, float] = {}
        self.finished_at: dict[str, float] = {}
        self._delays = delays or {}

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake(msg: pgmq.PgmqMessage, slot: sync_queue.SyncSlot) -> None:
            channel = str(msg.message.get("channelId"))
            self.messages.append(dict(msg.message))
            self.started_at[channel] = time.monotonic()
            await asyncio.sleep(self._delays.get(channel, 0))
            self.finished_at[channel] = time.monotonic()

        monkeypatch.setattr(sync_queue, "_process_message", fake)

    def note_lane(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Also record which lane each message came off."""
        real = sync_queue._handle_one

        async def wrapper(
            lane: str, msg: pgmq.PgmqMessage, slot: sync_queue.SyncSlot
        ) -> str:
            self.lanes.append(lane)
            return await real(lane, msg, slot)

        monkeypatch.setattr(sync_queue, "_handle_one", wrapper)


def _direct_partition(width: int) -> ProxyWorkerPool:
    """A partition of `width` workers with no proxy behind them.

    The proxy-less shape (ticket 13): with nothing configured there is nothing
    to partition, so the worker list is just `syncConcurrency` wide and behaves
    exactly as the semaphore it replaced. That is what these tests want — they
    are about dispatch *order*, not about which egress a message went out of.
    """
    return ProxyWorkerPool(build_workers([], width))


def _pin_concurrency(monkeypatch: pytest.MonkeyPatch, value: int) -> ProxyWorkerPool:
    """Replace the partition with one of a known width.

    The real `_partition` reads settings and the proxy pool. Sizing it here is
    what lets a test say "one slot" and mean it, which is the only way to
    observe dispatch *order* rather than the order N concurrent tasks happen to
    finish.
    """
    partition = _direct_partition(value)

    async def fake_partition() -> ProxyWorkerPool:
        return partition

    monkeypatch.setattr(sync_queue, "_partition", fake_partition)
    return partition


# --- checkbox 2: strict between tiers, weighted within one ----------------


def test_a_trickle_of_manual_work_does_not_starve_auto_sync_under_load(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ticket's own sentence, driven through the real drain loop.

    Both lanes stay busy for the whole run, which is what "a steady trickle"
    means: single syncs never run out, so a strict order would serve auto-sync
    zero times and the deployment would stop updating while the worker looked
    perfectly busy.
    """
    recorder = _Recorder()
    recorder.install(monkeypatch)
    recorder.note_lane(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 24, tag="s")
    _fill(AUTO_SYNC_NORMAL_LANE, 24, tag="a")

    asyncio.run(sync_queue.drain_sync_lanes())

    first_eight = recorder.lanes[:8]
    assert first_eight.count(AUTO_SYNC_NORMAL_LANE) == 2, (
        f"auto-sync ran {first_eight.count(AUTO_SYNC_NORMAL_LANE)} of the first "
        f"8 messages ({first_eight}); at 3:1 it is 2. Zero means a strict order "
        "and a deployment that silently stops syncing."
    )
    # And every message eventually ran: fairness is a scheduling rule, not a cap.
    assert len(recorder.lanes) == 48


def test_best_effort_waits_for_the_whole_normal_tier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Strict between tiers. The best-effort lane here carries the *heaviest*
    Budget and the normal lane the lightest, so only the tier rule can produce
    this ordering — a weighting mistake would interleave them."""
    recorder = _Recorder()
    recorder.install(monkeypatch)
    recorder.note_lane(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_BEST_EFFORT_LANE, 6, tag="b")
    _fill(AUTO_SYNC_NORMAL_LANE, 6, tag="n")

    asyncio.run(sync_queue.drain_sync_lanes())

    assert (
        recorder.lanes
        == [AUTO_SYNC_NORMAL_LANE] * 6 + [MANUAL_SINGLE_BEST_EFFORT_LANE] * 6
    )


def test_normal_work_arriving_mid_drain_preempts_best_effort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The tier check has to be live, not a snapshot taken when the drain began.

    A best-effort backlog is long by definition, so the realistic case is a
    drain that started with the normal tier empty and has to notice new normal
    work part-way through. A latched check would finish the entire best-effort
    backlog first.
    """
    # Each best-effort message takes a moment, so the backlog is still draining
    # when the normal-tier message arrives — otherwise the drain would simply
    # finish first and the test would prove nothing about preemption.
    recorder = _Recorder(delays={f"b{i}": 0.02 for i in range(40)})
    recorder.install(monkeypatch)
    recorder.note_lane(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_BEST_EFFORT_LANE, 40, tag="b")

    async def run() -> None:
        drain = asyncio.create_task(sync_queue.drain_sync_lanes())
        await asyncio.sleep(0.1)
        await asyncio.to_thread(_fill, MANUAL_SINGLE_NORMAL_LANE, 1)
        await drain

    asyncio.run(run())

    assert len(recorder.lanes) == 41, "not everything drained"
    normal_at = recorder.lanes.index(MANUAL_SINGLE_NORMAL_LANE)
    assert normal_at < 30, (
        f"the normal-tier message ran at position {normal_at} of 41, so it "
        "waited behind most of the best-effort backlog — the tier check is "
        "latched at the start of the drain rather than live"
    )


# --- checkbox 3: interleaved across accounts ------------------------------


def test_one_accounts_backlog_does_not_block_another_accounts_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PGMQ is FIFO by `msg_id`. Account B enqueues three messages *after*
    account A has enqueued thirty, so on a plain read of the head B's first
    message is the thirty-first thing to run. That is decision 31's stated
    failure — "a user following 500 channels would otherwise block everyone
    behind them" — and it is what `_read_interleaved` exists to prevent."""
    a_id, b_id = str(uuid.uuid4()), str(uuid.uuid4())
    recorder = _Recorder()
    recorder.install(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 30, owner=a_id, tag="a")
    _fill(MANUAL_SINGLE_NORMAL_LANE, 3, owner=b_id, tag="b")

    asyncio.run(sync_queue.drain_sync_lanes())

    owners = [msg.get("userId") for msg in recorder.messages]
    first_b = owners.index(b_id)
    assert first_b < settings.SYNC_QUEUE_BATCH_SIZE, (
        f"account B's first message ran at position {first_b}, behind account "
        "A's backlog. FIFO by msg_id would put it at 30."
    )
    assert len(owners) == 33


def test_a_single_account_is_read_without_the_interleaving_machinery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every deployment today has one account, and it must not pay for the
    round-robin: one `pgmq.read` per drain pass, not one per account."""
    reads: list[dict[str, Any] | None] = []
    real_read = pgmq.read

    def counting_read(*args: Any, **kwargs: Any) -> Any:
        reads.append(kwargs.get("matching"))
        return real_read(*args, **kwargs)

    monkeypatch.setattr(pgmq, "read", counting_read)
    recorder = _Recorder()
    recorder.install(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 4, owner=str(uuid.uuid4()), tag="s")

    asyncio.run(sync_queue.drain_sync_lanes())

    assert len(recorder.messages) == 4
    assert all(matching is None for matching in reads), (
        "a single-account lane was read with a per-account filter; the "
        "round-robin should not engage at all below two accounts"
    )


# --- head-of-line note 1: a slot frees on its own ------------------------


def test_a_slow_message_does_not_hold_up_another_lane(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ticket 10's head-of-line note, as a behaviour.

    It drained `for lane in DRAIN_ORDER`, one lane fully before the next was
    even read, and awaited each batch as a unit. So one Channel in a deep
    backfill held up every other lane for as long as it took. Here the slow
    message is on the *first* lane in drain order and the fast one on the
    second, with a spare slot: the fast message has to start before the slow one
    finishes.
    """
    recorder = _Recorder(delays={"slow0": 0.6})
    recorder.install(monkeypatch)
    _pin_concurrency(monkeypatch, 2)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 1, tag="slow")
    _fill(MANUAL_BULK_NORMAL_LANE, 1, tag="fast")

    asyncio.run(sync_queue.drain_sync_lanes())

    assert "fast0" in recorder.started_at, "the second lane was never reached"
    assert recorder.started_at["fast0"] < recorder.finished_at["slow0"], (
        "the bulk lane's message waited for the single lane's slow message to "
        "finish; lanes are being drained one whole lane at a time again"
    )


def test_the_gate_is_what_limits_concurrency_not_the_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With one slot, nothing overlaps; the loop must not dispatch a batch's
    worth of tasks and let them queue on the semaphore, because then the lane
    weighting would be decided once per batch instead of once per message."""
    recorder = _Recorder(delays={f"s{i}": 0.02 for i in range(4)})
    recorder.install(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 4, tag="s")

    asyncio.run(sync_queue.drain_sync_lanes())

    ordered = sorted(recorder.started_at, key=lambda c: recorder.started_at[c])
    for earlier, later in zip(ordered, ordered[1:], strict=False):
        assert recorder.finished_at[earlier] <= recorder.started_at[later] + 1e-6, (
            "two messages overlapped with a single-permit gate"
        )


# --- head-of-line note 2: a waiter does not hold a scraping slot ---------


def test_a_slot_put_down_is_available_to_someone_else_and_taken_back() -> None:
    """`SyncSlot.released()` in isolation: the permit really goes back to the
    gate for the body, and really is re-taken afterwards. Both halves matter —
    a version that released and never re-acquired would let the worker exceed
    `syncConcurrency` the moment a coalesced request resumed."""

    async def run() -> tuple[bool, bool, bool]:
        partition = _direct_partition(1)
        worker = await partition.acquire()
        assert worker is not None
        slot = sync_queue.SyncSlot.holding(partition, worker)
        held_before = partition.all_busy()
        async with slot.released():
            free_during = not partition.all_busy()
        held_after = partition.all_busy()
        slot.release()
        return held_before, free_during, held_after

    held_before, free_during, held_after = asyncio.run(run())
    assert held_before, "the slot did not hold the permit to begin with"
    assert free_during, "the waiter kept its scraping slot while waiting"
    assert held_after, "the permit was not re-taken before the claim re-attempt"


def test_a_coalesced_waiter_frees_its_slot_for_another_channel(
    session: Session, user: User
) -> None:
    """Ticket 11's note, resolved. A request that finds its Channel already
    being synced waits — and while it waits it must not occupy one of the
    deployment's scraping slots, because N requests for one busy Channel then
    occupy N of them and scrape nothing."""
    add_test_channel(session, CHANNEL_ID, name=CHANNEL_NAME, user_id=user.id)
    assert try_claim_channel_sync(CHANNEL_ID, holder="somebody-else") is True

    async def run() -> bool:
        partition = _direct_partition(1)
        worker = await partition.acquire()
        assert worker is not None
        slot = sync_queue.SyncSlot.holding(partition, worker)
        ch_state = ChannelSyncState(channel_id=CHANNEL_ID, channel_name=CHANNEL_NAME)
        job = SyncJobState(
            job_id="t12-coalesce",
            source="test",
            channels={CHANNEL_ID: ch_state},
            user_id=str(user.id),
            sync_mode="individual",
        )
        waiter = asyncio.create_task(
            sync_orchestrator._claim_or_coalesce(job, ch_state, "mine", slot=slot)
        )
        await asyncio.sleep(0.4)
        free_while_waiting = not partition.all_busy()
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        return free_while_waiting

    assert asyncio.run(run()), (
        "the coalesced request held a scraping permit while it waited for "
        "another runner's Channel"
    )

    with Session(engine) as cleanup:
        cleanup.exec(delete(Channel).where(col(Channel.id) == CHANNEL_ID))
        cleanup.commit()


# --- checkbox 4: an Admin can pause or drain a lane ----------------------


def test_a_paused_lane_is_not_read_and_keeps_its_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pausing is reversible and lossless: the messages stay queued *and stay
    visible*, so a resume does not have to wait out a visibility timeout."""
    recorder = _Recorder()
    recorder.install(monkeypatch)
    recorder.note_lane(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 3, tag="p")
    _fill(AUTO_SYNC_NORMAL_LANE, 2, tag="a")
    with Session(engine) as session:
        sync_lane_control.set_lane_paused(
            session, MANUAL_SINGLE_NORMAL_LANE, paused=True
        )

    asyncio.run(sync_queue.drain_sync_lanes())

    assert recorder.lanes == [AUTO_SYNC_NORMAL_LANE] * 2
    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 3
        still_due = pgmq.distinct_due_values(
            session, MANUAL_SINGLE_NORMAL_LANE, "channelId", limit=10
        )
    assert len(still_due) == 3, "a paused lane's messages were claimed and hidden"


def test_resuming_a_lane_lets_it_drain_again(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = _Recorder()
    recorder.install(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 2, tag="p")
    with Session(engine) as session:
        sync_lane_control.set_lane_paused(
            session, MANUAL_SINGLE_NORMAL_LANE, paused=True
        )
        sync_lane_control.set_lane_paused(
            session, MANUAL_SINGLE_NORMAL_LANE, paused=False
        )
        assert sync_lane_control.paused_lanes(session) == set()

    asyncio.run(sync_queue.drain_sync_lanes())
    assert len(recorder.messages) == 2


def test_pausing_one_lane_does_not_pause_its_tier_or_its_budget() -> None:
    """A lane is the unit, which is the point of having six of them."""
    with Session(engine) as session:
        sync_lane_control.set_lane_paused(
            session, MANUAL_SINGLE_NORMAL_LANE, paused=True
        )
        assert sync_lane_control.paused_lanes(session) == {MANUAL_SINGLE_NORMAL_LANE}
        depths = {d.lane: d.paused for d in sync_lane_control.lane_depths(session)}
    assert depths[MANUAL_SINGLE_NORMAL_LANE] is True
    assert depths[MANUAL_SINGLE_BEST_EFFORT_LANE] is False
    assert depths[AUTO_SYNC_NORMAL_LANE] is False


def test_an_unknown_lane_is_refused_rather_than_stored() -> None:
    """The name reaches SQL as an identifier, and a stored non-lane would be a
    pause nothing ever honours."""
    with Session(engine) as session:
        with pytest.raises(ValueError):
            sync_lane_control.set_lane_paused(session, "q_channels", paused=True)
        with pytest.raises(ValueError):
            sync_lane_control.require_lane("manual_single")


def test_draining_a_lane_archives_its_messages_and_finishes_their_jobs() -> None:
    """A purge that only removed messages would strand every job behind them.

    Since ticket 10 a job goes terminal when its *last* Channel finishes, so
    messages that will never run mean Channels that stay `pending` for ever, a
    job that never completes, and `has_active_sync_job()` answering True — which
    makes auto-sync skip every tick from then on.
    """

    async def run() -> tuple[sync_lane_control.DrainResult, str | None, int]:
        job = await create_job(
            channel_entries=[("c1", "c1"), ("c2", "c2"), ("c3", "c3")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        await sync_queue.enqueue_sync_job(job, None)
        result = await sync_lane_control.drain_lane(MANUAL_SINGLE_NORMAL_LANE)
        after = get_job(job.job_id)
        with Session(engine) as session:
            left = pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE)
        return result, (after.status if after else None), left

    result, status, left = asyncio.run(run())
    assert result.archived == 3
    assert result.jobs_cancelled == 1
    assert left == 0
    assert status == "cancelled", (
        f"the job behind the purged messages is {status!r}; it can never "
        "finish now that its Channels' messages are gone"
    )


def test_draining_finishes_a_job_whose_messages_are_only_partly_purged() -> None:
    """The realistic shape: one Channel of a batch already ran, the rest are
    discarded. The job still has to reach a terminal state — this is the case a
    naive "archive the messages" purge gets wrong, because the job looks alive
    and merely stalled."""

    async def run() -> tuple[int, str | None]:
        job = await create_job(
            channel_entries=[("d1", "d1"), ("d2", "d2")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        await sync_queue.enqueue_sync_job(job, None)
        # One Channel finished before the operator hit drain.
        job.channels["d1"].status = "success"
        with Session(engine) as session:
            first = pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=0, qty=1)[
                0
            ]
            pgmq.archive(session, MANUAL_SINGLE_NORMAL_LANE, first.msg_id)
            session.commit()

        result = await sync_lane_control.drain_lane(MANUAL_SINGLE_NORMAL_LANE)
        after = get_job(job.job_id)
        return result.archived, (after.status if after else None)

    archived, status = asyncio.run(run())
    assert archived == 1
    assert status == "cancelled"


def test_draining_an_empty_lane_cancels_nothing() -> None:
    result = asyncio.run(sync_lane_control.drain_lane(AUTO_SYNC_NORMAL_LANE))
    assert result.archived == 0
    assert result.jobs_cancelled == 0


def test_a_second_drain_returns_instead_of_parking_on_a_busy_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The 30-second sweep must not sit blocked behind a deep backfill.

    `drain_sync_lanes` waits for a permit as its backpressure, which is right
    once it is dispatching — but a *second* drain that has dispatched nothing
    and finds every permit taken would park until the first finished and then
    find the lanes empty. It is a scheduled job with APScheduler's default
    `max_instances=1`, so parking it suppresses every tick behind it. The drain
    already running loops until its lanes are empty, so there is nothing for the
    second one to do anyway.
    """
    recorder = _Recorder()
    recorder.install(monkeypatch)
    gate = _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 2, tag="s")

    async def run() -> dict[str, int]:
        await gate.acquire()  # stand in for the drain that is already working
        return await asyncio.wait_for(sync_queue.drain_sync_lanes(), timeout=5)

    result = asyncio.run(run())

    assert result == {"processed": 0, "exhausted": 0}
    assert recorder.messages == []
    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 2
        assert (
            len(
                pgmq.distinct_due_values(
                    session, MANUAL_SINGLE_NORMAL_LANE, "channelId", limit=10
                )
            )
            == 2
        ), "the messages were claimed and hidden by a drain that ran nothing"


# --- what code review found ----------------------------------------------


def test_a_failing_lane_read_does_not_leak_a_concurrency_permit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The worker is taken before the read that can fail, so every path out has
    to give it back.

    `_next_message` opens a `Session` and runs several queries; one connection
    blip would otherwise leak a worker, and the partition is module-global and
    rebuilt only when the configuration changes, so the loss never heals. After
    `syncConcurrency` blips the worker process parks on `acquire()` for ever —
    and the all-busy break then reports every sweep as an empty queue, so
    nothing anywhere says why syncing stopped.

    Ticket 13 replaced the semaphore with the partition and this guard came
    with it: a worker left `busy` is exactly the same leak, reached through the
    same path. It reads `worker.busy` rather than a private counter, so it
    also names *which* worker was lost.
    """
    partition = _pin_concurrency(monkeypatch, 2)

    async def boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("connection reset")

    monkeypatch.setattr(sync_queue, "_next_message", boom)

    async def run() -> None:
        with pytest.raises(RuntimeError):
            await sync_queue.drain_sync_lanes()

    asyncio.run(run())

    stuck = [w.index for w in partition.workers if w.busy]
    assert not stuck, (
        f"workers {stuck} are still marked busy after a failed read; a leaked "
        "worker never comes back and the partition eventually deadlocks"
    )


def test_pausing_a_lane_takes_effect_during_a_drain_already_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A drain has no bounded length — it returns only when every lane is empty
    and nothing is in flight — so reading the paused set once at the start means
    an Admin pausing a runaway lane watches it keep draining for hours. The 30s
    sweep is no rescue: APScheduler skips every tick behind a running drain."""
    monkeypatch.setattr(sync_queue, "_PAUSE_RECHECK_SECONDS", 0.05)
    recorder = _Recorder(delays={f"p{i}": 0.02 for i in range(60)})
    recorder.install(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 60, tag="p")

    async def run() -> None:
        drain = asyncio.create_task(sync_queue.drain_sync_lanes())
        await asyncio.sleep(0.15)
        with Session(engine) as pause_session:
            await asyncio.to_thread(
                sync_lane_control.set_lane_paused,
                pause_session,
                MANUAL_SINGLE_NORMAL_LANE,
                paused=True,
            )
        await asyncio.wait_for(drain, timeout=10)

    asyncio.run(run())

    assert len(recorder.messages) < 60, (
        "the drain served every message despite the lane being paused part-way "
        "through; the paused set is a snapshot taken once at drain start"
    )
    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) > 0


def test_the_account_window_rotates_so_the_last_account_is_reached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`MAX_INTERLEAVED_USERS` without a rotating cursor is the same starvation
    one rung up.

    Ordering by id and taking the first N hands the window to the same
    lowest-sorted accounts on every pass for as long as they have work. Everyone
    is *eventually* served — the queue does drain — so the assertion has to be
    about **when**, exactly as it is one level down: the third account's single
    message must not wait behind sixty messages belonging to the two accounts
    that happen to sort first.
    """
    monkeypatch.setattr(sync_queue, "MAX_INTERLEAVED_USERS", 2)
    sync_queue._interleave_cursor.clear()
    owners = sorted(str(uuid.uuid4()) for _ in range(3))
    recorder = _Recorder()
    recorder.install(monkeypatch)
    _pin_concurrency(monkeypatch, 1)
    _fill(MANUAL_SINGLE_NORMAL_LANE, 30, owner=owners[0], tag="oax")
    _fill(MANUAL_SINGLE_NORMAL_LANE, 30, owner=owners[1], tag="obx")
    _fill(MANUAL_SINGLE_NORMAL_LANE, 1, owner=owners[2], tag="ocx")

    asyncio.run(sync_queue.drain_sync_lanes())

    served = [msg.get("userId") for msg in recorder.messages]
    assert len(served) == 61
    last_at = served.index(owners[2])
    assert last_at < 20, (
        f"the account outside the first window ran at position {last_at} of 61 "
        "— it waited for the two accounts that sort before it to drain "
        "completely, which is the failure the window is supposed to prevent"
    )


def test_a_waiter_that_cannot_get_its_permit_back_gives_up_rather_than_scrape(
    session: Session, user: User
) -> None:
    """The re-acquire is bounded by the coalescing deadline, and a waiter that
    misses it must stop.

    The drain sits on `gate.acquire()`, so a released permit is taken at once by
    a fresh Channel that holds it for a whole page walk. An unbounded re-acquire
    parks the waiter there evaluating neither its deadline nor its job's
    cancellation, which is how a coalesced request outlives the cap that keeps
    it inside its own message's visibility timeout. Carrying on without the
    permit would be worse still: that is the concurrency cap quietly exceeded.
    """
    add_test_channel(session, CHANNEL_ID, name=CHANNEL_NAME, user_id=user.id)
    assert try_claim_channel_sync(CHANNEL_ID, holder="somebody-else") is True

    async def run() -> tuple[str, bool]:
        partition = _direct_partition(1)
        worker = await partition.acquire()
        assert worker is not None
        slot = sync_queue.SyncSlot.holding(partition, worker)
        ch_state = ChannelSyncState(channel_id=CHANNEL_ID, channel_name=CHANNEL_NAME)
        job = SyncJobState(
            job_id="t12-slot-lost",
            source="test",
            channels={CHANNEL_ID: ch_state},
            user_id=str(user.id),
            sync_mode="individual",
        )

        async def hog() -> None:
            """Stands in for the drain loop, which sits on the partition's own
            `acquire()` and spends a freed worker on a fresh Channel
            immediately. Without something taking the worker, the waiter
            re-acquires its own instantly and the bound is never exercised —
            which is how this test passed against an unbounded re-acquire."""
            await partition.acquire()
            await asyncio.sleep(3600)

        competitor = asyncio.create_task(hog())
        try:
            claimed = await asyncio.wait_for(
                sync_orchestrator._claim_or_coalesce(job, ch_state, "mine", slot=slot),
                timeout=10,
            )
        finally:
            competitor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await competitor
        return ch_state.status, claimed

    original = sync_orchestrator.COALESCE_MAX_WAIT_SECONDS
    sync_orchestrator.COALESCE_MAX_WAIT_SECONDS = 1
    try:
        status, claimed = asyncio.run(run())
    finally:
        sync_orchestrator.COALESCE_MAX_WAIT_SECONDS = original

    assert claimed is False, "the waiter claimed the Channel with no permit in hand"
    assert status == "skipped"

    with Session(engine) as cleanup:
        cleanup.exec(delete(Channel).where(col(Channel.id) == CHANNEL_ID))
        cleanup.commit()
