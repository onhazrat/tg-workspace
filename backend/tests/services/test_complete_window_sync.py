"""What a sync writes that the Complete window check reads (CW-01, ADR-043).

Each Channel records the moment a sync read its newest page, which is when
the head test says the sync saw up to, not when it finished (Last sync). The
Walked ranges a sync records, and how it repairs a Hole or a short history,
are `test_walked_ranges.py`'s (ADR-044).
"""

from __future__ import annotations

import asyncio
import importlib.util
import pathlib
import time
import types
import uuid
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app.api.routes import jobs as jobs_route
from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import Channel, Summary, SyncJob
from app.services import sync_orchestrator
from app.services.follows import get_operator_user_id
from app.services.scraper_jobs import WALK_BACK_KEY, ChannelSyncState, SyncJobState
from app.services.sync_orchestrator import _ChannelSyncCtx
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user
from tests.utils.utils import get_superuser_token_headers

VERSIONS = pathlib.Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
CUT_SHORT_PATH = VERSIONS / "c5e1a7f3b902_cut_short_summaries_cw_01.py"


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


@pytest.fixture
def channel(session: Session, user: User) -> Channel:
    handle = f"cw{uuid.uuid4().hex[:10]}"
    return add_test_channel(session, handle, name=handle, user_id=user.id)


def _ctx(channel: Channel) -> _ChannelSyncCtx:
    return _ChannelSyncCtx(
        channel_id=channel.id,
        channel_name=channel.name,
        display_name=channel.name,
        photo_url=None,
        auto_follow=False,
        proxies=[],
        proxy_concurrency=(1, {}),
        tor_auto_rotate=False,
        tor_rotation_threshold=10,
        tor_control_enabled=False,
        tor_control_port=9051,
        retrieval_pass="incremental",
        needs_backfill=False,
        scrape_cutoff_ms=0,
        effective_start_time=0,
    )


def _page(*ids: int, next_before: int | None = None) -> dict[str, Any]:
    # Recent, so no scrape cutoff stops the walk before the iteration limit.
    now = int(time.time() * 1000)
    return {
        "posts": [
            {"id": i, "text": f"p{i}", "timestamp": now - (1_000 - i) * 1_000}
            for i in ids
        ],
        "latestId": max(ids, default=0),
        "nextBeforeId": next_before,
    }


def test_the_head_read_moment_is_when_the_newest_page_was_read(
    session: Session, channel: Channel, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Set when the newest page is read, even by a walk the iteration limit
    stopped, and before Last sync, which is still when the sync finished.

    **Mutation:** set it in `_finalize_channel_success` instead and it lands
    after the first fetch; skip it on a capped walk and it stays None.
    """
    fetched_at: list[int] = []

    async def fetch(_ctx: Any, *, before_id: int | None, **_kw: Any) -> Any:
        fetched_at.append(int(time.time() * 1000))
        await asyncio.sleep(0.05)
        top = before_id or 100
        return _page(top - 2, top - 1, next_before=top - 2)

    monkeypatch.setattr(sync_orchestrator, "_fetch_one_page", fetch)
    monkeypatch.setattr(settings, "SCRAPER_ITERATION_LIMIT", 2)
    ch_state = ChannelSyncState(channel_id=channel.id, channel_name=channel.name)
    job = SyncJobState(
        job_id="cw-head",
        source="test",
        channels={channel.id: ch_state},
        user_id=str(user.id),
        sync_mode="individual",
    )
    began = int(time.time() * 1000)

    asyncio.run(sync_orchestrator.sync_single_channel(job, ch_state, user_id=user.id))

    assert len(fetched_at) == 2, "the iteration limit did not stop the walk"
    session.expire_all()
    row = session.get(Channel, channel.id)
    assert row is not None
    assert row.head_read_at is not None
    assert began <= row.head_read_at <= fetched_at[0]
    assert row.last_updated is not None
    assert row.last_updated > fetched_at[1]


def _load_migration(path: pathlib.Path) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_cut_short_rename_moves_the_flag_and_nothing_else(
    session: Session, user: User
) -> None:
    """`incomplete` becomes `cutShort` with its value; a row without it, and
    every other key, is left as it was.

    **Mutation:** drop the `?` guard and the row without the flag gains a
    `cutShort: null`.
    """
    rows = {
        "flagged": {"incomplete": True, "status": "done"},
        "cleared": {"incomplete": False},
        "plain": {"status": "done"},
    }
    for key, extra in rows.items():
        session.add(
            Summary(id=f"cs-{key}-{user.id}", user_id=user.id, text="t", extra=extra)
        )
    session.commit()

    session.execute(sa.text(_load_migration(CUT_SHORT_PATH).RENAME_SQL))
    session.commit()

    session.expire_all()
    after = {
        key: (session.get(Summary, f"cs-{key}-{user.id}") or Summary()).extra
        for key in rows
    }
    assert after == {
        "flagged": {"cutShort": True, "status": "done"},
        "cleared": {"cutShort": False},
        "plain": {"status": "done"},
    }


def test_the_gates_sync_walks_back_where_it_asks(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The gate's sync of a Channel short of its window's Start walks back to
    the Start, as the successor's does (ADR-043).

    **Mutation:** drop `walkBackTo` from the route and the job's Channel
    carries no walk back.
    """
    owner = get_operator_user_id(session)
    assert owner is not None
    handle = f"cw{uuid.uuid4().hex[:10]}"
    channel = add_test_channel(session, handle, name=handle, user_id=owner)
    monkeypatch.setattr(jobs_route, "enqueue_sync_job", AsyncMock())

    response = client.post(
        f"{settings.API_V1_STR}/jobs/sync",
        json={"channelIds": [channel.id], "walkBackTo": {channel.id: 1_000}},
        headers=get_superuser_token_headers(client),
    )

    assert response.status_code == 200, response.text
    job = session.get(SyncJob, response.json()["jobId"])
    assert job is not None
    assert [c["metadata"] for c in job.channels] == [{WALK_BACK_KEY: 1_000}]
