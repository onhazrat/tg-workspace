"""The Priority boost moves probe order and nothing else (DPF).

`dequeue_handles` orders by `priority - priority_boost`, and every writer of
`priority` leaves the boost alone: it is a standing Operator decision, and the
next probe rewriting it would make it a suggestion.

## Watched to fail

Each mutation was applied alone and this module went red:

* order the dequeue by `priority` -> the within-band and recheck cases
* reset the boost in `_schedule_refresh` -> the survives case
* check the `add` range per row while writing -> the all-or-nothing case
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import DirectoryEntry, utc_now
from app.services.channel_directory import (
    MAX_PRIORITY_BOOST,
    BoostOutOfRange,
    boost_entries,
    dequeue_handles,
    enqueue_handles,
    record_probe_result,
    record_sync_metadata,
    refresh_entries,
    requeue_probes,
)

OK_PAGE = {"isTelegramPage": True, "kind": "channel", "latestId": 7}


def _stale(session: Session, *handles: str) -> None:
    """Resolve each handle and make its answer due, so all sit in the refresh band."""
    for handle in handles:
        record_probe_result(session, handle, OK_PAGE)
        row = session.get(DirectoryEntry, handle)
        assert row is not None
        row.refresh_due_at = utc_now() - timedelta(minutes=1)
        session.add(row)
    session.commit()


def _boost(handle: str) -> int:
    with Session(engine) as session:
        row = session.get(DirectoryEntry, handle)
        assert row is not None
        return row.priority_boost


def test_a_new_entry_carries_no_boost() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["fresh"])
    assert _boost("fresh") == 0


def test_a_boost_of_one_reorders_inside_a_band() -> None:
    """Every refresh ties at one priority; +1 puts this one first, and a
    never-probed handle still drains ahead of every refresh."""
    with Session(engine) as session:
        _stale(session, "aa_refresh", "zz_refresh")
        enqueue_handles(session, ["pending"])
        assert boost_entries(session, ["zz_refresh"], mode="set", value=1) == 1
        assert dequeue_handles(session, limit=3) == [
            "pending",
            "zz_refresh",
            "aa_refresh",
        ]


def test_a_negative_boost_drains_later() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["first", "second"])
        boost_entries(session, ["first"], mode="set", value=-5)
        assert dequeue_handles(session, limit=2) == ["second", "first"]


def test_a_large_boost_beats_a_recheck() -> None:
    """Plain arithmetic, no exception for the recheck priority (DPF Q4)."""
    with Session(engine) as session:
        _stale(session, "boosted")
        requeue_probes(session, ["rechecked"])
        boost_entries(session, ["boosted"], mode="set", value=3_000_000)
        assert dequeue_handles(session, limit=2) == ["boosted", "rechecked"]


def test_add_accumulates_and_set_replaces() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["a", "b"])
        boost_entries(session, ["a"], mode="set", value=10)
        assert boost_entries(session, ["a", "b"], mode="add", value=5) == 2
    assert (_boost("a"), _boost("b")) == (15, 5)
    with Session(engine) as session:
        boost_entries(session, ["a", "b"], mode="set", value=-2)
    assert (_boost("a"), _boost("b")) == (-2, -2)


def test_an_unknown_handle_is_skipped_and_not_counted() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["known"])
        assert boost_entries(session, ["known", "nobody"], mode="set", value=1) == 1
        assert session.get(DirectoryEntry, "nobody") is None


def test_an_add_past_the_range_changes_no_entry() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["near", "far"])
        boost_entries(session, ["near"], mode="set", value=MAX_PRIORITY_BOOST - 1)
        with pytest.raises(BoostOutOfRange):
            boost_entries(session, ["far", "near"], mode="add", value=2)
    assert (_boost("near"), _boost("far")) == (MAX_PRIORITY_BOOST - 1, 0)


def test_a_set_past_the_range_is_refused() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["a"])
        with pytest.raises(BoostOutOfRange):
            boost_entries(session, ["a"], mode="set", value=-MAX_PRIORITY_BOOST - 1)
    assert _boost("a") == 0


def test_the_boost_survives_every_writer_of_priority() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["kept"])
        boost_entries(session, ["kept"], mode="set", value=42)
        record_probe_result(session, "kept", None, error="timeout")
        record_probe_result(session, "kept", OK_PAGE)
        refresh_entries(session, ["kept"])
        requeue_probes(session, ["kept"])
        enqueue_handles(session, ["kept"])
        record_sync_metadata(session, "kept", OK_PAGE)
        session.commit()
    assert _boost("kept") == 42
