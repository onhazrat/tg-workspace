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
from collections.abc import Coroutine, Iterator
from typing import Any

import pytest
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.jobs import auto_summary
from app.models import User
from app.models_tg import (
    BotCredential,
    Channel,
    ChatDestination,
    Post,
    Summary,
    SyncJob,
)
from app.services import publications, scraper_jobs
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


def _unread_end(session: Session, user: User) -> Channel:
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


def _read_head(channel_id: str, at: int | None = None) -> None:
    """What a sync that reached the head leaves behind: a head read, now."""
    with Session(engine) as s:
        row = s.get(Channel, channel_id)
        assert row is not None
        row.head_read_at = at or int(time.time() * 1000)
        s.add(row)
        s.commit()


class _Telegram:
    """The fake `run_sync_job`: records each sync and answers at once, or
    with `answer` set, as that status without reading anything."""

    def __init__(self, events: list[str] | None = None, answer: str = "") -> None:
        self.synced: list[list[str]] = []
        self.events = events if events is not None else []
        self.answer = answer

    async def __call__(self, job: SyncJobState, _owner: uuid.UUID | None) -> None:
        self.synced.append(sorted(c.channel_name for c in job.channels.values()))
        self.events.append("ours")
        for state in job.channels.values():
            if not self.answer:
                _read_head(state.channel_id)
            state.status = self.answer or "success"


def _in_flight(session: Session, channel: Channel, *, started: int) -> SyncJob:
    """Another Account's sync of `channel`, running since `started`."""
    other = create_random_user(session)
    row = SyncJob(
        id=str(uuid.uuid4()),
        user_id=other.id,
        status="running",
        channels=[
            {"channelId": channel.id, "channelName": channel.name, "status": "running"}
        ],
        created_at=started,
    )
    session.add(row)
    session.commit()
    return row


async def _finish(job_id: str, events: list[str], *, head_read_at: int) -> None:
    """The sync in flight ends a moment later, having read its head then."""
    await asyncio.sleep(0.3)
    with Session(engine) as s:
        row = s.get(SyncJob, job_id)
        assert row is not None
        (channel,) = row.channels
        _read_head(channel["channelId"], head_read_at)
        row.status = "completed"
        row.channels = [{**channel, "status": "success"}]
        s.add(row)
        s.commit()
    events.append("theirs")


def _regenerate(
    session: Session,
    predecessor: Summary,
    user: User,
    beside: Coroutine[Any, Any, None] | None = None,
) -> dict[str, Any]:
    async def run() -> str | None:
        meanwhile = asyncio.ensure_future(beside) if beside else None
        new_id = await auto_summary._regenerate_one(
            session, predecessor, owner_id=user.id
        )
        if meanwhile:
            await meanwhile
        return new_id

    new_id = asyncio.run(run())
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
    channel = _unread_end(session, user)
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


@pytest.mark.parametrize(
    ("started", "head_read_at"),
    [
        pytest.param(E + MINUTE, None, id="started after E"),
        # Its head read is still to come, so after E: an earlier sync's
        # read, before this one started, says nothing about it.
        pytest.param(E - MINUTE, START, id="started before E, head not read yet"),
    ],
)
def test_it_joins_a_sync_in_flight_that_reads_its_head_after_e(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    started: int,
    head_read_at: int | None,
) -> None:
    """**Mutation:** sync every Channel now and it syncs this one twice;
    judge by when the job started and it queues behind the second."""
    channel = _unread_end(session, user)
    if head_read_at is not None:
        _read_head(channel.id, head_read_at)
    events: list[str] = []
    other = _in_flight(session, channel, started=started)
    telegram = _Telegram(events)
    monkeypatch.setattr(auto_summary, "run_sync_job", telegram)

    record = _regenerate(
        session,
        _predecessor(session, user, channel.name),
        user,
        _finish(other.id, events, head_read_at=NOW),
    )

    assert telegram.synced == []
    assert events == ["theirs"]
    assert record["choice"] == "synced"
    assert record["channels"] == []


def test_it_queues_another_behind_a_sync_that_read_its_head_before_e(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """That sync cannot pass the head test, so the successor syncs once it ends.

    **Mutation:** join it instead, and the window freezes Incomplete.
    """
    channel = _unread_end(session, user)
    _read_head(channel.id, E - MINUTE)
    events: list[str] = []
    other = _in_flight(session, channel, started=E - 2 * MINUTE)
    telegram = _Telegram(events)
    monkeypatch.setattr(auto_summary, "run_sync_job", telegram)

    record = _regenerate(
        session,
        _predecessor(session, user, channel.name),
        user,
        _finish(other.id, events, head_read_at=E - MINUTE),
    )

    assert events == ["theirs", "ours"]
    assert telegram.synced == [[channel.name]]
    assert record["choice"] == "synced"
    assert record["channels"] == []


def test_after_the_deadline_only_the_unfinished_are_timed_out(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A Channel whose sync finished but left it Incomplete keeps its real
    reason; the one still syncing at the deadline is timed out.

    **Mutation:** wait without a deadline and the test hangs; time out every
    fixable Channel and the finished one reads "timed out" too; record
    `synced` and the choice is wrong.
    """
    done, stuck = _unread_end(session, user), _unread_end(session, user)
    monkeypatch.setattr(auto_summary, "SUCCESSOR_SYNC_DEADLINE_S", 0.5)

    async def one_hangs(job: SyncJobState, _owner: uuid.UUID | None) -> None:
        # Its sync answers without reading the head, so it stays Incomplete.
        for state in job.channels.values():
            state.status = "success" if state.channel_name == done.name else "running"
        await scraper_jobs.persist_job(job)
        await asyncio.Event().wait()

    monkeypatch.setattr(auto_summary, "run_sync_job", one_hangs)

    record = _regenerate(
        session, _predecessor(session, user, done.name, stuck.name), user
    )

    assert record["choice"] == "timed_out"
    reasons = {v["name"]: v["reasons"] for v in record["channels"]}
    assert reasons == {done.name: ["end"], stuck.name: ["timed_out", "end"]}


def test_no_transaction_stays_open_while_it_waits_on_its_syncs(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An idle transaction across a wait of up to five minutes pins the
    vacuum horizon (backend/CLAUDE.md).

    **Mutation:** drop the commit before the wait and the session is open.
    """
    channel = _unread_end(session, user)
    open_during: list[bool] = []
    complete_window = auto_summary._complete_window

    async def watched(*args: Any) -> Any:
        open_during.append(session.in_transaction())
        return await complete_window(*args)

    monkeypatch.setattr(auto_summary, "_complete_window", watched)
    monkeypatch.setattr(auto_summary, "run_sync_job", _Telegram())

    _regenerate(session, _predecessor(session, user, channel.name), user)

    assert open_during == [False]


def test_a_sync_refused_by_a_ceiling_is_recorded_refused(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Mutation:** drop the refused overlay and the reason reads "end"."""
    channel = _unread_end(session, user)
    monkeypatch.setattr(auto_summary, "run_sync_job", _Telegram(answer="skipped"))

    record = _regenerate(session, _predecessor(session, user, channel.name), user)

    assert record["choice"] == "synced"
    (verdict,) = record["channels"]
    assert verdict["reasons"] == ["refused", "end"]


# The metadata line a scheduled successor's auto-publish carries.


def _verdict(name: str, unproven: float, *, behind: bool = False) -> dict[str, Any]:
    return {
        "name": name,
        "reasons": ["end"],
        "reason": "end",
        "lastSync": None,
        "headReadAt": None,
        "error": None,
        "stretches": [{"kind": "end", "from": START, "to": E}],
        "missingIds": 0,
        "syncable": True,
        "behind": behind,
        "pacePerHour": unproven,
        "heldPosts": 10,
        "unprovenPosts": unproven,
    }


def _published(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    channels: list[dict[str, Any]],
) -> str:
    """Auto-publish a successor whose record holds `channels` as Incomplete,
    with metadata sent; answers the text Telegram would get."""
    names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]
    unproven = round(sum(c["unprovenPosts"] for c in channels))
    completeness = {
        "choice": "continued_early",
        "frozenAt": NOW,
        "start": START,
        "end": E,
        "channelCount": len(names),
        "heldPosts": 2000 - unproven,
        "channels": channels,
        "leftOut": [],
        "unprovenPosts": unproven,
        "unprovenFloor": False,
        "fixable": bool(channels),
        "incompleteCount": len(channels),
    }
    session.add(
        BotCredential(
            id=f"bot-{user.id}", user_id=user.id, name="b", token_encrypted="enc:x"
        )
    )
    session.add(
        ChatDestination(id=f"dest-{user.id}", user_id=user.id, name="d", chat_id="1")
    )
    summary = Summary(
        id=f"sum-{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        text="body",
        scope=stored_scope(
            channels=names, start=START, end=E, completeness=completeness
        ),
        language="English",
        model="m",
        post_count=0,
        timestamp=NOW,
        extra={
            "autoPublish": True,
            "publishBotId": f"bot-{user.id}",
            "publishChatId": f"dest-{user.id}",
            "sendMetadata": True,
        },
    )
    session.add(summary)
    session.commit()
    sent: list[str] = []

    async def send_parts(*_a: Any, parts: list[str], **_kw: Any) -> dict[str, Any]:
        sent.extend(parts)
        return {"success": True, "results": [], "telemetry": []}

    monkeypatch.setattr(publications, "send_parts", send_parts)
    asyncio.run(auto_summary._auto_publish(session, summary, owner_id=user.id))
    assert sent, "nothing was published"
    return "\n".join(sent)


def test_the_metadata_line_names_the_incomplete_channels_not_behind(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Mutation:** name Behind Channels too and "+4" replaces "+3"."""
    text = _published(
        session,
        user,
        monkeypatch,
        [
            _verdict("charlie", 4),
            _verdict("alpha", 20),
            _verdict("foxtrot", 0.4, behind=True),
            _verdict("bravo", 10),
            _verdict("delta", 3),
            _verdict("echo", 2.6),
        ],
    )

    assert "\n~40 Posts unproven (2%): @alpha, @bravo +3" in text


def test_no_metadata_line_when_only_behind_channels_remain(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = _published(session, user, monkeypatch, [_verdict("alpha", 12, behind=True)])

    assert "Analysis Metadata" in text
    assert "unproven" not in text.lower()


def test_no_metadata_line_on_a_complete_window(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = _published(session, user, monkeypatch, [])

    assert "Analysis Metadata" in text
    assert "unproven" not in text.lower()
