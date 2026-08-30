"""POST /data/posts/lookup resolves specific posts by natural key.

Without it, callers that need one known post (a citation hover, a RAG context
row) fetched the whole channel history and filtered client-side.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.posts import MAX_POST_LOOKUP_BATCH
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


def _seed(client: TestClient, headers: dict[str, str]) -> None:
    base = int(time.time() * 1000)
    client.post(
        f"{PREFIX}/posts/bulk",
        json=[
            {
                "id": i,
                "channelName": channel,
                "text": f"{channel}-{i}",
                "timestamp": base + i,
            }
            for channel in ("alpha", "beta")
            for i in range(5)
        ],
        headers=headers,
    )
    # Ticket 21: `POST /data/posts/bulk` creates no Channel and no Follow, so
    # under enforcement the rows it writes are invisible — `Post` is
    # `FOLLOW_SCOPED` and the EXISTS has nothing to correlate against.
    with Session(engine) as session:
        follow_channels(session, "alpha", "beta")


def test_returns_exactly_the_requested_posts(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.post(
        f"{PREFIX}/posts/lookup",
        json={
            "posts": [
                {"channelName": "alpha", "postId": 1},
                {"channelName": "beta", "postId": 3},
            ]
        },
        headers=headers,
    ).json()

    assert {(r["channelName"], r["id"]) for r in body} == {("alpha", 1), ("beta", 3)}


def test_same_post_id_in_different_channels_is_disambiguated(
    client: TestClient,
) -> None:
    """post_id alone is not unique — the channel is part of the key."""
    headers = _auth(client)
    _seed(client, headers)

    body = client.post(
        f"{PREFIX}/posts/lookup",
        json={"posts": [{"channelName": "alpha", "postId": 2}]},
        headers=headers,
    ).json()

    assert len(body) == 1
    assert body[0]["channelName"] == "alpha"
    assert body[0]["text"] == "alpha-2"


def test_unknown_pairs_are_ignored(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.post(
        f"{PREFIX}/posts/lookup",
        json={
            "posts": [
                {"channelName": "alpha", "postId": 0},
                {"channelName": "alpha", "postId": 9999},
                {"channelName": "nonexistent", "postId": 1},
            ]
        },
        headers=headers,
    ).json()

    assert {(r["channelName"], r["id"]) for r in body} == {("alpha", 0)}


def test_empty_batch_returns_empty_list(client: TestClient) -> None:
    headers = _auth(client)
    resp = client.post(f"{PREFIX}/posts/lookup", json={"posts": []}, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_duplicate_refs_are_collapsed(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.post(
        f"{PREFIX}/posts/lookup",
        json={
            "posts": [
                {"channelName": "alpha", "postId": 1},
                {"channelName": "alpha", "postId": 1},
            ]
        },
        headers=headers,
    ).json()

    assert len(body) == 1


def test_over_cap_batch_is_rejected(client: TestClient) -> None:
    """The cap keeps this from becoming another unbounded read."""
    headers = _auth(client)
    resp = client.post(
        f"{PREFIX}/posts/lookup",
        json={
            "posts": [
                {"channelName": "alpha", "postId": i}
                for i in range(MAX_POST_LOOKUP_BATCH + 1)
            ]
        },
        headers=headers,
    )
    assert resp.status_code == 422


def test_at_cap_batch_is_accepted(client: TestClient) -> None:
    headers = _auth(client)
    resp = client.post(
        f"{PREFIX}/posts/lookup",
        json={
            "posts": [
                {"channelName": "alpha", "postId": i}
                for i in range(MAX_POST_LOOKUP_BATCH)
            ]
        },
        headers=headers,
    )
    assert resp.status_code == 200


def test_requires_auth(client: TestClient) -> None:
    resp = client.post(f"{PREFIX}/posts/lookup", json={"posts": []})
    assert resp.status_code == 401
