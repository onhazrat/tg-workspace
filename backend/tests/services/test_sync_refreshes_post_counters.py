"""Sync re-observes the counters of stored Posts it meets again (REACH-02).

A stored Post's View count used to be whatever it was the moment sync first
met it, usually within hours of publication, when it holds about a fifth of
what it settles at (ADR-024). Now every overlapping page re-observes the View
count, reaction chips and observation time of the stored Posts on it, until a
Post is 7 days old, and touches nothing else about the Post: not its
provenance, not its Language, not its reference state, and not the posts etag,
so a sync that found nothing new costs no browser a refetch.

Driven at `_apply_scrape_page`, because the refresh rides a decision that
function makes (which Posts are already stored) and must not change the other
one it makes (stop the incremental pass on the overlap page).
"""

from __future__ import annotations

import time
import uuid
from dataclasses import replace
from datetime import datetime
from typing import Any

import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Post
from app.services.follows import get_operator_user_id
from app.services.posts import COUNTER_REFRESH_HORIZON_MS
from app.services.sync_meta import get_sync_meta
from app.services.sync_orchestrator import _apply_scrape_page
from app.services.telegram_web import telegram_web_view_channel_url
from tests.services.test_sync_orchestrator import _ctx
from tests.utils.setting_groups import upsert_sync_test_channel

HOUR_MS = 60 * 60 * 1000
OLD_UPDATED_AT = datetime(2026, 1, 1)
CHIPS = [{"emoji": "👍", "count": 40, "isPaid": False}]


def _seed(timestamps: dict[int, int]) -> tuple[str, str]:
    """A followed Channel holding one Post per id, first seen at 100 views."""
    channel_id = f"counter-refresh-{uuid.uuid4()}"
    with Session(engine) as session:
        channel = upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=get_operator_user_id(session),
        )
        name = channel.name
        for post_id, ts in timestamps.items():
            session.add(
                Post(
                    channel_name=name,
                    post_id=post_id,
                    text=f"post {post_id}",
                    timestamp=ts,
                    views_count=100,
                    reaction_counts=None,
                    views_observed_at=1,
                    retrieved_at=1,
                    retrieval_job_id="first-job",
                    retrieval_pass="initial",
                    retrieval_source="Manual",
                    language="English",
                    references_extracted=True,
                    updated_at=OLD_UPDATED_AT,
                )
            )
        session.commit()
    return channel_id, name


def _page_post(post_id: int, ts: int, views: int | None) -> dict[str, Any]:
    return {
        "id": post_id,
        "text": f"edited {post_id}",
        "timestamp": ts,
        "media": {"kinds": [], "viewsCount": views, "reactionCounts": CHIPS},
    }


def _apply(
    channel_id: str, name: str, posts: list[dict[str, Any]], *, retrieval_pass: str
) -> Any:
    return _apply_scrape_page(
        replace(_ctx(channel_id, name), retrieval_pass=retrieval_pass),
        {
            "fullRequest": {"url": telegram_web_view_channel_url(name)},
            "posts": posts,
            "latestId": max(p["id"] for p in posts),
            "nextBeforeId": min(p["id"] for p in posts),
        },
        job_id="refresh-job",
        job_source="Manual",
        user_id=None,
        session_seen_ids=set(),
        before_id=None,
    )


def _stored(name: str) -> dict[int, Post]:
    with Session(engine) as session:
        rows = session.exec(select(Post).where(Post.channel_name == name)).all()
        # Detached plain copies: an attribute read after the session closes
        # would reopen a transaction and hang the autouse TRUNCATE.
        return {p.post_id: Post.model_validate(p.model_dump()) for p in rows}


def _posts_etag() -> str | None:
    with Session(engine) as session:
        entry = get_sync_meta(session).get("posts")
        return entry["etag"] if entry else None


@pytest.mark.parametrize("retrieval_pass", ["incremental", "backfill"])
def test_an_overlapping_page_refreshes_the_stored_counters(retrieval_pass: str) -> None:
    now = int(time.time() * 1000)
    channel_id, name = _seed({10: now - 2 * HOUR_MS})

    before = int(time.time() * 1000)
    _apply(channel_id, name, [_page_post(10, now, 900)], retrieval_pass=retrieval_pass)

    post = _stored(name)[10]
    assert post.views_count == 900
    assert post.reaction_counts == CHIPS
    assert post.views_observed_at is not None
    assert post.views_observed_at >= before


def test_a_post_past_the_horizon_is_not_refreshed() -> None:
    now = int(time.time() * 1000)
    channel_id, name = _seed({10: now - COUNTER_REFRESH_HORIZON_MS - HOUR_MS})

    _apply(channel_id, name, [_page_post(10, now, 900)], retrieval_pass="incremental")

    post = _stored(name)[10]
    assert (post.views_count, post.reaction_counts, post.views_observed_at) == (
        100,
        None,
        1,
    )


def test_an_unchanged_count_still_moves_the_observation_time() -> None:
    # Telegram shows "1.2K" for hours; the sighting is still a new one.
    now = int(time.time() * 1000)
    channel_id, name = _seed({10: now - 2 * HOUR_MS})

    _apply(channel_id, name, [_page_post(10, now, 100)], retrieval_pass="incremental")

    post = _stored(name)[10]
    assert post.views_count == 100
    assert post.views_observed_at is not None
    assert post.views_observed_at > 1


def test_the_refresh_writes_nothing_else_about_the_post() -> None:
    now = int(time.time() * 1000)
    channel_id, name = _seed({10: now - 2 * HOUR_MS})

    _apply(channel_id, name, [_page_post(10, now, 900)], retrieval_pass="incremental")

    post = _stored(name)[10]
    assert post.text == "post 10"
    assert (post.retrieved_at, post.retrieval_job_id) == (1, "first-job")
    assert (post.retrieval_pass, post.retrieval_source) == ("initial", "Manual")
    assert post.language == "English"
    assert post.references_extracted is True
    assert post.updated_at == OLD_UPDATED_AT


def test_a_refresh_alone_does_not_move_the_posts_etag() -> None:
    now = int(time.time() * 1000)
    channel_id, name = _seed({10: now - 2 * HOUR_MS})
    etag = _posts_etag()

    _apply(channel_id, name, [_page_post(10, now, 900)], retrieval_pass="incremental")

    assert _stored(name)[10].views_count == 900
    assert _posts_etag() == etag


def test_the_incremental_pass_still_stops_on_the_overlap_page() -> None:
    now = int(time.time() * 1000)
    channel_id, name = _seed({10: now - 2 * HOUR_MS})

    result = _apply(
        channel_id,
        name,
        [_page_post(11, now, 5), _page_post(10, now, 900)],
        retrieval_pass="incremental",
    )

    assert result.stop_sync is True
    assert result.break_incremental is True
    assert result.next_before_id is None
    assert result.posts_saved == 1
    stored = _stored(name)
    assert stored[10].views_count == 900
    # The new Post went through the full upsert and nothing else did.
    assert stored[11].retrieval_job_id == "refresh-job"
    assert stored[10].retrieval_job_id == "first-job"
