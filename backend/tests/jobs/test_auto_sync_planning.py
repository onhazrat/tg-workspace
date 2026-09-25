"""How a tick picks its partial-history Channels and merges them with due ones.

`test_scheduler_jobs.py` proves a partial Channel is picked at all. Nothing
pinned *which* one when there are more candidates than the batch takes, or where
the cursor lands afterwards, so a rotation that stopped rotating — the same
Channel every tick, the rest never backfilled — would pass the suite. These
drive the real tick against stored settings and read the cursor back.

The planning helpers `run_auto_sync` delegates to are tested directly at the
bottom, over plain values and namespaces rather than a database.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session

from app.core.db import engine
from app.jobs.auto_sync import (
    _classify_owner,
    _merge_owner_plan,
    _OwnerPlan,
    _partial_batch,
    _tick_summary,
    run_auto_sync,
)
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


# The pure halves. Owners are fixed so `str(owner)` sorts predictably.
OWNER_A = uuid.UUID(int=1)
OWNER_B = uuid.UUID(int=2)


def _candidates(*pairs: tuple[uuid.UUID, str]) -> list[tuple[uuid.UUID, str, str]]:
    return [(owner, cid, f"name-{cid}") for owner, cid in pairs]


def test_partial_batch_orders_by_channel_then_owner() -> None:
    candidates = _candidates((OWNER_B, "c2"), (OWNER_B, "c1"), (OWNER_A, "c2"))
    batch = _partial_batch(candidates, cursor=0, batch_size=3)
    assert [(o, cid) for o, cid, _ in batch] == [
        (OWNER_B, "c1"),
        (OWNER_A, "c2"),
        (OWNER_B, "c2"),
    ]


def test_partial_batch_starts_at_the_cursor_and_wraps() -> None:
    candidates = _candidates(*[(OWNER_A, c) for c in ("c1", "c2", "c3")])
    assert [c[1] for c in _partial_batch(candidates, 4, 2)] == ["c2", "c3"]
    assert [c[1] for c in _partial_batch(candidates, 5, 2)] == ["c3", "c1"]


def test_partial_batch_takes_one_lap_at_most() -> None:
    candidates = _candidates(*[(OWNER_A, c) for c in ("c1", "c2")])
    assert [c[1] for c in _partial_batch(candidates, 1, 10)] == ["c2", "c1"]


def test_partial_batch_floors_the_batch_size_at_one() -> None:
    candidates = _candidates(*[(OWNER_A, c) for c in ("c1", "c2")])
    assert len(_partial_batch(candidates, 0, 0)) == 1
    assert len(_partial_batch(candidates, 0, -3)) == 1


def test_partial_batch_of_nothing_is_nothing() -> None:
    assert _partial_batch([], cursor=7, batch_size=3) == []


def test_merge_puts_due_first_and_takes_each_channel_once() -> None:
    plan = _merge_owner_plan(
        OWNER_A,
        due=[("c2", "two"), ("c1", "one")],
        partial=[("c1", "one"), ("c3", "three")],
        reasons={"c2": "regular", "c1": "dynamic"},
    )
    assert plan is not None
    assert plan.owner_id == OWNER_A
    assert plan.entries == [("c2", "two"), ("c1", "one"), ("c3", "three")]
    assert plan.reasons == {"c2": "regular", "c1": "dynamic"}
    # Counts are the inputs, before the de-duplication.
    assert (plan.due_count, plan.partial_count) == (2, 2)


def test_merge_of_an_owner_with_nothing_to_sync_is_no_plan() -> None:
    assert _merge_owner_plan(OWNER_A, due=[], partial=[], reasons={}) is None


NOW = 1_000_000
PAST, FUTURE = NOW - 1, NOW + 1


def _pair(
    cid: str,
    group_id: str | None,
    *,
    regular_at: int = FUTURE,
    dynamic_at: int = FUTURE,
    complete: bool = False,
) -> tuple[SimpleNamespace, SimpleNamespace]:
    channel = SimpleNamespace(
        id=cid,
        name=f"name-{cid}",
        next_regular_sync_at=regular_at,
        next_dynamic_sync_at=dynamic_at,
        history_complete_to_cutoff=complete,
    )
    return channel, SimpleNamespace(setting_group_id=group_id)


def test_classify_sorts_follows_into_due_partial_and_neither() -> None:
    groups = {
        "live": SimpleNamespace(
            is_frozen=False, regular_sync_enabled=True, dynamic_sync_enabled=True
        ),
        "frozen": SimpleNamespace(
            is_frozen=True, regular_sync_enabled=True, dynamic_sync_enabled=True
        ),
    }
    pairs: list[Any] = [
        _pair("regular", "live", regular_at=PAST),
        _pair("both", "live", regular_at=PAST, dynamic_at=PAST),
        # Dynamic-due only with the stats that make it eligible.
        _pair("dynamic", "live", dynamic_at=PAST),
        _pair("no-stats", "live", dynamic_at=PAST),
        _pair("partial", "live"),
        _pair("complete", "live", complete=True),
        _pair("frozen", "frozen", regular_at=PAST),
        _pair("no-group", None, regular_at=PAST),
        _pair("unknown-group", "gone", regular_at=PAST),
    ]
    stats = {
        "name-dynamic": {"count": 3, "velocity": 1.0},
        "name-both": {"count": 3, "velocity": 1.0},
    }

    due, reasons, partial = _classify_owner(OWNER_A, pairs, groups, stats, NOW)

    assert due == [
        ("regular", "name-regular"),
        ("both", "name-both"),
        ("dynamic", "name-dynamic"),
    ]
    assert reasons == {"regular": "regular", "both": "both", "dynamic": "dynamic"}
    assert partial == [
        (OWNER_A, "no-stats", "name-no-stats"),
        (OWNER_A, "partial", "name-partial"),
    ]


def _plan(reasons: dict[str, str], entries: int, due: int, partial: int) -> Any:
    return _OwnerPlan(
        owner_id=OWNER_A,
        entries=[(f"c{i}", f"n{i}") for i in range(entries)],
        reasons=reasons,
        due_count=due,
        partial_count=partial,
    )


def test_tick_summary_adds_up_every_plan() -> None:
    plans = [
        _plan({"a": "regular", "b": "both"}, entries=3, due=2, partial=1),
        _plan({"c": "regular", "d": "dynamic"}, entries=2, due=2, partial=0),
    ]
    summary = _tick_summary(plans, ["job-1", "job-2"], ["queued", "failed"], 11)
    assert summary == {
        "jobId": "job-1",
        "jobIds": ["job-1", "job-2"],
        "owners": 2,
        "channels": 5,
        "checked": 11,
        "dueChannels": 4,
        "partialChannels": 1,
        "dueRegular": 2,
        "dueDynamic": 1,
        "dueBoth": 1,
        "status": "queued",
    }
