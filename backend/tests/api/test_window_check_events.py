"""The followed Channels a sync just changed, pushed to the browser (WR-02).

Each test opens `GET /data/posts/window-check/events` on the real ASGI app,
because the stream never ends and `TestClient` waits for a response to end.
The sync runs in a thread with its own loop, as the worker is its own process,
with Telegram's pages faked at the sync's page fetch.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app import crud
from app.core import pg_notify
from app.core.config import settings
from app.core.db import engine
from app.main import app
from app.models import User, UserUpdate
from app.services import channel_changes, scraper_jobs, sync_orchestrator
from app.services.follows import get_operator_user_id
from app.services.scraper_jobs import ChannelSyncState, SyncJobState
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

EVENTS = f"{settings.API_V1_STR}/data/posts/window-check/events"
NOW = int(time.time() * 1000)
HOUR = 3_600_000
#: Long enough for a frame gathered for `GATHER_SECONDS` to arrive.
ARRIVES = channel_changes.GATHER_SECONDS + 4


@pytest.fixture(autouse=True)
def _fresh_listener() -> None:
    """Each test runs its own loop, and a `Listener` binds to the first."""
    pg_notify.reset_listeners_for_tests()


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture
def operator_id() -> uuid.UUID:
    with Session(engine) as session:
        owner = get_operator_user_id(session)
    assert owner is not None
    return owner


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="wr02-pass")
        )
        user_id, email = user.id, user.email
    yield (
        user_id,
        user_authentication_headers(client=client, email=email, password="wr02-pass"),
    )
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == user_id))  # type: ignore[call-overload]
        session.commit()


def _follow(user_id: uuid.UUID, name: str) -> str:
    with Session(engine) as session:
        return add_test_channel(session, name, name=name, user_id=user_id).id


async def _open(headers: dict[str, str]) -> asyncio.Queue[Any]:
    """Open the stream as a browser would; answers its frames' names, and the
    status instead when it is refused. Closed when the test's loop ends."""
    frames: asyncio.Queue[Any] = asyncio.Queue()
    asked = False

    async def receive() -> dict[str, Any]:
        nonlocal asked
        if not asked:
            asked = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()  # the browser never leaves
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start" and message["status"] != 200:
            frames.put_nowait(message["status"])
        for line in message.get("body", b"").decode().splitlines():
            if line.startswith("data: "):
                frames.put_nowait(json.loads(line.removeprefix("data: "))["names"])

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": EVENTS,
        "raw_path": EVENTS.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("test", 1),
        "server": ("test", 80),
    }
    asyncio.get_running_loop().create_task(app(scope, receive, send))
    assert await asyncio.wait_for(frames.get(), ARRIVES) == [], "no open frame"
    return frames


async def _next(frames: asyncio.Queue[Any]) -> Any:
    return await asyncio.wait_for(frames.get(), ARRIVES)


def _sync(
    monkeypatch: pytest.MonkeyPatch,
    owner: uuid.UUID,
    channel_id: str,
    name: str,
    second_page: threading.Event,
) -> None:
    """Sync the Channel over two pages, asking for the second only once
    `second_page` is set, so a test reads what the first page announced."""
    pages: dict[int | None, list[tuple[int, int]]] = {
        None: [(20, NOW - HOUR), (19, NOW - 2 * HOUR)],
        19: [(18, NOW - 3 * HOUR)],
    }

    async def fetch(_ctx: Any, *, before_id: int | None, **_kw: Any) -> Any:
        if before_id is not None:
            second_page.wait(timeout=2 * ARRIVES)
        posts = pages.get(before_id, [])
        return {
            "posts": [{"id": i, "text": "p", "timestamp": ts} for i, ts in posts],
            "latestId": 20,
            "nextBeforeId": min((i for i, _ in posts), default=None),
        }

    monkeypatch.setattr(sync_orchestrator, "_fetch_one_page", fetch)
    ch_state = ChannelSyncState(channel_id=channel_id, channel_name=name)
    job = SyncJobState(
        job_id=f"wr02-{uuid.uuid4().hex[:8]}",
        source="test",
        channels={channel_id: ch_state},
        user_id=str(owner),
        sync_mode="auto",
    )
    asyncio.run(sync_orchestrator.sync_single_channel(job, ch_state, user_id=owner))
    assert ch_state.status == "success", ch_state.error


def test_an_applied_page_reaches_its_followers_and_nobody_else(
    operator: dict[str, str],
    operator_id: uuid.UUID,
    other: tuple[uuid.UUID, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The first page's Posts reach the follower while the walk is still on
    its second page; the other Account, following none of it, hears nothing.

    **Mutation:** announce nothing when a page is applied and the follower
    hears of it only when the sync ends, after the wait, so this goes red.
    """
    other_id, other_headers = other
    channel_id = _follow(operator_id, "wr02_page")
    _follow(other_id, "wr02_elsewhere")
    second_page = threading.Event()

    async def run() -> tuple[Any, Any]:
        mine, theirs = await _open(operator), await _open(other_headers)
        walk = asyncio.create_task(
            asyncio.to_thread(
                _sync, monkeypatch, operator_id, channel_id, "wr02_page", second_page
            )
        )
        try:
            heard = await _next(mine)
        finally:
            second_page.set()
            await walk
        try:
            overheard = await asyncio.wait_for(theirs.get(), ARRIVES)
        except TimeoutError:
            overheard = None
        return heard, overheard

    assert asyncio.run(run()) == (["wr02_page"], None)


def test_a_burst_is_gathered_into_one_frame(
    operator: dict[str, str], operator_id: uuid.UUID
) -> None:
    """Three changes to two Channels inside a second are one frame naming each
    once, so a busy sync asks the check once a second at most.

    **Mutation:** gather for 0 seconds and the first frame names one Channel.
    """
    _follow(operator_id, "wr02_a")
    _follow(operator_id, "wr02_b")

    async def run() -> Any:
        frames = await _open(operator)
        for name in ("wr02_b", "wr02_a", "wr02_b"):
            await asyncio.to_thread(channel_changes.announce, name)
        return await _next(frames)

    assert asyncio.run(run()) == ["wr02_a", "wr02_b"]


def _job(owner: uuid.UUID, *states: ChannelSyncState) -> SyncJobState:
    return SyncJobState(
        job_id=f"wr02-{uuid.uuid4().hex[:8]}",
        source="test",
        channels={ch.channel_id: ch for ch in states},
        user_id=str(owner),
        sync_mode="bulk",
        status="running",
    )


def _state(name: str, status: str) -> ChannelSyncState:
    return ChannelSyncState(channel_id=name, channel_name=name, status=status)


def test_a_finished_sync_is_announced_once_its_row_says_so(
    operator: dict[str, str], operator_id: uuid.UUID
) -> None:
    """The check reads syncs in flight from the job row, so a Channel's sync
    ending is announced when the row records it, and every Channel left once
    the job itself ends, since the check stops reading those as in flight too.
    The gate waits on that.

    **Mutation:** announce no landed Channel at the flush, or only Channels
    whose own sync ended, and a frame never arrives.
    """
    for name in ("wr02_landed", "wr02_left"):
        _follow(operator_id, name)
    landed, left = _state("wr02_landed", "success"), _state("wr02_left", "running")
    job = _job(operator_id, landed, left)

    async def run() -> list[Any]:
        frames = await _open(operator)
        await scraper_jobs.persist_job(job, landed)
        first = await _next(frames)
        job.status = "failed"
        await scraper_jobs.persist_job(job)
        return [first, await _next(frames)]

    assert asyncio.run(run()) == [["wr02_landed"], ["wr02_left"]]


def test_a_sync_failed_by_a_restart_is_announced(
    operator: dict[str, str], operator_id: uuid.UUID
) -> None:
    """A worker restart fails the jobs it left mid-flight in one UPDATE that
    bypasses the flush, and their Channels stop being in flight all the same.

    **Mutation:** announce nothing after the restart's reconciliation.
    """
    _follow(operator_id, "wr02_restarted")
    job = _job(operator_id, _state("wr02_restarted", "running"))

    async def run() -> Any:
        frames = await _open(operator)
        await scraper_jobs.persist_job(job)
        with Session(engine) as session:
            assert scraper_jobs.reconcile_interrupted_jobs(session) == 1
        return await _next(frames)

    assert asyncio.run(run()) == ["wr02_restarted"]


def test_view_as_hears_the_viewed_accounts_channels(
    client: TestClient,
    operator: dict[str, str],
    operator_id: uuid.UUID,
    other: tuple[uuid.UUID, dict[str, str]],
) -> None:
    """A safe read, so View-as opens it, and it answers for the Account viewed:
    its Channels, never the acting Owner's.

    **Mutation:** filter the names by nobody's Follows and the Owner's Channel
    reaches the viewed Account's stream.
    """
    other_id, _ = other
    _follow(operator_id, "wr02_owners")
    _follow(other_id, "wr02_viewed")
    started = client.post(f"{settings.API_V1_STR}/view-as/{other_id}", headers=operator)
    assert started.status_code == 200, started.text
    viewing = {"Authorization": f"Bearer {started.json()['accessToken']}"}

    async def run() -> Any:
        frames = await _open(viewing)
        for name in ("wr02_owners", "wr02_viewed"):
            await asyncio.to_thread(channel_changes.announce, name)
        return await _next(frames)

    assert asyncio.run(run()) == ["wr02_viewed"]
