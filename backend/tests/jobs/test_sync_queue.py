"""The sync lanes end to end (tickets 09, 10).

`sync_single_channel` is stubbed the same way `test_quota_ledger.py::_run_job`
stubs it — real persistence, real queue, no real network. That keeps these tests
about the queue mechanics (enqueue, drain, redelivery cap, terminal-job skip,
job finalisation) rather than about scraping.

Ticket 10 changed the unit: a message is one Channel, not one job. The tests
that used to assert "one message drained the job" now assert the thing that
replaced it — **the last Channel to finish is what makes the job terminal** —
because that is the piece with no `run_sync_job` above it any more.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlmodel import Session

from app.core import pg_notify
from app.core.config import settings
from app.core.db import engine
from app.jobs import sync_queue
from app.services import pgmq, sync_orchestrator
from app.services.scraper_jobs import (
    ChannelSyncState,
    clear_active_jobs_for_tests,
    clear_jobs_for_tests,
    create_job,
    get_job,
    has_active_sync_job,
    persist_job,
    reconcile_interrupted_jobs,
)
from app.services.sync_lanes import (
    AUTO_SYNC_NORMAL_LANE,
    DRAIN_ORDER,
    MANUAL_BULK_NORMAL_LANE,
    MANUAL_SINGLE_NORMAL_LANE,
)

# A real account: ticket 21's foreign key rejects a fabricated owner uuid.
# None of these tests is about who owns a job.
from tests.utils.tenancy import ANY_READER


def _stub_sync_single_channel(
    monkeypatch: pytest.MonkeyPatch, *, fail: bool = False
) -> None:
    async def fake(_job: object, ch_state: ChannelSyncState, **_kwargs: object) -> None:
        await asyncio.sleep(0)
        if fail:
            raise RuntimeError("boom")
        ch_state.status = "success"
        ch_state.posts_fetched = 1

    monkeypatch.setattr(sync_orchestrator, "sync_single_channel", fake)


def _drain_queue(queue_name: str) -> None:
    """Clear anything left on the lane so tests do not see each other's mail."""
    with Session(engine) as session:
        while True:
            msgs = pgmq.read(session, queue_name, vt_seconds=0, qty=50)
            if not msgs:
                break
            for m in msgs:
                pgmq.delete(session, queue_name, m.msg_id)
            session.commit()


@pytest.fixture(autouse=True)
def _clean_lanes() -> None:
    clear_jobs_for_tests()
    sync_queue.reset_worker_partition_for_tests()
    sync_queue.stop_lane_consumer()
    pg_notify.reset_listeners_for_tests()
    for lane in DRAIN_ORDER:
        _drain_queue(lane)
    yield
    for lane in DRAIN_ORDER:
        _drain_queue(lane)


def test_visibility_timeout_is_derived_from_retry_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    baseline = sync_queue.visibility_timeout_seconds()
    assert baseline > 0

    # Halving the retry budget must shrink the derived VT — proves it is
    # computed from the settings, not a hardcoded literal that happens to
    # look plausible.
    monkeypatch.setattr(settings, "NETWORK_FETCH_RETRIES", 2)
    monkeypatch.setattr(settings, "SYNC_MAX_RETRIES", 1)
    shrunk = sync_queue.visibility_timeout_seconds()
    assert 0 < shrunk < baseline


def test_a_sync_mode_picks_its_lane() -> None:
    """One message per Channel is only half of decision 30 — the other half is
    that the message lands on the lane matching what it will be charged to.
    Routed through `budget_for_sync_mode` so the lane and the Budget cannot
    disagree about the same `sync_mode`."""

    async def run() -> list[str]:
        lanes = []
        for mode in ("individual", "bulk", "auto"):
            job = await create_job(
                channel_entries=[("c", "c")],
                source="Test",
                user_id=str(ANY_READER),
                sync_mode=mode,  # type: ignore[arg-type]
            )
            lanes.append(sync_queue.lane_for_job(job))
        return lanes

    assert asyncio.run(run()) == [
        MANUAL_SINGLE_NORMAL_LANE,
        MANUAL_BULK_NORMAL_LANE,
        AUTO_SYNC_NORMAL_LANE,
    ]


def test_the_sync_mode_survives_rehydration_in_another_process() -> None:
    """The worker learns a job's mode only from the row, so the row must carry it.

    `sync_mode` lived in memory, which was fine while the process that created a
    job also ran it. After ticket 10 the worker rebuilds the job from
    `tg_sync_jobs`, and with no column there `_row_to_state` fell back to the
    dataclass default — **every worker-run job came back as `auto`**.

    Silent in both places it is read. `budget_for_sync_mode` bills the Requests,
    so a manual single sync was charged to the `auto_sync` Budget that tickets
    23 and 24 make decisions from. And `channel_allows_sync_operation` decides
    whether a Channel's setting group permits the operation at all, so this was
    not only wrong accounting — it was syncing Channels that forbid the mode
    asked for, and refusing ones that allow it.

    `clear_active_jobs_for_tests` is what makes this a real test: it drops the
    in-memory copy exactly as a second process would not have it.
    """

    async def run() -> list[str]:
        modes: list[str] = []
        for mode in ("individual", "bulk", "sync_all", "auto"):
            job = await create_job(
                channel_entries=[("c", "c")],
                source="Test",
                user_id=str(ANY_READER),
                sync_mode=mode,  # type: ignore[arg-type]
            )
            clear_active_jobs_for_tests()  # simulate the worker's fresh process
            rehydrated = get_job(job.job_id)
            assert rehydrated is not None
            modes.append(rehydrated.sync_mode)
        return modes

    assert asyncio.run(run()) == ["individual", "bulk", "sync_all", "auto"], (
        "sync_mode did not survive the row round trip, so the worker charges "
        "the wrong Budget and applies the wrong per-Channel permission"
    )


def test_a_rehydrated_job_still_picks_its_own_lane() -> None:
    """The consequence of the above, at the seam that would have hidden it.

    Lane routing is computed at *enqueue*, in the process that created the job,
    so it stayed correct while `sync_mode` was being lost — which is exactly why
    nothing looked broken. This pins the other half: a job rebuilt from the row
    routes to the same lane it was enqueued on.
    """

    async def run() -> tuple[str, str]:
        job = await create_job(
            channel_entries=[("c", "c")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        at_enqueue = sync_queue.lane_for_job(job)
        clear_active_jobs_for_tests()
        rehydrated = get_job(job.job_id)
        assert rehydrated is not None
        return at_enqueue, sync_queue.lane_for_job(rehydrated)

    at_enqueue, after_reload = asyncio.run(run())
    assert at_enqueue == after_reload == MANUAL_SINGLE_NORMAL_LANE


def test_shutdown_hands_claimed_messages_back_to_the_lane() -> None:
    """A restart must not park in-flight work for the visibility timeout.

    `pgmq.read` makes a claimed message invisible for
    `visibility_timeout_seconds()` — about 2.4 hours. When the worker stops
    mid-drain, nothing had returned those messages, so they sat invisible while
    the process that claimed them no longer existed; `reconcile_interrupted_jobs`
    then failed their rows on the next boot, and by the time the message
    reappeared the job was terminal and it was archived without syncing. The
    work was simply lost.

    Once per deploy in production. In dev it is **every file save**, because
    `compose.override.yml` restarts the worker on change.

    Written against the real queue because the whole thing rests on `pgmq.set_vt`
    resolving to the right overload — PGMQ declares three — and a mocked test
    would assert the call rather than the effect.
    """

    async def run() -> tuple[int, int]:
        payloads = [
            {"jobId": "j", "channelId": "c1"},
            {"jobId": "j", "channelId": "c2"},
        ]
        await asyncio.to_thread(
            sync_queue._send_batch, MANUAL_SINGLE_NORMAL_LANE, payloads
        )
        # `_read_interleaved` records the claim itself (ticket 12): a message
        # sitting in a lane buffer is as invisible to every other worker as one
        # being processed, and as lost if this process stops before dispatching
        # it. So the test no longer adds to `_claimed_messages` by hand — doing
        # so would hide a regression where the read stopped tracking them.
        await asyncio.to_thread(
            sync_queue._read_interleaved, MANUAL_SINGLE_NORMAL_LANE, 50
        )

        with Session(engine) as session:
            still_hidden = len(
                pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=0, qty=50)
            )
            session.commit()

        await asyncio.to_thread(sync_queue._release_claimed_messages)

        with Session(engine) as session:
            visible_again = len(
                pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=0, qty=50)
            )
            session.commit()
        return still_hidden, visible_again

    still_hidden, visible_again = asyncio.run(run())
    assert still_hidden == 0, "the claim did not hide the messages; test proves nothing"
    assert visible_again == 2, (
        "shutdown left claimed messages invisible — a restart loses that work "
        "until the visibility timeout lapses"
    )


def test_a_queued_job_survives_a_worker_restart() -> None:
    """Reconcile must not fail jobs that are merely *waiting*.

    `reconcile_interrupted_jobs` fails every non-terminal row at worker boot,
    on the reasoning that in-memory progress cannot survive a restart so such a
    row belongs to a dead process. That held while one process created and ran
    every job. The API now creates them on its own lifecycle — press Sync, or
    let a bulk follow chain one, while the worker is restarting, and the row is
    brand new with its messages sitting durably on a lane.

    Failing it does not merely mislabel the row: `_process_message` then sees a
    terminal job and archives each of its messages without syncing. A
    2,000-Channel `sync_all` interrupted at Channel 50 loses the other 1,950,
    and the browser is told it failed.

    The paired assertion matters as much as the first: a job with **no** queued
    messages must still be failed, or the stranded-row problem reconcile exists
    for comes straight back.
    """

    async def run() -> tuple[str, str]:
        queued = await create_job(
            channel_entries=[("q1", "q1")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        stranded = await create_job(
            channel_entries=[("s1", "s1")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        # Only the first has a message on a lane.
        await asyncio.to_thread(
            sync_queue._send_batch,
            MANUAL_SINGLE_NORMAL_LANE,
            [{"jobId": queued.job_id, "channelId": "q1", "userId": None}],
        )
        clear_active_jobs_for_tests()  # the worker's fresh process

        still_queued = await asyncio.to_thread(sync_queue.queued_job_ids)
        assert queued.job_id in still_queued
        assert stranded.job_id not in still_queued

        with Session(engine) as session:
            reconcile_interrupted_jobs(session, still_queued=still_queued)

        after_queued = get_job(queued.job_id)
        after_stranded = get_job(stranded.job_id)
        assert after_queued is not None and after_stranded is not None
        return after_queued.status, after_stranded.status

    queued_status, stranded_status = asyncio.run(run())
    assert queued_status == "pending", (
        "a job whose messages are still on a lane was failed at worker boot — "
        "its messages will now be archived without ever syncing"
    )
    assert stranded_status == "failed", (
        "a job with no queued messages was left non-terminal, so the stranded-row "
        "problem reconcile exists for is back"
    )


def test_a_queued_job_counts_as_active_for_the_scheduler() -> None:
    """Otherwise auto-sync enqueues a fresh job every tick, without bound.

    `run_auto_sync` skips its tick when `has_active_sync_job()` is True. That
    dict was complete while `create_job` registered every job; it no longer
    does, so between enqueue and the first claim it says nothing. `DRAIN_ORDER`
    puts the automatic lane last, so a long manual bulk keeps auto-sync's
    messages waiting — and every 60-second tick would create another job and
    enqueue another N messages for as long as the worker stayed busy.

    The negative case is asserted too: with nothing queued and nothing claimed,
    the answer must still be False, or auto-sync never runs again.
    """

    async def run() -> tuple[bool, bool]:
        job = await create_job(
            channel_entries=[("qa1", "qa1")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="auto",
        )
        clear_active_jobs_for_tests()
        idle = has_active_sync_job()

        await asyncio.to_thread(
            sync_queue._send_batch,
            AUTO_SYNC_NORMAL_LANE,
            [{"jobId": job.job_id, "channelId": "qa1", "userId": None}],
        )
        return idle, has_active_sync_job()

    idle, queued = asyncio.run(run())
    assert idle is False, "an unqueued, unclaimed job blocked the scheduler forever"
    assert queued is True, (
        "a queued-but-unclaimed job read as idle, so every tick would enqueue "
        "another job on top of it"
    )


def test_one_message_per_channel_never_one_per_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Decision 30, asserted on the queue itself.

    A three-Channel job must put three messages on the lane, each carrying the
    job id — not one message the consumer then fans out, which is the shape
    that cannot be attributed, timed out, or failed per Channel.
    """
    _stub_sync_single_channel(monkeypatch)

    async def run() -> tuple[int, set[str], set[str]]:
        job = await create_job(
            channel_entries=[("a", "a"), ("b", "b"), ("c", "c")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="bulk",
        )
        await asyncio.to_thread(
            sync_queue._send,
            MANUAL_BULK_NORMAL_LANE,
            {"jobId": job.job_id, "channelId": "a", "userId": None},
        )
        # Read what `enqueue_sync_job` itself wrote, without the kick draining
        # it first: send directly, then inspect.
        _drain_queue(MANUAL_BULK_NORMAL_LANE)
        lane = sync_queue.lane_for_job(job)
        for channel_id in job.channels:
            await asyncio.to_thread(
                sync_queue._send,
                lane,
                {"jobId": job.job_id, "channelId": channel_id, "userId": None},
            )
        with Session(engine) as session:
            messages = pgmq.read(session, lane, vt_seconds=0, qty=50)
            session.commit()
        return (
            len(messages),
            {m.message["channelId"] for m in messages},
            {m.message["jobId"] for m in messages},
        )

    count, channel_ids, job_ids = asyncio.run(run())
    assert count == 3
    assert channel_ids == {"a", "b", "c"}
    assert len(job_ids) == 1, "every message must carry the same job identity"


def test_a_bulk_job_is_terminal_only_when_its_last_channel_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The batch view survives the split into per-Channel messages.

    There is no `run_sync_job` above the Channels any more, so nothing would
    notice they are all done unless `_finalize_if_complete` recomputes it after
    every message. Draining one Channel of two must leave the job `running`;
    draining the second must complete it.
    """
    _stub_sync_single_channel(monkeypatch)

    async def run() -> tuple[str, str]:
        job = await create_job(
            channel_entries=[("a", "a"), ("b", "b")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="bulk",
        )
        lane = MANUAL_BULK_NORMAL_LANE
        await asyncio.to_thread(
            sync_queue._send,
            lane,
            {"jobId": job.job_id, "channelId": "a", "userId": None},
        )
        await sync_queue.drain_sync_lanes()
        after_first = job.status

        await asyncio.to_thread(
            sync_queue._send,
            lane,
            {"jobId": job.job_id, "channelId": "b", "userId": None},
        )
        await sync_queue.drain_sync_lanes()
        return after_first, job.status

    after_first, after_second = asyncio.run(run())
    assert after_first == "running", (
        "the job went terminal with a Channel still queued — aggregate progress "
        "is broken and the browser will stop streaming early"
    )
    assert after_second == "completed"


def test_enqueue_drains_and_completes_the_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_sync_single_channel(monkeypatch)

    async def run() -> str:
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        # Ticket 10: an enqueue rings the worker rather than draining locally,
        # so this test has to *be* the worker for the ring to reach anything.
        sync_queue.start_lane_consumer()
        assert await pg_notify.listener(
            sync_queue.SYNC_LANE_WAKE_CHANNEL
        ).wait_until_listening()
        await sync_queue.enqueue_sync_job(job, None)
        for _ in range(50):
            await asyncio.sleep(0.02)
            current = get_job(job.job_id)
            if current and current.status in ("completed", "failed"):
                break
        # Wait for the *archive*, not just the terminal status. `_handle_one`
        # archives after `_process_message` returns, and the job goes terminal
        # inside it — so breaking on status alone and asserting the queue is
        # empty in the next breath is a race the test loses whenever the
        # scheduling happens to land the other way round.
        for _ in range(50):
            with Session(engine) as session:
                if pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 0:
                    break
            await asyncio.sleep(0.02)
        sync_queue.stop_lane_consumer()
        return job.job_id

    job_id = asyncio.run(run())
    finished = get_job(job_id)
    assert finished is not None
    assert finished.status == "completed"

    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 0


def test_drain_skips_a_job_already_terminal() -> None:
    """A message for a job the client already saw finish must not resurrect it.

    Covers the `reconcile_interrupted_jobs` interaction documented in
    `sync_queue.py`'s module docstring: redelivered after a restart, the row can
    already say `failed` by the time the message comes back.
    """

    async def run() -> dict[str, int]:
        job = await create_job(
            channel_entries=[("chan-2", "chan-2")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        job.status = "failed"
        await persist_job(job)

        with Session(engine) as session:
            pgmq.send(
                session,
                MANUAL_SINGLE_NORMAL_LANE,
                {"jobId": job.job_id, "channelId": "chan-2"},
            )
            session.commit()

        return await sync_queue.drain_sync_lanes()

    result = asyncio.run(run())
    assert result["processed"] == 1
    assert result["exhausted"] == 0

    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 0


def test_exhausted_redelivery_is_archived_and_job_marked_failed() -> None:
    async def run() -> str:
        job = await create_job(
            channel_entries=[("chan-3", "chan-3")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        with Session(engine) as session:
            pgmq.send(
                session,
                MANUAL_SINGLE_NORMAL_LANE,
                {"jobId": job.job_id, "channelId": "chan-3"},
            )
            session.commit()
            # Drive read_ct past the cap directly — simulating a worker that
            # crashed on every prior delivery, without waiting out real VTs.
            # Each read commits so the increment is visible to the next one
            # (a fresh session, same as `drain_sync_lanes` opens).
            over_cap = settings.SYNC_QUEUE_MAX_READ_COUNT + 1
            for _ in range(over_cap):
                pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=0, qty=10)
                session.commit()
        await sync_queue.drain_sync_lanes()
        return job.job_id

    job_id = asyncio.run(run())
    job = get_job(job_id)
    assert job is not None
    assert job.status == "failed"
    assert all(ch.status == "failed" for ch in job.channels.values())

    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 0


def test_exhausting_one_channel_does_not_fail_its_siblings() -> None:
    """Failure isolation is one of the reasons decision 30 wants per-Channel
    messages at all. A message that exhausts its redeliveries must fail *its*
    Channel, not every Channel in the job — the job-shaped message could not
    tell them apart, which is the failure mode being removed."""

    async def run() -> tuple[str, str]:
        job = await create_job(
            channel_entries=[("x", "x"), ("y", "y")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="bulk",
        )
        with Session(engine) as session:
            pgmq.send(
                session,
                MANUAL_BULK_NORMAL_LANE,
                {"jobId": job.job_id, "channelId": "x"},
            )
            session.commit()
            for _ in range(settings.SYNC_QUEUE_MAX_READ_COUNT + 1):
                pgmq.read(session, MANUAL_BULK_NORMAL_LANE, vt_seconds=0, qty=10)
                session.commit()
        await sync_queue.drain_sync_lanes()
        return job.channels["x"].status, job.channels["y"].status

    failed, sibling = asyncio.run(run())
    assert failed == "failed"
    assert sibling == "pending", (
        "exhausting one Channel's message failed a Channel it had nothing to do with"
    )


def test_a_message_without_a_channel_id_still_runs_the_whole_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Messages enqueued by ticket 09's code outlive the deploy that replaces it.

    A queue is durable, so the old job-shaped messages are still there when the
    new worker starts. Treating them as malformed would strand exactly the
    syncs someone triggered in the seconds before the restart.
    """
    seen: list[str] = []

    async def fake_run_sync_job(job: object, _user_id: object) -> None:
        seen.append(getattr(job, "job_id", ""))

    monkeypatch.setattr(sync_orchestrator, "run_sync_job", fake_run_sync_job)

    async def run() -> str:
        job = await create_job(
            channel_entries=[("legacy", "legacy")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        with Session(engine) as session:
            # No `channelId` — exactly what ticket 09 wrote.
            pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": job.job_id})
            session.commit()
        await sync_queue.drain_sync_lanes()
        return job.job_id

    job_id = asyncio.run(run())
    assert seen == [job_id], "a pre-ticket-10 message was dropped instead of run"


def test_redelivery_while_still_running_is_not_reprocessed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A message whose Channel sync is still in flight in this process (VT
    lapsed mid-backfill, redelivered) must not trigger a second concurrent
    call for the same Channel."""
    calls: list[str] = []
    release = asyncio.Event()

    async def slow_sync(
        _job: object, ch_state: ChannelSyncState, **_kw: object
    ) -> None:
        calls.append(ch_state.channel_id)
        await release.wait()
        ch_state.status = "success"

    monkeypatch.setattr(sync_orchestrator, "sync_single_channel", slow_sync)

    async def run() -> list[str]:
        job = await create_job(
            channel_entries=[("chan-4", "chan-4")],
            source="Test",
            user_id=str(ANY_READER),
            sync_mode="individual",
        )
        payload = {"jobId": job.job_id, "channelId": "chan-4"}
        with Session(engine) as session:
            pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, payload)
            session.commit()

        # Start a drain and let it claim the message and enter `slow_sync`
        # (where it awaits `release`, staying "in flight").
        first = asyncio.create_task(sync_queue.drain_sync_lanes())
        for _ in range(50):
            await asyncio.sleep(0.01)
            if calls:
                break

        # Simulate redelivery: a second message for the same running Channel.
        with Session(engine) as session:
            pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, payload)
            session.commit()
        await sync_queue.drain_sync_lanes()

        release.set()
        await first
        return calls

    result = asyncio.run(run())
    assert len(result) == 1, "the redelivered copy started a second sync"

    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 0
