"""A Directory entry comes due by expected new Posts (DRP-01, ADR-045).

`due = last conclusive answer + clamp(Refresh target / Posting rate, min, max)`.
Driven through the probe write path (`record_probe_result`), the sync path
(`record_sync_metadata`) and the queue (`dequeue_handles`), and observed by
what an entry holds afterwards and what the queue hands out next.
`test_directory_refresh.py` covers the parts ticket 03 settled (dead verdicts,
backoff, on-demand Refresh); every entry there has no rate.

## Watched to fail

Each mutation was applied alone with `scripts/mutate.py` and this module went
red; the commit body lists them.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlmodel import Session

from app.core.db import engine
from app.jobs.settings import save_settings_section
from app.models_tg import DirectoryEntry, utc_now
from app.services.channel_directory import (
    boost_entries,
    dequeue_handles,
    enqueue_handles,
    recompute_refresh_due,
    record_probe_result,
    record_sync_metadata,
    refresh_entries,
)
from app.services.settings_registry import DIRECTORY_KEY

DAY = timedelta(days=1)


def _samples(count: int, every: timedelta, *, ago: timedelta = DAY * 0) -> list[Any]:
    """`count` sample Posts `every` apart, the newest `ago` before now."""
    newest = utc_now() - ago
    out = []
    for i in range(count):
        at = newest - i * every
        out.append(
            {
                "id": 1000 - i,
                "text": f"post {i}",
                "date": at.isoformat(),
                "timestamp": int(at.replace(tzinfo=UTC).timestamp() * 1000),
                "channelName": "x",
            }
        )
    return out


def _probe(session: Session, handle: str, samples: list[Any]) -> DirectoryEntry:
    record_probe_result(
        session,
        handle,
        {"isTelegramPage": True, "kind": "channel", "samples": samples},
    )
    row = session.get(DirectoryEntry, handle)
    assert row is not None
    return row


def _wait(row: DirectoryEntry) -> timedelta:
    """How long after its last answer the entry comes due."""
    assert row.refresh_due_at is not None and row.checked_at is not None
    return row.refresh_due_at - row.checked_at


def _policy(session: Session, **fields: int) -> None:
    save_settings_section(session, DIRECTORY_KEY, fields)
    session.commit()


#: Twenty Posts across one day: 140 a week, a target of 20 in one day.
BUSY = (20, DAY / 19)
#: Twenty Posts a day apart, the newest today: 20 over 19 days and the time
#: since, so close to one a day.
STEADY = (20, DAY)
#: Five Posts long ago: barely any rate at all.
DORMANT = (5, DAY * 30)


def test_a_busy_channel_waits_the_shortest() -> None:
    """A target of 20 is one day of this Channel, clamped to the 4-day minimum
    that keeps the busiest Channels from eating the probe budget."""
    with Session(engine) as session:
        row = _probe(session, "busy", _samples(*BUSY))
        assert _wait(row) == timedelta(days=4)


def test_a_dormant_channel_waits_the_longest() -> None:
    with Session(engine) as session:
        row = _probe(session, "dormant", _samples(*DORMANT, ago=DAY * 200))
        assert _wait(row) == timedelta(days=120)


def test_between_the_bounds_the_wait_is_the_target_over_the_rate() -> None:
    with Session(engine) as session:
        row = _probe(session, "steady", _samples(*STEADY))
        assert row.posts_per_week is not None
        expected = timedelta(weeks=20 / row.posts_per_week)
        assert _wait(row) == pytest.approx(expected, abs=timedelta(seconds=1))
        assert timedelta(days=18) < _wait(row) < timedelta(days=21)


def test_the_deployment_target_moves_the_wait() -> None:
    with Session(engine) as session:
        _policy(session, directoryRefreshTarget=10)
        row = _probe(session, "steady", _samples(*STEADY))
        assert row.posts_per_week is not None
        expected = timedelta(weeks=10 / row.posts_per_week)
        assert _wait(row) == pytest.approx(expected, abs=timedelta(seconds=1))


def test_an_entry_s_own_target_moves_only_that_entry_and_is_still_clamped() -> None:
    """Story 12: an own target cannot undo the minimum, however small."""
    with Session(engine) as session:
        mine = _probe(session, "mine", _samples(*STEADY))
        theirs = _probe(session, "theirs", _samples(*STEADY))
        busy = _probe(session, "busy", _samples(*BUSY))
        for row, target in ((mine, 40), (busy, 1)):
            row.refresh_target = target
            session.add(row)
        session.commit()

        mine = _probe(session, "mine", _samples(*STEADY))
        theirs = _probe(session, "theirs", _samples(*STEADY))
        busy = _probe(session, "busy", _samples(*BUSY))

        assert mine.posts_per_week is not None
        mine_wait = timedelta(weeks=40 / mine.posts_per_week)
        assert _wait(mine) == pytest.approx(mine_wait, abs=timedelta(seconds=1))
        assert timedelta(days=18) < _wait(theirs) < timedelta(days=21)
        assert _wait(busy) == timedelta(days=4)


def test_a_sync_reschedules_from_the_stored_rate() -> None:
    """Sync writes no samples, so the rate it schedules by is the last probe's."""
    with Session(engine) as session:
        probed = _probe(session, "steady", _samples(*STEADY))
        rate, wait = probed.posts_per_week, _wait(probed)

        record_sync_metadata(
            session, "steady", {"isTelegramPage": True, "kind": "channel"}
        )
        session.commit()
        synced = session.get(DirectoryEntry, "steady")
        assert synced is not None
        assert synced.posts_per_week == rate
        assert _wait(synced) == pytest.approx(wait, abs=timedelta(seconds=1))


# --------------------------------------------------------------------------- #
# The queue: boost first, then most overdue                                    #
# --------------------------------------------------------------------------- #


def _due_at(session: Session, handle: str, due: datetime) -> None:
    row = session.get(DirectoryEntry, handle)
    assert row is not None
    row.refresh_due_at = due
    session.add(row)
    session.commit()


def test_due_entries_drain_most_overdue_first_not_alphabetically() -> None:
    with Session(engine) as session:
        now = utc_now()
        for handle, overdue in (("aaa", 1), ("mmm", 9), ("zzz", 5)):
            _probe(session, handle, [])
            _due_at(session, handle, now - DAY * overdue)

        assert dequeue_handles(session, limit=10, now=now) == ["mmm", "zzz", "aaa"]


def test_a_boost_goes_first_and_never_moves_a_due_date() -> None:
    """Story 20: the boost answers which first, the target answers when."""
    with Session(engine) as session:
        now = utc_now()
        for handle, overdue in (("old", 9), ("new", 1)):
            _probe(session, handle, [])
            _due_at(session, handle, now - DAY * overdue)
        enqueue_handles(session, ["never_answered"])
        before = session.get(DirectoryEntry, "new")
        assert before is not None
        due = before.refresh_due_at

        boost_entries(session, ["new"], mode="set", value=10)
        after = session.get(DirectoryEntry, "new")
        assert after is not None
        session.refresh(after)
        assert after.refresh_due_at == due

        assert dequeue_handles(session, limit=10, now=now) == [
            "never_answered",
            "new",
            "old",
        ]


# --------------------------------------------------------------------------- #
# A changed policy moves due dates at once                                     #
# --------------------------------------------------------------------------- #


def test_recompute_moves_live_entries_and_leaves_the_rest() -> None:
    with Session(engine) as session:
        steady = _probe(session, "steady", _samples(*STEADY))
        assert steady.posts_per_week is not None
        rate = steady.posts_per_week
        _probe(session, "asked", _samples(*STEADY))
        refresh_entries(session, ["asked"])
        record_probe_result(session, "a_bot", {"isTelegramPage": True, "kind": "bot"})

        _policy(session, directoryRefreshTarget=40)
        recompute_refresh_due(session)

        moved = session.get(DirectoryEntry, "steady")
        asked = session.get(DirectoryEntry, "asked")
        bot = session.get(DirectoryEntry, "a_bot")
        assert moved is not None and asked is not None and bot is not None
        session.refresh(moved)
        session.refresh(asked)
        expected = timedelta(weeks=40 / rate)
        assert _wait(moved) == pytest.approx(expected, abs=timedelta(seconds=1))
        assert asked.refresh_due_at is not None
        assert asked.refresh_due_at <= utc_now(), "an on-demand Refresh stays due"
        assert bot.refresh_due_at is None


def test_recompute_keeps_a_failed_refresh_s_backoff() -> None:
    """A live entry whose refresh failed carries the backoff as its due date;
    moving it back to `checked_at + wait` would retry on every tick."""
    with Session(engine) as session:
        _probe(session, "flaky", [])
        record_probe_result(session, "flaky", None, error="timeout")
        row = session.get(DirectoryEntry, "flaky")
        assert row is not None and row.retry_after is not None
        backoff = row.retry_after

        _policy(session, directoryRefreshMaxDays=1, directoryRefreshMinDays=1)
        session.execute(
            DirectoryEntry.__table__.update().values(  # type: ignore[attr-defined]
                checked_at=utc_now() - DAY * 5
            )
        )
        session.commit()
        recompute_refresh_due(session)
        session.refresh(row)
        assert row.refresh_due_at == backoff
