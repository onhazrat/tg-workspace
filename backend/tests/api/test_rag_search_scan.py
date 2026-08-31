"""RAG search: no N+1, no silent truncation, date filter pushed into SQL.

The search loop used to issue one SELECT per embedding (up to
RAG_SCAN_LIMIT_MAX = 5000 per request), cap the scan with no ORDER BY, and
apply the date filter in Python *after* that cap — so a narrow date range
could return almost nothing while matching posts existed just beyond the
arbitrary cut-off.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app.ai.models import EmbeddingResult
from app.core.config import settings
from app.core.db import engine
from app.models_tg import PostEmbedding

PREFIX = f"{settings.API_V1_STR}/rag"
DATA = f"{settings.API_V1_STR}/data"

CHANNEL = "scan-ch"
# Posts are timestamped oldest..newest; the target sits at the OLD end so a
# newest-first scan reaches it only if the date filter runs in SQL.
POST_COUNT = 40
TARGET_ID = 0


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _mock_provider(vectors: list[list[float]]) -> AsyncMock:
    provider = AsyncMock()
    provider.embed.return_value = EmbeddingResult(
        vectors=vectors,
        model="test-embed",
        dimensions=len(vectors[0]),
        provider="gemini",
    )
    return provider


def _seed(client: TestClient) -> None:
    headers = _auth(client)
    client.put(f"{DATA}/channels/{CHANNEL}", json={"name": CHANNEL}, headers=headers)

    # The PUT above already creates the Channel *and* the caller's follow, which
    # is what makes the channel visible under enforcement. This used to stamp
    # `Channel.user_id` by hand afterwards; ticket 22 dropped that column, and
    # the stamp was never what decided visibility anyway.
    client.post(
        f"{DATA}/posts/bulk",
        json=[
            {
                "id": i,
                "channelName": CHANNEL,
                "text": f"post {i}",
                "date": "2024-01-01",
                "timestamp": 1000 + i,
            }
            for i in range(POST_COUNT)
        ],
        headers=headers,
    )

    with Session(engine) as session:
        for i in range(POST_COUNT):
            session.add(
                PostEmbedding(
                    id=f"{CHANNEL}_{i}",
                    channel_name=CHANNEL,
                    post_id=i,
                    # The target is the closest vector to the query below.
                    vector=[1.0, 0.0] if i == TARGET_ID else [0.0, 1.0],
                    text=f"post {i}",
                    provider="gemini",
                    model="test-embed",
                    dimensions=2,
                )
            )
        session.commit()


@pytest.fixture
def seeded(client: TestClient) -> TestClient:
    _seed(client)
    return client


def _search(client: TestClient, **body: object) -> dict:
    headers = _auth(client)
    with (
        patch("app.api.routes.rag.settings.GEMINI_API_KEY", "test-key"),
        patch("app.api.routes.rag.get_provider") as get_provider,
    ):
        get_provider.return_value = _mock_provider([[1.0, 0.0]])
        resp = client.post(
            f"{PREFIX}/search",
            json={"query": "q", "channels": [CHANNEL], **body},
            headers=headers,
        )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_date_filter_finds_matches_beyond_the_scan_cap(seeded: TestClient) -> None:
    """The regression: the target is outside a small newest-first scan window,
    but inside the requested date range. Filtering in SQL finds it; filtering
    in Python after the cap does not."""
    body = _search(
        seeded,
        scanLimit=5,
        startDate=1000 + TARGET_ID,
        endDate=1000 + TARGET_ID,
    )
    ids = [r["postId"] for r in body["results"]]
    assert ids == [TARGET_ID]


def test_date_filter_excludes_out_of_range_posts(seeded: TestClient) -> None:
    body = _search(seeded, startDate=1030, endDate=1035)
    ids = {r["postId"] for r in body["results"]}
    assert ids
    assert all(30 <= i <= 35 for i in ids)


def test_results_are_stable_across_identical_calls(seeded: TestClient) -> None:
    """Without a deterministic ORDER BY the capped scan picked an arbitrary
    DB-order subset, so the same search could answer differently."""
    first = _search(seeded, scanLimit=10)
    second = _search(seeded, scanLimit=10)
    assert [r["postId"] for r in first["results"]] == [
        r["postId"] for r in second["results"]
    ]


def test_truncation_is_reported(seeded: TestClient) -> None:
    capped = _search(seeded, scanLimit=5)
    assert capped["truncated"] is True
    assert capped["scanned"] == 5

    full = _search(seeded, scanLimit=POST_COUNT + 10)
    assert full["truncated"] is False


def test_query_count_does_not_scale_with_scanned_rows(seeded: TestClient) -> None:
    """The N+1: one SELECT per embedding, up to 5000 per request."""
    counts: dict[int, int] = {}

    for scan_limit in (5, 30):
        executed = 0

        def _count(*_args: object, **_kwargs: object) -> None:
            nonlocal executed
            executed += 1

        event.listen(engine, "before_cursor_execute", _count)
        try:
            _search(seeded, scanLimit=scan_limit)
        finally:
            event.remove(engine, "before_cursor_execute", _count)
        counts[scan_limit] = executed

    # Scanning 6x the rows must not cost meaningfully more queries.
    assert counts[30] <= counts[5] + 1, (
        f"query count scales with scanned rows: {counts}"
    )


def test_embedding_without_a_post_row_is_still_returned(seeded: TestClient) -> None:
    """Pre-existing behaviour: an orphan embedding is scored and returned, and
    is not dropped by an unrelated date filter."""
    with Session(engine) as session:
        session.add(
            PostEmbedding(
                id=f"{CHANNEL}_orphan",
                channel_name=CHANNEL,
                post_id=99_999,
                vector=[1.0, 0.0],
                text="orphan",
                provider="gemini",
                model="test-embed",
                dimensions=2,
            )
        )
        session.commit()

    body = _search(seeded, scanLimit=POST_COUNT + 10)
    orphan = [r for r in body["results"] if r["postId"] == 99_999]
    assert orphan, "orphan embedding was dropped"
    assert orphan[0]["post"] is None
