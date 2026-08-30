"""Recording one channel's progress must not rewrite every channel's.

`_persist_job` serialises the whole channel map into `tg_sync_jobs.channels`, so
the cost of a flush is proportional to the *job*, not to what changed. Flushing
on every per-channel status transition therefore made a sync quadratic in its own
size — and a whole-table sync of 2,077 channels is the normal case here.

Measured on staging: **94,994 `UPDATE tg_sync_jobs SET channels=<json>` in 10
hours**, 7.5 minutes of database time and 270k block reads, for a row nothing
reads while the job is running.

## Asserted in both directions

Per `CLAUDE.md`, and following `client-split.conform.ts`: "flushes less" is also
what a broken flush does, so the durability half is pinned just as hard.

1. Progress inside the interval does **not** write.
2. Terminal states and job-level transitions **do**, immediately — the final
   state of a job is never left to a timer, which is the whole reason the row
   exists.
"""

from __future__ import annotations

import time
import uuid

import pytest

from app.core.config import settings
from app.services.scraper_jobs import (
    ChannelSyncState,
    SyncJobState,
    _mark_flushed,
    _should_flush_db,
)


def _job(channel_count: int = 3, status: str = "running") -> SyncJobState:
    job = SyncJobState(
        user_id=str(uuid.uuid4()), job_id="flush-cost", source="test", status=status
    )
    job.channels = {
        f"c{i}": ChannelSyncState(channel_id=f"c{i}", channel_name=f"c{i}")
        for i in range(channel_count)
    }
    _mark_flushed(job)
    return job


def test_a_channel_finishing_does_not_by_itself_write_the_row() -> None:
    """The defect, stated directly.

    Three channels reaching `success` inside one interval is three whole-array
    rewrites under the old rule and none under this one.
    """
    job = _job()

    for channel in job.channels.values():
        channel.status = "success"
        assert not _should_flush_db(job)


def test_progress_within_the_interval_does_not_write_either() -> None:
    job = _job()

    job.channels["c0"].posts_fetched = 250

    assert not _should_flush_db(job)


def test_the_interval_still_carries_progress_to_the_row() -> None:
    """The throttle is a delay, not a drop — this is what bounds how stale the
    crash-recovery snapshot can be."""
    job = _job()
    job.channels["c0"].status = "success"

    job._last_persist_at_ms = (
        time.monotonic() * 1000 - settings.SYNC_JOB_PERSIST_INTERVAL_MS - 1
    )

    assert _should_flush_db(job)


@pytest.mark.parametrize("terminal", ["completed", "failed", "cancelled"])
def test_a_terminal_job_writes_immediately(terminal: str) -> None:
    """The other direction. A job's last state is the one that has to survive a
    restart, so it must never wait on the interval."""
    job = _job()
    job.status = terminal

    assert _should_flush_db(job)


def test_a_job_level_transition_writes_immediately() -> None:
    """`pending` -> `running` happens once per job, so flushing on it is free and
    keeps a just-started job visible to a reader that missed the SSE stream."""
    job = _job(status="pending")
    job.status = "running"

    assert _should_flush_db(job)


def test_the_throttle_is_not_a_permanent_mute() -> None:
    """`return False` for every non-terminal case would pass all four tests
    above. The row would then only ever be written twice per job, and a crash
    mid-sync would lose every channel result."""
    job = _job()
    job._last_persist_at_ms = (
        time.monotonic() * 1000 - settings.SYNC_JOB_PERSIST_INTERVAL_MS - 1
    )

    assert _should_flush_db(job), "an elapsed interval must still write"
