"""How a tick picks its partial-history Channels and merges them with due ones.

`test_scheduler_jobs.py` proves a partial Channel is picked at all. Nothing
pinned *which* one when there are more candidates than the batch takes, or where
the cursor lands afterwards, so a rotation that stopped rotating — the same
Channel every tick, the rest never backfilled — would pass the suite. These
drive the real tick against stored settings and read the cursor back.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session

from app.core.db import engine
from app.jobs.auto_sync import run_auto_sync
from app.jobs.settings import load_sync_settings, save_settings_section
from app.services.follows import get_operator_user_id
from app.services.scraper_jobs import clear_active_jobs_for_tests
from tests.utils.setting_groups import (
    freeze_channels_except,
    upsert_sync_test_channel,
)
from tests.utils.tenancy import ANY_READER

PARTIAL = ["part-a", "part-b", "part-c"]


@pytest.fixture(autouse=True)
def _no_leftover_active_job() -> Any:
    clear_active_jobs_for_tests()
    yield
    clear_active_jobs_for_tests()


def _seed() -> None:
    now = int(time.time() * 1000)
    with Session(engine) as session:
        owner = get_operator_user_id(session) or ANY_READER
        group = {
            "regular_sync_enabled": True,
            "dynamic_sync_enabled": False,
            "is_frozen": False,
        }
        upsert_sync_test_channel(
            session,
            channel_id="due-ch",
            user_id=owner,
            group_fields=group,
            channel_fields={
                "next_regular_sync_at": now - 1_000,
                "history_complete_to_cutoff": False,
            },
        )
        for channel_id in PARTIAL:
            upsert_sync_test_channel(
                session,
                channel_id=channel_id,
                user_id=owner,
                group_fields=group,
                channel_fields={
                    "next_regular_sync_at": now + 3_600_000,
                    "history_complete_to_cutoff": False,
                },
            )
        freeze_channels_except(session, {"due-ch", *PARTIAL})


def _set_rotation(cursor: int, batch_size: int) -> None:
    with Session(engine) as session:
        save_settings_section(
            session,
            "sync",
            {
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
                "autoSyncPartialCursor": cursor,
                "autoSyncPartialBatchSize": batch_size,
            },
        )


def _tick() -> tuple[dict[str, Any], list[str], int]:
    """One tick with the enqueue stubbed. Returns (result, names, cursor)."""
    job = MagicMock(job_id="job-planning", status="queued")
    with (
        patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock) as create,
        patch("app.jobs.auto_sync.enqueue_sync_job", new_callable=AsyncMock),
    ):
        create.return_value = job
        result = asyncio.run(run_auto_sync())
    clear_active_jobs_for_tests()
    names = [name for _id, name in create.await_args.kwargs["channel_entries"]]
    with Session(engine) as session:
        cursor = int(load_sync_settings(session)["autoSyncPartialCursor"])
    return result, names, cursor


def test_the_partial_batch_rotates_across_ticks_and_wraps() -> None:
    _seed()
    _set_rotation(cursor=2, batch_size=2)

    result, names, cursor = _tick()
    # Due first, then the batch from index 2 of the id-sorted candidates,
    # wrapping to index 0.
    assert names == ["due-ch", "part-c", "part-a"]
    assert cursor == 4
    assert result["dueChannels"] == 1
    assert result["partialChannels"] == 2

    _result, names, cursor = _tick()
    assert names == ["due-ch", "part-b", "part-c"]
    assert cursor == 6


def test_a_batch_larger_than_the_candidates_takes_each_once() -> None:
    _seed()
    _set_rotation(cursor=7, batch_size=10)

    result, names, cursor = _tick()
    assert names == ["due-ch", "part-b", "part-c", "part-a"]
    # Advanced by what was taken, not by the configured batch size.
    assert cursor == 10
    assert result["partialChannels"] == 3


def test_a_missing_batch_size_takes_one() -> None:
    _seed()
    _set_rotation(cursor=0, batch_size=0)

    _result, names, cursor = _tick()
    assert names == ["due-ch", "part-a"]
    assert cursor == 1
