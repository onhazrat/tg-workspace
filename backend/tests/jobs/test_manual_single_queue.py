"""The manual_single_normal lane end to end (ticket 09).

`sync_single_channel` is stubbed the same way `test_quota_ledger.py::_run_job`
stubs it — real `run_sync_job`, real job persistence, no real network. That
keeps these tests about the queue mechanics (enqueue, drain, redelivery cap,
terminal-job skip), which is what ticket 09 is.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs import manual_single_queue
from app.services import pgmq, sync_orchestrator
from app.services.scraper_jobs import (
    ChannelSyncState,
    SyncJobState,
    clear_jobs_for_tests,
    create_job,
    get_job,
    persist_job,
)
from app.services.sync_lanes import MANUAL_SINGLE_NORMAL_LANE


async def _noop(*_args: object, **_kwargs: object) -> None:
    return None


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
def _clean_lane() -> None:
    clear_jobs_for_tests()
    _drain_queue(MANUAL_SINGLE_NORMAL_LANE)
    yield
    _drain_queue(MANUAL_SINGLE_NORMAL_LANE)


def test_visibility_timeout_is_derived_from_retry_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    baseline = manual_single_queue.visibility_timeout_seconds()
    assert baseline > 0

    # Halving the retry budget must shrink the derived VT — proves it is
    # computed from the settings, not a hardcoded literal that happens to
    # look plausible.
    monkeypatch.setattr(settings, "NETWORK_FETCH_RETRIES", 2)
    monkeypatch.setattr(settings, "SYNC_MAX_RETRIES", 1)
    shrunk = manual_single_queue.visibility_timeout_seconds()
    assert 0 < shrunk < baseline


def test_enqueue_drains_and_completes_the_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_sync_single_channel(monkeypatch)
    monkeypatch.setattr(sync_orchestrator, "touch_job", _noop)

    async def run() -> None:
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        await manual_single_queue.enqueue_manual_single_sync(job.job_id, None)
        # The post-enqueue kick is fire-and-forget; give it a turn to run.
        for _ in range(50):
            await asyncio.sleep(0.02)
            current = get_job(job.job_id)
            if current and current.status in ("completed", "failed"):
                break
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
    `manual_single_queue.py`'s module docstring: redelivered after a restart,
    the row can already say `failed` by the time the message comes back.
    """

    async def run() -> dict[str, int]:
        job = await create_job(
            channel_entries=[("chan-2", "chan-2")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        job.status = "failed"
        await persist_job(job)

        with Session(engine) as session:
            pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": job.job_id})
            session.commit()

        return await manual_single_queue.drain_manual_single_lane()

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
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        with Session(engine) as session:
            pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": job.job_id})
            session.commit()
            # Drive read_ct past the cap directly — simulating a worker that
            # crashed on every prior delivery, without waiting out real VTs.
            # Each read commits so the increment is visible to the next one
            # (a fresh session, same as `drain_manual_single_lane` opens).
            over_cap = settings.MANUAL_SINGLE_QUEUE_MAX_READ_COUNT + 1
            for _ in range(over_cap):
                pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=0, qty=10)
                session.commit()
        await manual_single_queue.drain_manual_single_lane()
        return job.job_id

    job_id = asyncio.run(run())
    job = get_job(job_id)
    assert job is not None
    assert job.status == "failed"
    assert all(ch.status == "failed" for ch in job.channels.values())

    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 0


def test_redelivery_while_still_running_is_not_reprocessed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A message for a job whose `run_sync_job` call is still in flight in
    this process (VT lapsed mid-backfill, redelivered) must not trigger a
    second concurrent call on the same job — the race code review caught.
    """
    calls: list[str] = []
    release = asyncio.Event()

    async def slow_run_sync_job(job: SyncJobState, _user_id: object) -> None:
        calls.append(job.job_id)
        await release.wait()

    monkeypatch.setattr(manual_single_queue, "run_sync_job", slow_run_sync_job)

    async def run() -> list[str]:
        job = await create_job(
            channel_entries=[("chan-4", "chan-4")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        with Session(engine) as session:
            pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": job.job_id})
            session.commit()

        # Start a drain and let it claim the message and enter
        # `slow_run_sync_job` (where it awaits `release`, staying "in flight").
        first = asyncio.create_task(manual_single_queue.drain_manual_single_lane())
        for _ in range(50):
            await asyncio.sleep(0.01)
            if job.job_id in calls:
                break

        # Simulate redelivery: a second message for the same still-running job.
        with Session(engine) as session:
            pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": job.job_id})
            session.commit()
        await manual_single_queue.drain_manual_single_lane()

        release.set()
        await first
        return calls

    result = asyncio.run(run())
    # `slow_run_sync_job` must have been entered exactly once for this job —
    # the redelivered copy was archived without a second call.
    assert len(result) == 1

    with Session(engine) as session:
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == 0
