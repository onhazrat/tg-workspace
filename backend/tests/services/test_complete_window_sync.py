"""What a sync writes that the Complete window check reads (CW-01, ADR-043).

Two facts the check trusts. A confirmed gap is an id known not to exist, so
storing a Post for it clears it in the same write; a gap left behind counted
the Post as missing as well as held. And each Channel records the moment a
sync read its newest page, which is when the head test says the sync saw up
to, not when it finished (Last sync).
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

import pytest
import sqlalchemy as sa
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import Channel, Post, PostSyncState
from app.services import sync_orchestrator
from app.services.scraper_jobs import ChannelSyncState, SyncJobState
from app.services.sync_orchestrator import _apply_scrape_page, _ChannelSyncCtx
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app"
    / "alembic"
    / "versions"
    / "d6f2b8a4c013_clear_stored_confirmed_gaps_cw_01.py"
)


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
        min_stored_post_id=None,
        scrape_cutoff_ms=0,
        effective_start_time=0,
    )


def _gap(session: Session, channel_name: str, post_id: int) -> None:
    session.add(
        PostSyncState(channel_name=channel_name, post_id=post_id, confirmed_at=1)
    )
    session.commit()


def _gap_ids(session: Session, channel_name: str) -> list[int]:
    session.expire_all()
    return sorted(
        session.exec(
            select(PostSyncState.post_id).where(
                PostSyncState.channel_name == channel_name
            )
        ).all()
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


def test_storing_a_post_clears_its_confirmed_gap(
    session: Session, channel: Channel
) -> None:
    """**Mutation:** drop the clear in `bulk_upsert_posts_impl` and 7 stays."""
    _gap(session, channel.name, 7)
    _gap(session, channel.name, 9)

    _apply_scrape_page(
        _ctx(channel),
        _page(6, 7, 8),
        job_id="cw-job",
        job_source="test",
        user_id=None,
        session_seen_ids=set(),
        before_id=None,
    )

    assert _gap_ids(session, channel.name) == [9]


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


def _load_migration() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("gap_clear", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_backfill_deletes_only_gaps_whose_post_is_stored(
    session: Session, channel: Channel
) -> None:
    """Run against both unique indexes it touches: one gap and one Post per
    (Channel, id), and the same id in another Channel is a different id."""
    other = f"{channel.name}x"
    for post_id in (3, 4):
        session.add(Post(channel_name=channel.name, post_id=post_id, timestamp=1))
    session.commit()
    for post_id in (3, 5):
        _gap(session, channel.name, post_id)
    _gap(session, other, 4)

    session.execute(sa.text(_load_migration().CLEAR_SQL))
    session.commit()

    assert _gap_ids(session, channel.name) == [5]
    assert _gap_ids(session, other) == [4]
