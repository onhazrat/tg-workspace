"""A Directory entry of a followed Channel answers the Post-based Reach (REACH-04).

The probe stores Reach from one preview page; a Channel anybody follows has
stored Posts whose View counts sync keeps refreshing, and the Channels tab
already shows Reach from those. Answering the stored value here would show one
Channel two ways. The Follow belongs to another Account on purpose: Reach
describes the Channel, so whose Follow it is does not matter.

## Watched to fail

* answer the stored Reach for every entry -> the followed entry reads 50
* match the Channel name without lowercasing it -> the same
* override every entry in the page, followed or not -> the unfollowed entry
  reads the followed Channel's value or not measured
* drop `among` from the follow read -> the page-narrowing case
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services.channel_directory import record_probe_result
from app.services.follows import followed_channel_names
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

DATA = f"{settings.API_V1_STR}/data"
HOUR_MS = 3_600_000
FOLLOWED = "ReachFollowed"


def _probe(handle: str, views: int) -> None:
    """Five samples two days old, so the stored Reach is measured at `views`."""
    now = int(time.time() * 1000)
    samples = [
        {
            "id": i,
            "text": "words",
            "date": "2026-09-27T00:00:00+00:00",
            "timestamp": now - 48 * HOUR_MS - i,
            "channelName": handle,
            "media": {"kinds": [], "viewsCount": views},
        }
        for i in range(1, 6)
    ]
    page = {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "samples": samples,
    }
    with Session(engine) as session:
        record_probe_result(session, handle, page)


def _seed_followed_posts(views: int) -> None:
    with Session(engine) as session:
        other = create_random_user(session)
        add_test_channel(session, FOLLOWED, user_id=other.id)
        for i in range(1, 6):
            session.add(
                Post(
                    channel_name=FOLLOWED,
                    post_id=i,
                    text=f"p{i}",
                    timestamp=1_760_000_000_000 + i,
                    views_count=views,
                    views_observed_at=1_760_000_000_000 + i + 30 * HOUR_MS,
                )
            )
        session.commit()


def test_a_followed_channel_shows_its_post_based_reach(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    _seed_followed_posts(views=300)
    _probe(FOLLOWED.lower(), views=50)
    _probe("reach_unfollowed", views=70)

    rows = client.get(f"{DATA}/discover/probes", headers=superuser_token_headers).json()
    by_handle = {row["handle"]: row for row in rows}

    assert by_handle["reachfollowed"]["reach"] == 300
    assert by_handle["reachfollowed"]["reachEstimated"] is False
    assert by_handle["reach_unfollowed"]["reach"] == 70


def test_the_follow_read_asks_only_about_the_page_it_serves() -> None:
    """One page of entries asks about its own handles, not every followed name."""
    _seed_followed_posts(views=300)
    with Session(engine) as session:
        add_test_channel(session, "elsewhere")

        assert followed_channel_names(session, among={"reachfollowed"}) == {FOLLOWED}
        assert followed_channel_names(session, among=set()) == set()
