"""The scheduler's consecutive-failure counter and the pause it arms.

`record_auto_sync_outcome` moved out of `run_auto_sync` when ticket 10 made the
scheduler enqueue, and no test followed it: the whole suite finished scheduler
jobs only through stubs that never reach `_finalize_if_complete`, so the counter
and the auto-pause had no coverage at all. (Not a tracing gap: `coverage.py`
follows `asyncio.to_thread` workers, and `scheduler._announce`, which only ever
runs there, is covered.)

The counter is global scheduler state, so these tests read it through the same
`load_sync_settings` facade the scheduler does.
"""

from __future__ import annotations

import asyncio
import time
import uuid

import pytest
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs import sync_queue
from app.jobs.auto_sync import CHECK_SOURCE, record_auto_sync_outcome
from app.jobs.settings import load_sync_settings, save_settings_section
from app.services.follows import count_followed_channels
from app.services.scraper_jobs import ChannelSyncState, SyncJobState
from tests.utils.setting_groups import upsert_sync_test_channel
from tests.utils.tenancy import ANY_READER


def _seed_counter(value: int) -> None:
    with Session(engine) as session:
        save_settings_section(
            session,
            "sync",
            {"consecutiveFailures": value, "autoSyncPauseUntil": None},
        )


def _counters() -> tuple[int, int | None]:
    with Session(engine) as session:
        cfg = load_sync_settings(session)
    return int(cfg.get("consecutiveFailures") or 0), cfg.get("autoSyncPauseUntil")


def _job(*statuses: str, source: str = CHECK_SOURCE) -> SyncJobState:
    job = SyncJobState(
        user_id=str(ANY_READER), job_id=f"outcome-{uuid.uuid4()}", source=source
    )
    for i, status in enumerate(statuses):
        job.channels[f"c{i}"] = ChannelSyncState(
            channel_id=f"c{i}", channel_name=f"c{i}", status=status
        )
    return job


@pytest.fixture(autouse=True)
def _high_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    """Out of reach unless a test lowers it, so counting never trips a pause."""
    monkeypatch.setattr(settings, "AUTO_SYNC_FAILURE_THRESHOLD_MIN", 10_000)


def test_each_failed_channel_adds_one_to_the_counter() -> None:
    """Counted per Channel, not per job, and a success in the same job does
    not reset it: a tick that lost two of three Channels is not a good tick."""
    _seed_counter(1)

    record_auto_sync_outcome(_job("failed", "success", "failed"))

    assert _counters() == (3, None)


def test_a_clean_job_resets_the_counter() -> None:
    _seed_counter(4)

    record_auto_sync_outcome(_job("success", "skipped"))

    assert _counters()[0] == 0


def test_a_job_with_no_verdict_leaves_the_counter_alone() -> None:
    """Skipped and cancelled Channels say nothing about Telegram's health.

    Two guards hold this today, the early return and the `elif successes`, so
    either one alone can go and this stays green. **Mutation:** drop the early
    return *and* widen the `elif` to `else`, and a tick of nothing but skips
    resets a counter that was one failure from pausing.
    """
    _seed_counter(5)

    record_auto_sync_outcome(_job("skipped", "cancelled"))

    assert _counters() == (5, None)


def test_the_pause_threshold_is_the_deployments_followed_channel_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The denominator is every Channel anybody follows, floored by the
    configured minimum.

    **Mutation:** use `AUTO_SYNC_FAILURE_THRESHOLD_MIN` alone as the threshold
    and the first failure below pauses the whole deployment.
    """
    with Session(engine) as session:
        for _ in range(3):
            upsert_sync_test_channel(
                session, channel_id=f"outcome-ch-{uuid.uuid4()}", user_id=ANY_READER
            )
        followed = count_followed_channels(session)
    assert followed >= 3
    monkeypatch.setattr(settings, "AUTO_SYNC_FAILURE_THRESHOLD_MIN", 1)
    _seed_counter(followed - 2)

    record_auto_sync_outcome(_job("failed"))
    assert _counters() == (followed - 1, None)

    before = int(time.time() * 1000)
    record_auto_sync_outcome(_job("failed"))
    count, pause_until = _counters()
    assert count == followed
    assert pause_until is not None
    assert (
        before + settings.AUTO_SYNC_PAUSE_DURATION_MS
        <= pause_until
        <= int(time.time() * 1000) + settings.AUTO_SYNC_PAUSE_DURATION_MS
    )


def test_the_configured_minimum_floors_a_small_deployment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With almost nothing followed, one bad tick must not pause everything."""
    with Session(engine) as session:
        followed = count_followed_channels(session)
    monkeypatch.setattr(settings, "AUTO_SYNC_FAILURE_THRESHOLD_MIN", followed + 5)
    _seed_counter(followed + 3)

    record_auto_sync_outcome(_job("failed"))
    assert _counters() == (followed + 4, None)

    record_auto_sync_outcome(_job("failed"))
    assert _counters()[1] is not None


@pytest.mark.parametrize(
    ("source", "expected"), [(CHECK_SOURCE, 1), ("Manual sync", 0)]
)
def test_only_a_scheduler_job_reaches_the_counter_when_it_finishes(
    source: str, expected: int
) -> None:
    """The wiring in `_finalize_if_complete`, which is the only caller.

    A manual sync failing is one person's Channel being unreachable; counting
    it would let somebody pause auto-sync for the deployment by clicking.
    """
    _seed_counter(0)
    job = _job("failed", source=source)
    job.status = "running"

    async def finish() -> None:
        await sync_queue._finalize_if_complete(job)

    asyncio.run(finish())

    assert job.status == "failed"
    assert _counters()[0] == expected
