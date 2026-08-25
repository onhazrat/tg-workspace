"""A stream in one process sees a sync running in another (ticket 10).

This is step 1 of `docs/scaling-to-multiple-workers.md`, and the thing it has to
prove is awkward to test because **the broken version does not fail**. Once the
sync moves to the worker, `sync_job_events` keeps working either way — it calls
`get_job`, `get_job` falls back to the `tg_sync_jobs` row, and the stream serves
whatever the row happened to hold. The regression is invisible unless a test
pins the *freshness*.

So every test here separates the two sources deliberately: the notification says
one thing, the row still says another, and the assertion is about which one the
watcher serves. A `get_job` that had quietly gone back to reading the row would
pass a "progress reaches the browser" test and fail these.
"""

from __future__ import annotations

import asyncio
import uuid

from sqlmodel import Session

from app.core import pg_notify
from app.core.db import engine
from app.models_tg import SyncJob as SyncJobRow
from app.services import scraper_jobs
from app.services.scraper_jobs import (
    SYNC_JOB_PROGRESS_CHANNEL,
    clear_jobs_for_tests,
    create_job,
    get_job,
)


async def _await_channel_status(
    job_id: str, channel_id: str, wanted: str, timeout_s: float = 5.0
) -> str:
    """Poll the watcher's view until the notification lands, or give up."""
    deadline = asyncio.get_running_loop().time() + timeout_s
    seen = ""
    while asyncio.get_running_loop().time() < deadline:
        job = get_job(job_id)
        if job is not None and channel_id in job.channels:
            seen = job.channels[channel_id].status
            if seen == wanted:
                return seen
        await asyncio.sleep(0.02)
    return seen


def _row_channel_status(job_id: str, channel_id: str) -> str:
    with Session(engine) as session:
        row = session.get(SyncJobRow, job_id)
        assert row is not None
        for entry in row.channels:
            if entry["channelId"] == channel_id:
                return str(entry["status"])
    raise AssertionError(f"{channel_id} missing from the row")


def test_a_watcher_sees_progress_the_row_does_not_have_yet() -> None:
    """The whole point of the ticket, in one assertion.

    The job is created (so the row exists, with the Channel `pending`), then
    this process forgets it is running it — which is exactly the situation of an
    API process serving a stream for a sync happening in the worker. The
    "worker" then publishes a `success` **without writing the row**. A watcher
    reading the row would still say `pending`; a watcher fed by notifications
    says `success`. The final assertion checks the row really did stay behind,
    so this cannot pass by accidentally flushing.
    """

    async def run() -> tuple[str, str]:
        clear_jobs_for_tests()
        pg_notify.reset_listeners_for_tests()
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        # No `_active_jobs.clear()` here, deliberately. `create_job` does not
        # claim the job, so this process is already a watcher — which is the
        # actual API-process situation. The earlier version of this test
        # cleared the registry by hand and so passed while `create_job` was
        # claiming every job it created, hiding the bug it existed to catch.
        scraper_jobs.start_progress_subscriber()
        assert await pg_notify.listener(
            SYNC_JOB_PROGRESS_CHANNEL
        ).wait_until_listening(), "listener never connected"

        # Seed the mirror the way opening a stream does.
        assert get_job(job.job_id) is not None

        await asyncio.to_thread(
            pg_notify.publish,
            SYNC_JOB_PROGRESS_CHANNEL,
            {
                "jobId": job.job_id,
                "jobStatus": "running",
                "finishedAt": None,
                "channel": {
                    "channelId": "chan-1",
                    "channelName": "chan-1",
                    "status": "success",
                    "postsFetched": 7,
                    "newLatestId": 99,
                    "error": None,
                    "metadata": {},
                },
            },
        )
        try:
            watched = await _await_channel_status(job.job_id, "chan-1", "success")
        finally:
            scraper_jobs.stop_progress_subscriber()
            pg_notify.reset_listeners_for_tests()
        return watched, _row_channel_status(job.job_id, "chan-1")

    watched, in_row = asyncio.run(run())
    assert watched == "success", "the watcher never saw the notification"
    assert in_row == "pending", (
        "the row was written too, so this test would also pass with no "
        "notifications at all — it proves nothing in that state"
    )


def test_creating_a_job_does_not_claim_it() -> None:
    """The bug that made every other test here a lie, until review found it.

    `create_job` runs wherever the request landed — `POST /jobs/sync` is the API
    process — and after ticket 10 that is almost never the process that will run
    the sync. While it wrote to `_active_jobs`, the API believed it owned every
    job it created, so `get_job` served its own stale object forever and
    `apply_progress_event` discarded the worker's deltas as its own echo. The
    stream sat at `pending` and never sent `[DONE]`.

    Nothing about that shows up as an error, and the earlier tests here hid it
    by clearing `_active_jobs` by hand. This asserts the seam directly:
    ownership is `claim_job`'s to grant, and creation does not grant it.
    """

    async def run() -> tuple[bool, bool, bool]:
        clear_jobs_for_tests()
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        created_unclaimed = job.job_id not in scraper_jobs._active_jobs
        # A progress update from elsewhere must not claim it either.
        await scraper_jobs.touch_job(job)
        still_unclaimed = job.job_id not in scraper_jobs._active_jobs
        scraper_jobs.claim_job(job)
        claimed = job.job_id in scraper_jobs._active_jobs
        return created_unclaimed, still_unclaimed, claimed

    created_unclaimed, still_unclaimed, claimed = asyncio.run(run())
    assert created_unclaimed, "creating a job claimed it as running in this process"
    assert still_unclaimed, (
        "a progress update claimed a job this process is not running"
    )
    assert claimed, "claim_job did not claim the job"


def test_an_unclaimed_job_still_takes_progress_from_elsewhere() -> None:
    """The other half of the same seam.

    Not claiming must not mean not tracking: the API process still has to serve
    `GET /jobs/sync/{id}` and its stream for the job it just created, from the
    first request, before any row re-read is due.
    """

    async def run() -> str:
        clear_jobs_for_tests()
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        await scraper_jobs.apply_progress_event(
            {
                "jobId": job.job_id,
                "jobStatus": "running",
                "channel": {
                    "channelId": "chan-1",
                    "channelName": "chan-1",
                    "status": "success",
                    "postsFetched": 3,
                    "newLatestId": None,
                    "error": None,
                    "metadata": {},
                },
            }
        )
        seen = get_job(job.job_id)
        assert seen is not None
        return seen.channels["chan-1"].status

    assert asyncio.run(run()) == "success", (
        "the creating process dropped a delta for a job it is watching"
    )


def test_a_terminal_status_from_elsewhere_reaches_the_watcher() -> None:
    """What makes the stream end rather than hang.

    `sync_job_events` loops until the snapshot it reads is terminal, and only
    then sends `data: [DONE]`. Every other test here proves *progress* crosses
    the split; this one proves the end does. If a terminal notification were
    dropped — or arrived without `finishedAt` — the browser would keep an open
    connection to a sync that finished, which is the failure that looks like
    "the spinner never stops" and reads as a frontend bug.

    Deliberately checked through `get_job`, the same call the stream makes,
    rather than by inspecting the mirror directly.
    """

    async def run() -> tuple[str, int | None]:
        clear_jobs_for_tests()
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        assert get_job(job.job_id) is not None  # seed the mirror
        await scraper_jobs.apply_progress_event(
            {
                "jobId": job.job_id,
                "jobStatus": "completed",
                "finishedAt": 1_700_000_000_000,
                "channel": {
                    "channelId": "chan-1",
                    "channelName": "chan-1",
                    "status": "success",
                    "postsFetched": 2,
                    "newLatestId": 11,
                    "error": None,
                    "metadata": {},
                },
            }
        )
        seen = get_job(job.job_id)
        assert seen is not None
        return seen.status, seen.finished_at

    status, finished_at = asyncio.run(run())
    assert status == "completed", "the stream would never send [DONE]"
    assert finished_at == 1_700_000_000_000, (
        "finishedAt did not cross, so the job renders as finished with no end time"
    )


def test_a_row_reread_cannot_walk_a_channel_backwards() -> None:
    """The mirror is fed by two sources that disagree about *when*.

    Notifications are immediate; the row lags by up to
    `SYNC_JOB_PERSIST_INTERVAL_MS`. So a refresh that trusted the row blindly
    would take a Channel the watcher already saw finish and put it back to
    `pending` — a progress bar running backwards, caused by nothing being wrong.
    """

    async def run() -> str:
        clear_jobs_for_tests()
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        mirror = get_job(job.job_id)
        assert mirror is not None
        # As if a notification had arrived ahead of the row.
        mirror.channels["chan-1"].status = "success"
        # Force the next read to go to the row, which still says `pending`.
        mirror._mirror_synced_at_ms = 0.0
        mirror._mirror_notified_at_ms = 0.0
        refreshed = get_job(job.job_id)
        assert refreshed is not None
        return refreshed.channels["chan-1"].status

    assert asyncio.run(run()) == "success"


def test_a_cancel_reaches_the_process_actually_running_the_sync() -> None:
    """Cancellation crosses the split in the opposite direction.

    `POST /jobs/sync/{id}/cancel` runs in the API process and sets an
    `asyncio.Event` that the sync polls — an object that, after ticket 10, lives
    in a different process from the loop reading it. Without this path the
    endpoint writes `cancelled` to a row the worker never re-reads and the sync
    runs happily to completion, answering 200 the whole time.
    """

    async def run() -> bool:
        clear_jobs_for_tests()
        pg_notify.reset_listeners_for_tests()
        job = await create_job(
            channel_entries=[("chan-1", "chan-1")],
            source="Test",
            user_id=str(uuid.uuid4()),
            sync_mode="individual",
        )
        # This process *is* the runner — which after ticket 10 means it said
        # so, via `claim_job`. Creating the job is not enough.
        scraper_jobs.claim_job(job)
        scraper_jobs.start_progress_subscriber()
        assert await pg_notify.listener(
            SYNC_JOB_PROGRESS_CHANNEL
        ).wait_until_listening()

        await asyncio.to_thread(
            pg_notify.publish,
            SYNC_JOB_PROGRESS_CHANNEL,
            {"jobId": job.job_id, "jobStatus": "cancelled", "finishedAt": 1},
        )
        try:
            deadline = asyncio.get_running_loop().time() + 5.0
            while asyncio.get_running_loop().time() < deadline:
                if job.cancel_event.is_set():
                    return True
                await asyncio.sleep(0.02)
            return False
        finally:
            scraper_jobs.stop_progress_subscriber()
            pg_notify.reset_listeners_for_tests()

    assert asyncio.run(run()), "the running job never saw the cancellation"


def test_a_notification_for_an_unwatched_job_is_dropped() -> None:
    """Every process hears every job's progress — one channel, no filtering in
    Postgres. Materialising a mirror on arrival would mean each process
    accumulating state for every sync in the deployment, so a job nobody here is
    watching must leave no trace."""

    async def run() -> int:
        clear_jobs_for_tests()
        await scraper_jobs.apply_progress_event(
            {"jobId": str(uuid.uuid4()), "jobStatus": "running"}
        )
        return len(scraper_jobs._mirrored_jobs)

    assert asyncio.run(run()) == 0
