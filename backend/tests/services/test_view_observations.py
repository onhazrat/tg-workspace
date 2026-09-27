"""Sightings of sampled Posts become View observations (REACH-05, ADR-024).

The Settling curve is fitted from how a Post's View count climbs with age, so
every sighting of a Post the Observation stride selects is kept: the first
capture and every later refresh. `(post_id - 1) % stride == 0` is the
selection, so stride 1 keeps every Post and stride 4 keeps ids 1, 5, 9.

Driven at `_apply_scrape_page`, because both writes ride decisions that
function makes: a new Post goes through the full upsert, a stored one only
through the counter refresh.

## Watched to fail

* select on `post_id % stride == 0` → the stride-4 case fails
* drop the call in `refresh_post_counters` → the refresh row is missing
* drop the call in `bulk_upsert_posts_impl` → the first-capture row is missing
* drop the 14-day check at write → the old-Post test fails
* drop the `views_count is not None` filter → the no-count test raises on the
  NOT NULL column
"""

from __future__ import annotations

import time
import uuid
from dataclasses import replace
from typing import Any

import pytest
from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import Post, ViewObservation
from app.services.follows import get_operator_user_id
from app.services.settings_registry import VIEW_OBSERVATIONS_KEY
from app.services.settings_store import put_global_setting
from app.services.sync_orchestrator import _apply_scrape_page
from app.services.telegram_web import telegram_web_view_channel_url
from app.services.view_observations import OBSERVATION_WINDOW_MS
from tests.services.test_sync_orchestrator import _ctx
from tests.utils.setting_groups import upsert_sync_test_channel

HOUR_MS = 60 * 60 * 1000


def _channel(stride: int | None = None) -> tuple[str, str]:
    channel_id = f"observations-{uuid.uuid4()}"
    with Session(engine) as session:
        if stride is not None:
            put_global_setting(session, VIEW_OBSERVATIONS_KEY, {"stride": stride})
        channel = upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=get_operator_user_id(session),
        )
        name = channel.name
        session.commit()
    return channel_id, name


def _page_post(post_id: int, ts: int, views: int | None) -> dict[str, Any]:
    media = None if views is None else {"kinds": [], "viewsCount": views}
    return {"id": post_id, "text": f"post {post_id}", "timestamp": ts, "media": media}


def _apply(
    channel_id: str, name: str, posts: list[dict[str, Any]], *, retrieval_pass: str
) -> None:
    _apply_scrape_page(
        replace(_ctx(channel_id, name), retrieval_pass=retrieval_pass),
        {
            "fullRequest": {"url": telegram_web_view_channel_url(name)},
            "posts": posts,
            "latestId": max(p["id"] for p in posts),
            "nextBeforeId": min(p["id"] for p in posts),
        },
        job_id="observation-job",
        job_source="Manual",
        user_id=None,
        session_seen_ids=set(),
        before_id=None,
    )


def _observations(name: str) -> list[tuple[int, int, int]]:
    """(Telegram post id, views, published_at) per row, oldest sighting first."""
    with Session(engine) as session:
        rows = session.exec(
            select(
                Post.post_id, ViewObservation.views_count, ViewObservation.published_at
            )
            .join(Post, col(Post.id) == col(ViewObservation.post_uuid))
            .where(Post.channel_name == name)
            .order_by(col(ViewObservation.observed_at), col(Post.post_id))
        ).all()
        return [(int(p), int(v), int(ts)) for p, v, ts in rows]


@pytest.mark.parametrize(
    ("stride", "selected"),
    [
        (None, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
        (1, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
        (4, [1, 5, 9]),
    ],
)
def test_only_the_posts_the_stride_selects_are_observed(
    stride: int | None, selected: list[int]
) -> None:
    now = int(time.time() * 1000)
    ts = now - 2 * HOUR_MS
    channel_id, name = _channel(stride)
    ids = range(1, 10)

    # First capture: every Post is new, so each goes through the full upsert.
    _apply(
        channel_id,
        name,
        [_page_post(i, ts, 100) for i in ids],
        retrieval_pass="initial",
    )
    # A later page meets them again and refreshes their counters.
    _apply(
        channel_id,
        name,
        [_page_post(i, ts, 900) for i in ids],
        retrieval_pass="incremental",
    )

    rows = _observations(name)
    assert [p for p, views, _ in rows if views == 100] == selected
    assert [p for p, views, _ in rows if views == 900] == selected
    assert {published for _, _, published in rows} == {ts}


def test_a_post_already_past_the_window_is_not_observed() -> None:
    now = int(time.time() * 1000)
    channel_id, name = _channel()

    _apply(
        channel_id,
        name,
        [
            _page_post(1, now - OBSERVATION_WINDOW_MS - HOUR_MS, 100),
            _page_post(2, now - HOUR_MS, 100),
        ],
        retrieval_pass="initial",
    )

    assert [p for p, _, _ in _observations(name)] == [2]


def test_a_sighting_with_no_view_count_is_not_observed() -> None:
    now = int(time.time() * 1000)
    channel_id, name = _channel()

    _apply(
        channel_id,
        name,
        [_page_post(1, now - HOUR_MS, None), _page_post(2, now - HOUR_MS, 7)],
        retrieval_pass="initial",
    )
    # A refresh stores whatever the page shows, NULL included; a NULL View
    # count is still not a sighting of one.
    _apply(
        channel_id,
        name,
        [_page_post(1, now - HOUR_MS, None), _page_post(2, now - HOUR_MS, None)],
        retrieval_pass="incremental",
    )

    assert _observations(name) == [(2, 7, now - HOUR_MS)]
