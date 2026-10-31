"""A scheduled successor makes its window Complete when it can (CW-03).

Unattended, it does what the gate does for a person (ADR-043): it checks the
window, syncs every Incomplete Channel a sync can repair (joining a sync
already in flight, queueing another behind one that read its head before E),
waits up to its deadline, and freezes the record like a manual action. It no
longer skips because some other sync runs somewhere on the deployment.

The sync itself is faked at `run_sync_job`, the one door the successor walks
through, so each test says what Telegram answered and how long it took. The
deadline and the poll are injected.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.jobs import auto_summary
from app.models import User
from app.models_tg import Channel, Post, Summary
from app.services import scraper_jobs
from app.services.scraper_jobs import SyncJobState, has_active_sync_job
from app.services.summaries import get_summary
from tests.utils.scope import stored_scope
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

MINUTE = 60_000
HOUR = 60 * MINUTE
NOW = int(time.time() * 1000) // MINUTE * MINUTE
#: The successor's window: the hour before last, ending at E.
START = NOW - 2 * HOUR
E = NOW - HOUR


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


@pytest.fixture(autouse=True)
def _quick(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auto_summary, "SUCCESSOR_SYNC_DEADLINE_S", 2.0)
    monkeypatch.setattr(auto_summary, "IN_FLIGHT_POLL_S", 0.05)


def _lagging(session: Session, user: User) -> Channel:
    """Held from before the Start, never read past E: its only reason is the end."""
    name = f"sw{uuid.uuid4().hex[:10]}"
    channel = add_test_channel(session, name, name=name, user_id=user.id)
    session.add(Post(channel_name=name, post_id=1, timestamp=START - 30 * MINUTE))
    session.add(Post(channel_name=name, post_id=2, timestamp=START + 30 * MINUTE))
    session.commit()
    return channel


def _predecessor(session: Session, user: User, *names: str) -> Summary:
    row = Summary(
        id=f"sum-{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        text="body",
        scope=stored_scope(channels=list(names), start=START - HOUR, end=START),
        language="English",
        post_count=0,
        timestamp=NOW,
        extra={"autoRegenerate": True},
    )
    session.add(row)
    session.commit()
    return row


def _read_head(channel_id: str) -> None:
    """What a sync that reached the head leaves behind: a head read now."""
    with Session(engine) as s:
        row = s.get(Channel, channel_id)
        assert row is not None
        row.head_read_at = int(time.time() * 1000)
        s.add(row)
        s.commit()


class _Telegram:
    """The fake `run_sync_job`: records each sync and answers at once."""

    def __init__(self) -> None:
        self.synced: list[list[str]] = []

    async def __call__(self, job: SyncJobState, _owner: uuid.UUID | None) -> None:
        self.synced.append(sorted(c.channel_name for c in job.channels.values()))
        for state in job.channels.values():
            _read_head(state.channel_id)
            state.status = "success"


def _regenerate(session: Session, predecessor: Summary, user: User) -> dict[str, Any]:
    new_id = asyncio.run(
        auto_summary._regenerate_one(session, predecessor, owner_id=user.id)
    )
    assert new_id is not None
    with Session(engine) as check:
        record: dict[str, Any] = get_summary(check, new_id, user_id=user.id)["scope"][
            "completeness"
        ]
    return record


def test_it_syncs_while_another_sync_job_is_active(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Mutation:** put back `if has_active_sync_job(): return` and nothing syncs."""
    channel = _lagging(session, user)
    busy = SyncJobState(job_id=f"busy-{uuid.uuid4()}", source="t", user_id="x")
    busy.status = "running"
    monkeypatch.setitem(scraper_jobs._active_jobs, busy.job_id, busy)
    assert has_active_sync_job()
    telegram = _Telegram()
    monkeypatch.setattr(auto_summary, "run_sync_job", telegram)

    record = _regenerate(session, _predecessor(session, user, channel.name), user)

    assert telegram.synced == [[channel.name]]
    assert record["choice"] == "synced"
    assert record["channels"] == []
