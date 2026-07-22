"""GET /data/posts as the server-side Posts feed.

Beyond bounded paging (see test_posts_pagination.py), the feed assembles the
whole Posts-tab view server-side: keyword/forwarded/media filters, a per-channel
cap (latest or a deterministic random), and a sort order. This replaces the
browser's eager `filteredPosts`.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.core.config import settings

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


def _bulk(client: TestClient, headers: dict[str, str], posts: list[dict]) -> None:
    client.post(f"{PREFIX}/posts/bulk", json=posts, headers=headers)


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

    body = client.get(
        f"{PREFIX}/posts?channelName=kw&keyword=bitcoin", headers=headers
    ).json()

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

    body = client.get(
        f"{PREFIX}/posts?channelName=fwd&forwarded=forwarded", headers=headers
    ).json()

    assert [row["id"] for row in body] == [2]


def test_latest_cap_keeps_newest_n_per_channel(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed_channel(client, headers, "feed_a", 5, base)
    _seed_channel(client, headers, "feed_b", 5, base + 100)

    body = client.get(
        f"{PREFIX}/posts?channelNames=feed_a,feed_b&maxPerChannel=2",
        headers=headers,
    ).json()

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

    url = f"{PREFIX}/posts?channelName=rnd&maxPerChannel=3&maxPerChannelMode=random&seed=7"
    first = client.get(url, headers=headers).json()
    second = client.get(url, headers=headers).json()

    assert len(first) == 3
    # Same seed -> same posts, so offset paging over it is stable.
    assert {r["id"] for r in first} == {r["id"] for r in second}


def test_random_cap_pages_without_repeats(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed_channel(client, headers, "rndp", 10, base)

    common = (
        f"{PREFIX}/posts?channelName=rndp&maxPerChannel=6"
        "&maxPerChannelMode=random&seed=3"
    )
    page1 = client.get(f"{common}&limit=3&offset=0", headers=headers).json()
    page2 = client.get(f"{common}&limit=3&offset=3", headers=headers).json()

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

    body = client.get(
        f"{PREFIX}/posts?channelNames=feed_a,feed_b&sort=channel_time",
        headers=headers,
    ).json()

    names = [row["channelName"] for row in body]
    # All of one channel's posts come before the other's (grouped, not interleaved).
    assert names == sorted(names)


def test_invalid_sort_and_mode_are_422(client: TestClient) -> None:
    headers = _auth(client)
    assert (
        client.get(f"{PREFIX}/posts?sort=nonsense", headers=headers).status_code == 422
    )
    assert (
        client.get(
            f"{PREFIX}/posts?maxPerChannelMode=nonsense", headers=headers
        ).status_code
        == 422
    )
