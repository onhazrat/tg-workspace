"""POST /data/posts must stay bounded.

tg_posts holds millions of rows across hundreds of followed channels. The
endpoint had no LIMIT and only optional date bounds, so a bulk follow drove
worker RSS to 3.09 GB on staging and left connections idle-in-transaction for
minutes. See docs/discover-bulk-follow-load-investigation.md.

The route is a POST so the channel selection travels in the body rather than
the request line; the bounds asserted here are unchanged by that move.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.posts import DEFAULT_POST_PAGE_SIZE, MAX_POST_PAGE_SIZE
from tests.utils.tenancy import follow_channels

PREFIX = f"{settings.API_V1_STR}/data"
CHANNEL = "pagination_ch"


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
    client: TestClient, headers: dict[str, str], **scope: object
) -> list[dict[str, object]]:
    response = client.post(f"{PREFIX}/posts", json=scope, headers=headers)
    assert response.status_code == 200, response.text
    return list(response.json())


def _seed(
    client: TestClient,
    headers: dict[str, str],
    count: int,
    base_ts: int,
    channel: str = CHANNEL,
) -> None:
    client.post(
        f"{PREFIX}/posts/bulk",
        json=[
            {
                "id": i,
                "channelName": channel,
                "text": f"post {i}",
                # ascending timestamps so the newest is the highest index
                "timestamp": base_ts + i,
            }
            for i in range(count)
        ],
        headers=headers,
    )
    # Ticket 21: `POST /data/posts/bulk` creates no Channel and no Follow, so
    # under enforcement the rows it writes are invisible — `Post` is
    # `FOLLOW_SCOPED` and the EXISTS has nothing to correlate against.
    with Session(engine) as session:
        follow_channels(session, channel)


def test_returns_newest_first(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed(client, headers, 5, base)

    body = _feed(client, headers, channelName=CHANNEL)

    timestamps = [row["timestamp"] for row in body]
    assert timestamps == sorted(timestamps, reverse=True), "not newest-first"


def test_limit_caps_returned_rows(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, 12, int(time.time() * 1000))

    body = _feed(client, headers, channelName=CHANNEL, limit=3)
    assert len(body) == 3


def test_offset_pages_through_without_repeats(client: TestClient) -> None:
    """Deterministic ordering is what makes offset paging safe."""
    headers = _auth(client)
    _seed(client, headers, 6, int(time.time() * 1000))

    first = _feed(client, headers, channelName=CHANNEL, limit=2, offset=0)
    second = _feed(client, headers, channelName=CHANNEL, limit=2, offset=2)

    assert len(first) == 2
    assert len(second) == 2
    assert {r["id"] for r in first}.isdisjoint({r["id"] for r in second})


def test_paging_covers_every_row_exactly_once(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, 7, int(time.time() * 1000))

    seen: list[int] = []
    for offset in range(0, 8, 2):
        page = _feed(client, headers, channelName=CHANNEL, limit=2, offset=offset)
        seen.extend(row["id"] for row in page)

    assert sorted(seen) == list(range(7))


def test_date_bounds_still_apply(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed(client, headers, 10, base)

    body = _feed(
        client, headers, channelName=CHANNEL, startDate=base + 3, endDate=base + 5
    )

    assert sorted(row["id"] for row in body) == [3, 4, 5]


def test_response_is_a_bare_list(client: TestClient) -> None:
    """The frontend consumes Post[]; keep the shape unchanged."""
    headers = _auth(client)
    body = _feed(client, headers)
    assert isinstance(body, list)


def test_default_limit_applies_without_params(client: TestClient) -> None:
    headers = _auth(client)
    body = _feed(client, headers)
    assert len(body) <= DEFAULT_POST_PAGE_SIZE


def test_limit_is_bounded(client: TestClient) -> None:
    """An unbounded limit would reintroduce the incident."""
    headers = _auth(client)
    over = client.post(
        f"{PREFIX}/posts", json={"limit": MAX_POST_PAGE_SIZE + 1}, headers=headers
    )
    assert over.status_code == 422

    assert (
        client.post(f"{PREFIX}/posts", json={"limit": 0}, headers=headers).status_code
        == 422
    )
    assert (
        client.post(f"{PREFIX}/posts", json={"offset": -1}, headers=headers).status_code
        == 422
    )
