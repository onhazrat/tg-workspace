"""Tests for /api/v1/rag search, status, and embedding backfill."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.ai.models import EmbeddingResult
from app.core.config import settings
from app.services import embeddings as embeddings_service

PREFIX = f"{settings.API_V1_STR}/rag"
DATA = f"{settings.API_V1_STR}/data"


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _seed_posts_and_embeddings(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{DATA}/channels/rag-ch",
        json={"name": "rag-ch"},
        headers=headers,
    )
    posts = [
        {
            "id": 1,
            "channelName": "rag-ch",
            "text": "alpha topic",
            "date": "2024-01-01",
            "timestamp": 1000,
        },
        {
            "id": 2,
            "channelName": "rag-ch",
            "text": "beta topic",
            "date": "2024-01-02",
            "timestamp": 2000,
        },
        {
            "id": 3,
            "channelName": "rag-ch",
            "text": "gamma topic",
            "date": "2024-01-03",
            "timestamp": 3000,
        },
    ]
    client.post(f"{DATA}/posts/bulk", json=posts, headers=headers)
    client.post(
        f"{DATA}/embeddings",
        json=[
            {
                "id": "rag-ch_1",
                "channelName": "rag-ch",
                "postId": 1,
                "vector": [1.0, 0.0, 0.0],
                "text": "alpha topic",
                "provider": "gemini",
                "model": "test-embed",
                "dimensions": 3,
            },
            {
                "id": "rag-ch_2",
                "channelName": "rag-ch",
                "postId": 2,
                "vector": [0.8, 0.6, 0.0],
                "text": "beta topic",
                "provider": "gemini",
                "model": "test-embed",
                "dimensions": 3,
            },
            {
                "id": "rag-ch_3",
                "channelName": "rag-ch",
                "postId": 3,
                "vector": [0.0, 1.0, 0.0],
                "text": "gamma topic",
                "provider": "gemini",
                "model": "test-embed",
                "dimensions": 3,
            },
        ],
        headers=headers,
    )


def _mock_provider(vectors: list[list[float]] | None = None) -> AsyncMock:
    provider = AsyncMock()

    async def _embed(texts: list[str], *, model: str) -> EmbeddingResult:
        if vectors is not None:
            out = vectors[: len(texts)]
            while len(out) < len(texts):
                out.append(out[-1] if out else [0.0, 0.0, 0.0])
        else:
            out = [[float(i), 0.1, 0.2] for i in range(len(texts))]
        return EmbeddingResult(
            vectors=out,
            model="test-embed",
            provider="gemini",
            dimensions=len(out[0]) if out else 0,
        )

    provider.embed = AsyncMock(side_effect=_embed)
    return provider


@patch("app.api.routes.rag.settings.GEMINI_API_KEY", "test-key")
@patch("app.api.routes.rag.get_provider")
def test_rag_search_cosine_order_and_post_shape(
    mock_get_provider: AsyncMock,
    client: TestClient,
) -> None:
    _seed_posts_and_embeddings(client)
    mock_get_provider.return_value = _mock_provider([[1.0, 0.0, 0.0]])

    r = client.post(f"{PREFIX}/search", json={"query": "alpha", "limit": 2})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["results"]) == 2
    assert data["results"][0]["postId"] == 1
    assert data["results"][0]["score"] == pytest.approx(1.0)
    post = data["results"][0]["post"]
    assert post["id"] == 1
    assert post["channelName"] == "rag-ch"
    assert post["text"] == "alpha topic"
    assert post["timestamp"] == 1000
    assert "forwardedFrom" in post


@patch("app.api.routes.rag.settings.GEMINI_API_KEY", "test-key")
@patch("app.api.routes.rag.get_provider")
def test_rag_search_date_and_channel_filters(
    mock_get_provider: AsyncMock,
    client: TestClient,
) -> None:
    _seed_posts_and_embeddings(client)
    mock_get_provider.return_value = _mock_provider([[1.0, 0.0, 0.0]])

    r = client.post(
        f"{PREFIX}/search",
        json={
            "query": "topic",
            "channels": ["rag-ch"],
            "startDate": 1500,
            "endDate": 2500,
            "limit": 10,
        },
    )
    assert r.status_code == 200, r.text
    ids = [item["postId"] for item in r.json()["results"]]
    assert ids == [2]


def test_rag_status_pending_and_total(client: TestClient) -> None:
    _seed_posts_and_embeddings(client)
    headers = _auth(client)
    client.post(
        f"{DATA}/posts/bulk",
        json=[
            {
                "id": 4,
                "channelName": "rag-ch",
                "text": "delta without embedding",
                "date": "2024-01-04",
                "timestamp": 4000,
            }
        ],
        headers=headers,
    )

    r = client.get(f"{PREFIX}/status")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] >= 4
    assert data["pending"] >= 1
    assert "lastRun" in data


@patch("app.services.embeddings.settings.GEMINI_API_KEY", "test-key")
@patch("app.services.embeddings.get_provider")
def test_backfill_embeddings_mocked_provider(
    mock_get_provider: AsyncMock,
    client: TestClient,
) -> None:
    headers = _auth(client)
    client.put(f"{DATA}/channels/backfill-ch", json={"name": "backfill-ch"}, headers=headers)
    client.post(
        f"{DATA}/posts/bulk",
        json=[
                {
                    "id": 10,
                    "channelName": "backfill-ch",
                    "text": "needs embedding",
                    "date": "2024-02-01",
                    "timestamp": 9_999_999_999_000,
                },
                {
                    "id": 11,
                    "channelName": "backfill-ch",
                    "text": "also needs embedding",
                    "date": "2024-02-02",
                    "timestamp": 9_999_999_998_000,
                },
        ],
        headers=headers,
    )

    mock_get_provider.return_value = _mock_provider([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])

    embeddings_service._last_backfill_run_ms = None
    with patch("app.api.routes.rag.settings.GEMINI_API_KEY", "test-key"):
        r = client.post(f"{PREFIX}/embed", json={"limit": 2})
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["processed"] == 2
    assert result["upserted"] == 2

    listed = client.get(f"{DATA}/embeddings", headers=headers).json()
    by_id = {e["id"]: e for e in listed}
    assert "backfill-ch_10" in by_id
    assert "backfill-ch_11" in by_id
    emb = by_id["backfill-ch_10"]
    assert emb["provider"] == "gemini"
    assert emb["model"] == "test-embed"
    assert emb["dimensions"] == 3
    assert emb["vector"] == [0.1, 0.2, 0.3]

    status = client.get(f"{PREFIX}/status").json()
    assert status["lastRun"] is not None


def test_cosine_matches_numpy_baseline() -> None:
    from app.api.routes.rag import _cosine

    a = [1.0, 2.0, 3.0]
    b = [4.0, 5.0, 6.0]
    va = np.array(a, dtype=float)
    vb = np.array(b, dtype=float)
    expected = float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb)))
    assert _cosine(a, b) == pytest.approx(expected)
