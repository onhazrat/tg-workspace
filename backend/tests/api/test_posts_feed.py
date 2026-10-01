"""POST /data/posts as the server-side Posts feed.

Beyond bounded paging (see test_posts_pagination.py), the feed assembles the
whole Posts-tab view server-side: keyword/forwarded/media filters, a per-channel
cap (the first N in the order, or a deterministic random N), an order, and
grouping by channel. This replaces the browser's eager `filteredPosts`.

PFB-01 reshaped the Scope under all of that without changing what an Account
sees, so the old wire values are asserted to answer exactly what their new
spellings do: `media: "all"` and `[]`, one kind and `[kind]`, `latest` and
`ordered`, `time` and `newest`, `channel_time` and `newest` grouped.

It is a POST because the scope carries the channel selection, which can be the
whole account — see `PostScopeRequest`. See test_post_scope_body.py for the
long-selection case that motivated it.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
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

    forwarded = {
        "kind": "atom",
        "id": "f",
        "cond": {"type": "type", "value": "forwarded"},
    }
    tree = {"kind": "group", "id": "root", "op": "and", "children": [forwarded]}
    body = _feed(client, headers, channelName="fwd", filter=tree)

    assert [row["id"] for row in body] == [2]


def test_ordered_cap_keeps_newest_n_per_channel(client: TestClient) -> None:
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


def test_ordered_cap_follows_the_order(client: TestClient) -> None:
    """Under `oldest` the cap keeps each channel's first N in *that* order.

    The reason the mode was renamed rather than reinterpreted: a cap reading
    "newest" while the feed runs oldest first would label the wrong N.
    """
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed_channel(client, headers, "feed_a", 5, base)
    _seed_channel(client, headers, "feed_b", 5, base + 100)

    body = _feed(
        client,
        headers,
        channelNames=["feed_a", "feed_b"],
        maxPerChannel=2,
        maxPerChannelMode="ordered",
        sort="oldest",
    )

    assert [(row["channelName"], row["id"]) for row in body] == [
        ("feed_a", 0),
        ("feed_a", 1),
        ("feed_b", 0),
        ("feed_b", 1),
    ]


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


def _seed_interleaved(client: TestClient, headers: dict[str, str]) -> None:
    """Two channels whose timestamps alternate, and a collision to break."""
    base = int(time.time() * 1000)
    _bulk(
        client,
        headers,
        [
            {"id": 1, "channelName": "feed_a", "text": "x", "timestamp": base + 1},
            {"id": 2, "channelName": "feed_b", "text": "x", "timestamp": base + 2},
            {"id": 3, "channelName": "feed_a", "text": "x", "timestamp": base + 3},
            {"id": 4, "channelName": "feed_b", "text": "x", "timestamp": base + 4},
            {"id": 5, "channelName": "feed_a", "text": "x", "timestamp": base + 4},
        ],
    )


def _keys(rows: list[dict[str, Any]]) -> list[tuple[str, int]]:
    return [(row["channelName"], row["id"]) for row in rows]


def test_grouped_newest_groups_by_channel(client: TestClient) -> None:
    headers = _auth(client)
    _seed_interleaved(client, headers)

    body = _feed(
        client,
        headers,
        channelNames=["feed_a", "feed_b"],
        sort="newest",
        groupByChannel=True,
    )

    # Channels alphabetical, newest first inside: what `channel_time` was.
    assert _keys(body) == [
        ("feed_a", 5),
        ("feed_a", 3),
        ("feed_a", 1),
        ("feed_b", 4),
        ("feed_b", 2),
    ]


def test_oldest_orders_oldest_first_with_the_stable_tiebreak(
    client: TestClient,
) -> None:
    """Nothing in today's panel sends it; the server already answers it."""
    headers = _auth(client)
    _seed_interleaved(client, headers)

    body = _feed(client, headers, channelNames=["feed_a", "feed_b"], sort="oldest")

    # The timestamp collision between feed_a/5 and feed_b/4 breaks on the
    # channel name, as it does under `newest`.
    assert _keys(body) == [
        ("feed_a", 1),
        ("feed_b", 2),
        ("feed_a", 3),
        ("feed_a", 5),
        ("feed_b", 4),
    ]


#: Each pre-PFB-01 wire value beside the new spelling that must answer
#: identically. The cap cases carry a cap so the mode is actually exercised.
LEGACY_EQUIVALENTS: list[tuple[str, dict[str, Any], dict[str, Any]]] = [
    ("sort time", {"sort": "time"}, {"sort": "newest", "groupByChannel": False}),
    (
        "sort channel_time",
        {"sort": "channel_time"},
        {"sort": "newest", "groupByChannel": True},
    ),
    (
        "cap latest",
        {"maxPerChannel": 2, "maxPerChannelMode": "latest"},
        {"maxPerChannel": 2, "maxPerChannelMode": "ordered"},
    ),
    (
        "cap latest grouped",
        {"maxPerChannel": 2, "maxPerChannelMode": "latest", "sort": "channel_time"},
        {
            "maxPerChannel": 2,
            "maxPerChannelMode": "ordered",
            "sort": "newest",
            "groupByChannel": True,
        },
    ),
]


@pytest.mark.parametrize(
    ("old", "new"),
    [(old, new) for _, old, new in LEGACY_EQUIVALENTS],
    ids=[name for name, _, _ in LEGACY_EQUIVALENTS],
)
def test_an_old_wire_value_returns_what_its_new_spelling_does(
    client: TestClient, old: dict[str, Any], new: dict[str, Any]
) -> None:
    """A browser still on the previous bundle sees the same feed until it reloads."""
    headers = _auth(client)
    _seed_interleaved(client, headers)
    _bulk(
        client,
        headers,
        [
            {
                "id": 9,
                "channelName": "feed_a",
                "text": "a photo",
                "timestamp": int(time.time() * 1000) + 9,
                "media": {"kinds": ["photo"]},
            }
        ],
    )
    scope = {"channelNames": ["feed_a", "feed_b"]}

    before = _feed(client, headers, **scope, **old)
    after = _feed(client, headers, **scope, **new)

    assert _keys(before) == _keys(after)
    assert before, "an empty feed would make the parity vacuous"


@pytest.mark.parametrize(
    "body",
    [
        {"sort": "nonsense"},
        {"sort": "most_reach"},
        {"maxPerChannelMode": "nonsense"},
        {"media": ["nonsense"]},
        {"media": "nonsense"},
        {"languages": "fa"},
        {"groupByChannel": "sideways"},
    ],
    ids=lambda body: next(iter(body.items())).__repr__(),
)
def test_a_value_this_server_does_not_implement_is_422(
    client: TestClient, body: dict[str, Any]
) -> None:
    """Refused rather than dropped, for every field of the new shape.

    An order this server does not implement is asking for something it would
    not do. The flat media and Language filters left in PTR-03, so a client
    still sending one speaks a shape this server no longer reads.
    """
    headers = _auth(client)
    assert client.post(f"{PREFIX}/posts", json=body, headers=headers).status_code == 422


@pytest.mark.parametrize("body", [{"media": ["nonsense"]}, {"languages": "fa"}])
def test_the_counts_refuse_what_the_feed_refuses(
    client: TestClient, body: dict[str, Any]
) -> None:
    headers = _auth(client)
    response = client.post(f"{PREFIX}/posts/counts", json=body, headers=headers)
    assert response.status_code == 422


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
