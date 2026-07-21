"""Translation reads must not require downloading the whole table.

PostCard needs one translation at a time. Without a single-row endpoint the
frontend pulled every translation — and because saving one bumps the sync
etag, the next read re-downloaded everything.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.data_vectors import DEFAULT_VECTOR_PAGE_SIZE, MAX_VECTOR_PAGE_SIZE

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


def _seed(client: TestClient, headers: dict[str, str], count: int = 5) -> None:
    base = int(time.time() * 1000)
    client.post(
        f"{PREFIX}/translations",
        json=[
            {
                "id": f"ch_{i}_English",
                "channelName": "ch",
                "postId": i,
                "language": "English",
                "translatedText": f"translated {i}",
                "timestamp": base + i,
            }
            for i in range(count)
        ],
        headers=headers,
    )


def test_single_lookup_hit(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.get(
        f"{PREFIX}/translations/one?channelName=ch&postId=2&language=English",
        headers=headers,
    ).json()

    assert body is not None
    assert body["translatedText"] == "translated 2"


def test_single_lookup_miss_returns_null(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    resp = client.get(
        f"{PREFIX}/translations/one?channelName=ch&postId=999&language=English",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() is None


def test_single_lookup_is_language_scoped(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    resp = client.get(
        f"{PREFIX}/translations/one?channelName=ch&postId=2&language=Farsi",
        headers=headers,
    )
    assert resp.json() is None


def test_single_lookup_requires_all_key_parts(client: TestClient) -> None:
    headers = _auth(client)
    resp = client.get(f"{PREFIX}/translations/one?channelName=ch", headers=headers)
    assert resp.status_code == 422


def test_list_respects_limit_and_offset(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, count=6)

    first = client.get(
        f"{PREFIX}/translations?limit=2&offset=0", headers=headers
    ).json()
    second = client.get(
        f"{PREFIX}/translations?limit=2&offset=2", headers=headers
    ).json()

    assert len(first) == 2
    assert len(second) == 2
    assert {r["id"] for r in first}.isdisjoint({r["id"] for r in second})


def test_list_is_newest_first(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, count=5)

    body = client.get(f"{PREFIX}/translations", headers=headers).json()
    timestamps = [r["timestamp"] for r in body]
    assert timestamps == sorted(timestamps, reverse=True)


def test_list_default_limit_applies(client: TestClient) -> None:
    headers = _auth(client)
    body = client.get(f"{PREFIX}/translations", headers=headers).json()
    assert len(body) <= DEFAULT_VECTOR_PAGE_SIZE


def test_list_limit_is_bounded(client: TestClient) -> None:
    headers = _auth(client)
    over = client.get(
        f"{PREFIX}/translations?limit={MAX_VECTOR_PAGE_SIZE + 1}", headers=headers
    )
    assert over.status_code == 422
    assert (
        client.get(f"{PREFIX}/translations?offset=-1", headers=headers).status_code
        == 422
    )


def test_embeddings_list_endpoint_is_gone(client: TestClient) -> None:
    """Removed as dead code — it had no callers and was unbounded."""
    headers = _auth(client)
    assert client.get(f"{PREFIX}/embeddings", headers=headers).status_code == 405
