"""`POST /data/posts` pages; omitting `limit` does not mean "everything" (A2).

The JSONL post export called the feed with no `limit` and treated the result as
the complete set. It is not: `PostFeedRequest.limit` defaults to
``DEFAULT_POST_PAGE_SIZE`` (500), so any account with more posts than that
exported a silently truncated file — while the IndexedDB branch of the same
function exported everything. The two branches disagreed by however many posts
the operator had.

These tests pin the endpoint behaviour the client now has to page against,
rather than the client's old assumption about it.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services.posts import DEFAULT_POST_PAGE_SIZE, MAX_POST_PAGE_SIZE
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"


def _seed(count: int, channel: str = "alpha") -> None:
    with Session(engine) as session:
        for i in range(1, count + 1):
            session.add(
                Post(
                    channel_name=channel,
                    post_id=i,
                    text=f"post {i}",
                    timestamp=1_000 + i,
                )
            )
        session.commit()


def _feed(
    client: TestClient, headers: dict[str, str], **body: Any
) -> list[dict[str, Any]]:
    r = client.post(
        f"{PREFIX}/posts",
        headers=headers,
        json={"channelNames": ["alpha"], **body},
    )
    assert r.status_code == 200, r.text
    return list(r.json())


def test_omitting_limit_returns_one_default_page_not_everything(
    client: TestClient,
) -> None:
    """The bug A2 fixes, stated as a fact about the endpoint."""
    headers = get_superuser_token_headers(client)
    _seed(DEFAULT_POST_PAGE_SIZE + 100)

    rows = _feed(client, headers)

    assert len(rows) == DEFAULT_POST_PAGE_SIZE
    assert len(rows) < DEFAULT_POST_PAGE_SIZE + 100


def test_paging_with_offset_reaches_every_row_exactly_once(
    client: TestClient,
) -> None:
    """What the export must do instead: page until a short page arrives."""
    headers = get_superuser_token_headers(client)
    total = 250
    _seed(total)

    page_size = 100
    seen: list[int] = []
    offset = 0
    while True:
        page = _feed(client, headers, limit=page_size, offset=offset)
        seen.extend(int(p["id"]) for p in page)
        if len(page) < page_size:
            break
        offset += page_size

    assert len(seen) == total
    assert len(set(seen)) == total, "offset paging repeated or skipped rows"
    assert set(seen) == set(range(1, total + 1))


def test_a_short_page_signals_the_end(client: TestClient) -> None:
    """The loop's termination condition — fewer rows than asked for."""
    headers = get_superuser_token_headers(client)
    _seed(30)
    assert len(_feed(client, headers, limit=100, offset=0)) == 30


def test_an_exact_multiple_needs_one_more_request(client: TestClient) -> None:
    """The off-by-one an export loop gets wrong: when the row count is an exact
    multiple of the page size, the final full page is not the last request —
    an empty page follows it."""
    headers = get_superuser_token_headers(client)
    _seed(100)

    first = _feed(client, headers, limit=100, offset=0)
    second = _feed(client, headers, limit=100, offset=100)

    assert len(first) == 100
    assert second == []


def test_the_page_size_is_capped(client: TestClient) -> None:
    """An export cannot dodge paging by asking for one enormous page."""
    headers = get_superuser_token_headers(client)
    _seed(10)
    r = client.post(
        f"{PREFIX}/posts",
        headers=get_superuser_token_headers(client),
        json={"channelNames": ["alpha"], "limit": MAX_POST_PAGE_SIZE + 1},
    )
    assert r.status_code == 422
    assert len(_feed(client, headers, limit=MAX_POST_PAGE_SIZE)) == 10
