"""POST /data/posts as the server-side Posts feed.

Beyond bounded paging (see test_posts_pagination.py), the feed assembles the
whole Posts-tab view server-side: keyword/forwarded/media filters, a per-channel
cap (latest or a deterministic random), and a sort order. This replaces the
browser's eager `filteredPosts`.

It is a POST because the scope carries the channel selection, which can be the
whole account — see `PostScopeRequest`. See test_post_scope_body.py for the
long-selection case that motivated it.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from tests.utils.tenancy import follow_channels

PREFIX = f"{settings.API_V1_STR}/data"


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _feed(
    client: TestClient, headers: dict[str, str], **scope: Any
) -> list[dict[str, Any]]:
    response = client.post(f"{PREFIX}/posts", json=scope, headers=headers)
    assert response.status_code == 200, response.text
    return list(response.json())


def _bulk(client: TestClient, headers: dict[str, str], posts: list[dict]) -> None:
    client.post(f"{PREFIX}/posts/bulk", json=posts, headers=headers)
    # Ticket 21: `POST /data/posts/bulk` writes Posts and creates no Channel and
    # no Follow, so under enforcement every row it writes is invisible — `Post`
    # is `FOLLOW_SCOPED` and the EXISTS has nothing to correlate against. The
    # follow is seeded here rather than in each test because every test in this
    # file reads back what it just posted, which is the case that stops working.
    with Session(engine) as session:
        follow_channels(
            session, *{str(p["channelName"]) for p in posts if p.get("channelName")}
        )


def _seed_channel(
    client: TestClient,
    headers: dict[str, str],
    channel: str,
    count: int,
    base_ts: int,
) -> None:
    _bulk(
        client,
        headers,
        [
            {
                "id": i,
                "channelName": channel,
                "text": f"post {i}",
                "timestamp": base_ts + i,
            }
            for i in range(count)
        ],
    )


def test_keyword_filters_server_side(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _bulk(
        client,
        headers,
        [
            {"id": 1, "channelName": "kw", "text": "bitcoin surge", "timestamp": base},
            {
                "id": 2,
                "channelName": "kw",
                "text": "weather report",
                "timestamp": base + 1,
            },
        ],
    )

    body = _feed(client, headers, channelName="kw", keyword="bitcoin")

    assert [row["id"] for row in body] == [1]


def test_forwarded_filter_server_side(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _bulk(
        client,
        headers,
        [
            {"id": 1, "channelName": "fwd", "text": "a", "timestamp": base},
            {
                "id": 2,
                "channelName": "fwd",
                "text": "b",
                "timestamp": base + 1,
                "forwardedFrom": "someone",
            },
        ],
    )

    body = _feed(client, headers, channelName="fwd", forwarded="forwarded")

    assert [row["id"] for row in body] == [2]


def test_latest_cap_keeps_newest_n_per_channel(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed_channel(client, headers, "feed_a", 5, base)
    _seed_channel(client, headers, "feed_b", 5, base + 100)

    body = _feed(client, headers, channelNames=["feed_a", "feed_b"], maxPerChannel=2)

    by_channel: dict[str, list[int]] = {}
    for row in body:
        by_channel.setdefault(row["channelName"], []).append(row["id"])
    # newest two per channel (ids 4 and 3 given ascending timestamps)
    assert sorted(by_channel["feed_a"]) == [3, 4]
    assert sorted(by_channel["feed_b"]) == [3, 4]


def test_random_cap_is_deterministic_for_a_seed(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed_channel(client, headers, "rnd", 10, base)

    scope: dict[str, Any] = {
        "channelName": "rnd",
        "maxPerChannel": 3,
        "maxPerChannelMode": "random",
        "seed": 7,
    }
    first = _feed(client, headers, **scope)
    second = _feed(client, headers, **scope)

    assert len(first) == 3
    # Same seed -> same posts, so offset paging over it is stable.
    assert {r["id"] for r in first} == {r["id"] for r in second}


def test_random_cap_pages_without_repeats(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed_channel(client, headers, "rndp", 10, base)

    common: dict[str, Any] = {
        "channelName": "rndp",
        "maxPerChannel": 6,
        "maxPerChannelMode": "random",
        "seed": 3,
    }
    page1 = _feed(client, headers, **common, limit=3, offset=0)
    page2 = _feed(client, headers, **common, limit=3, offset=3)

    assert len(page1) == 3
    assert len(page2) == 3
    assert {r["id"] for r in page1}.isdisjoint({r["id"] for r in page2})


def test_channel_time_sort_groups_by_channel(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    # Interleave timestamps so a global "time" sort would alternate channels.
    _bulk(
        client,
        headers,
        [
            {"id": 1, "channelName": "feed_a", "text": "x", "timestamp": base + 1},
            {"id": 2, "channelName": "feed_b", "text": "x", "timestamp": base + 2},
            {"id": 3, "channelName": "feed_a", "text": "x", "timestamp": base + 3},
            {"id": 4, "channelName": "feed_b", "text": "x", "timestamp": base + 4},
        ],
    )

    body = _feed(
        client, headers, channelNames=["feed_a", "feed_b"], sort="channel_time"
    )

    names = [row["channelName"] for row in body]
    # All of one channel's posts come before the other's (grouped, not interleaved).
    assert names == sorted(names)


def test_invalid_sort_and_mode_are_422(client: TestClient) -> None:
    headers = _auth(client)
    assert (
        client.post(
            f"{PREFIX}/posts", json={"sort": "nonsense"}, headers=headers
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{PREFIX}/posts",
            json={"maxPerChannelMode": "nonsense"},
            headers=headers,
        ).status_code
        == 422
    )


def test_channel_names_wins_over_singular_channel_name(client: TestClient) -> None:
    """`channelNames` takes precedence, and an empty one falls through.

    This mirrors the `if channel_names: ... elif channel_name: ...` the query
    string version had, which is easy to lose when moving to a model.
    """
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed_channel(client, headers, "plural", 2, base)
    _seed_channel(client, headers, "singular", 2, base + 100)

    both = _feed(client, headers, channelNames=["plural"], channelName="singular")
    assert {row["channelName"] for row in both} == {"plural"}

    # Empty list is not a selection, so the singular form still applies.
    fallback = _feed(client, headers, channelNames=[], channelName="singular")
    assert {row["channelName"] for row in fallback} == {"singular"}


def test_limit_bounds_are_still_enforced(client: TestClient) -> None:
    """The body must keep the ge/le guards the query params had.

    Without them a caller could ask for an unbounded page, which is the failure
    mode the bounded feed exists to prevent.
    """
    headers = _auth(client)
    assert (
        client.post(f"{PREFIX}/posts", json={"limit": 0}, headers=headers).status_code
        == 422
    )
    assert (
        client.post(
            f"{PREFIX}/posts", json={"limit": 10_000_000}, headers=headers
        ).status_code
        == 422
    )
    assert (
        client.post(f"{PREFIX}/posts", json={"offset": -1}, headers=headers).status_code
        == 422
    )
