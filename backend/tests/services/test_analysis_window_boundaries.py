"""AW-01: one half-open Analysis window, on every path that selects Posts.

The window is `start <= timestamp < end`. The exclusive end is the whole
point: two adjacent windows must meet without sharing a Post, or dividing a
period double-counts its boundary, and a Fixed End displayed as 02:00 must mean
the instant 02:00:00.000 rather than "02:00 and the rest of that minute"
(ADR-018).

**Why one file rather than a boundary case added to each path's own suite.**
The comparison existed as five independent copies — the feed, the counts,
Discover, semantic search and auto-regeneration — every one of them inclusive.
Fixing any one of them alone leaves the same Scope meaning different things on
different paths, which is worse than a consistently wrong end. So one fixture
is read through all of them here, and a companion guard
(`test_analysis_window_single_source.py`) fails any sixth comparison written
somewhere new.

The auto-regeneration path gets its own seeding because it is where the
double-count was not academic: a regenerated Summary starts at exactly the
previous one's `end_date`, so an inclusive end put any Post landing on that
millisecond into both Summaries.

## Mutation evidence

Watched to fail, one change at a time: restoring `<=` in
`post_filters.analysis_window_clauses` turns every test below red except the
ones asserting the open-ended and start-boundary cases, which is the shape you
want — a guard that cannot distinguish the two ends is not guarding the end.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.ai.models import EmbeddingResult
from app.core.config import settings
from app.core.db import engine
from app.core.secrets import encrypt_token
from app.jobs import auto_summary
from app.models import User
from app.models_tg import AICredential, Post, PostEmbedding, Summary, utc_now
from app.services.discover import compute_discover_candidates
from app.services.post_filters import PostFilters
from app.services.posts import count_posts_in_scope, list_feed
from app.services.prompt_assembly import PromptScope, assemble_posts_text
from tests.utils.user import create_random_user

API = settings.API_V1_STR

#: A round, realistic pair. The absolute values do not matter; that the posts
#: sit exactly on, either side of, and one millisecond inside them does.
START = 1_700_000_000_000
END = START + 3_600_000
MID = START + 1_800_000

#: `post_id -> timestamp`, spanning both boundaries.
SEEDED: dict[int, int] = {
    1: START - 1,
    2: START,
    3: MID,
    4: END - 1,
    5: END,
    6: END + 1,
}

#: What a half-open `[START, END)` selects: the start boundary is in, the end
#: boundary is out, and the millisecond before the end is in.
IN_WINDOW = {2, 3, 4}


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{API}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def operator(session: Session) -> User:
    """The account the fixture below belongs to.

    The seeding runs through the API so the Channel and the caller's Follow are
    created the way a real account gets them, which is what makes the rows
    visible to the service calls under the tenancy seam. That means the owner is
    the superuser rather than a throwaway account, and every path here has to
    read as the same one — a window test that quietly read a different account's
    rows would pass on an empty result set.
    """
    return session.exec(
        select(User).where(col(User.email) == settings.FIRST_SUPERUSER)
    ).one()


@pytest.fixture
def channel(client: TestClient, session: Session) -> str:
    """Six Posts straddling both boundaries, plus an embedding for each."""
    name = f"aw01-{uuid.uuid4().hex[:8]}"
    headers = _auth(client)
    client.put(f"{API}/data/channels/{name}", json={"name": name}, headers=headers)
    client.post(
        f"{API}/data/posts/bulk",
        json=[
            {
                "id": post_id,
                "channelName": name,
                "text": f"post {post_id}",
                "date": "2023-11-14",
                "timestamp": ts,
            }
            for post_id, ts in SEEDED.items()
        ],
        headers=headers,
    )
    for post_id in SEEDED:
        session.add(
            PostEmbedding(
                id=f"{name}_{post_id}",
                channel_name=name,
                post_id=post_id,
                # Identical vectors: the ranking is not what is under test, and
                # a tie leaves the date predicate as the only thing that can
                # change which rows come back.
                vector=[1.0, 0.0],
                text=f"post {post_id}",
                provider="gemini",
                model="test-embed",
                dimensions=2,
            )
        )
    session.commit()
    return name


# --------------------------------------------------------------------------
# The feed, in both of its query shapes
# --------------------------------------------------------------------------


def test_the_feed_excludes_a_post_sitting_exactly_on_the_end(
    session: Session, operator: User, channel: str
) -> None:
    rows = list_feed(
        session,
        user_id=operator.id,
        channel_names=[channel],
        start_date=START,
        end_date=END,
    )

    assert {r["id"] for r in rows} == IN_WINDOW


def test_the_capped_feed_excludes_it_too(
    session: Session, operator: User, channel: str
) -> None:
    """A capped feed is a different query: `row_number()` over a subquery.

    The window predicate sits on the base select, inside that subquery, so the
    cap ranks only rows the window admits. Applied outside it, the post on the
    end boundary would consume a cap slot before being discarded.
    """
    rows = list_feed(
        session,
        user_id=operator.id,
        channel_names=[channel],
        start_date=START,
        end_date=END,
        max_per_channel=10,
    )

    assert {r["id"] for r in rows} == IN_WINDOW


def test_an_open_ended_window_keeps_everything_after_the_start(
    session: Session, operator: User, channel: str
) -> None:
    """`None` is that side left open, and the start stays inclusive."""
    rows = list_feed(
        session, user_id=operator.id, channel_names=[channel], start_date=START
    )

    assert {r["id"] for r in rows} == {2, 3, 4, 5, 6}


def test_two_adjacent_windows_share_no_post(
    session: Session, operator: User, channel: str
) -> None:
    """The reason for the exclusive end, stated as the property it buys.

    Splitting `[START, END+2)` at `END` must partition the Posts, not overlap
    them. With an inclusive end the post at `END` lands in both halves, which
    is exactly what double-counts a boundary when a period is divided.
    """
    first = {
        r["id"]
        for r in list_feed(
            session,
            user_id=operator.id,
            channel_names=[channel],
            start_date=START,
            end_date=END,
        )
    }
    second = {
        r["id"]
        for r in list_feed(
            session,
            user_id=operator.id,
            channel_names=[channel],
            start_date=END,
            end_date=END + 2,
        )
    }

    assert first & second == set()
    assert first | second == {2, 3, 4, 5, 6}


# --------------------------------------------------------------------------
# The counts, which decide whether a selection is refused
# --------------------------------------------------------------------------


def test_the_counts_agree_with_the_feed_on_the_boundary(
    session: Session, operator: User, channel: str
) -> None:
    """The AI paths sum these to decide whether a selection fits one prompt.

    A count that admitted one more post than the feed assembles would refuse a
    selection that would have fitted, so the two have to answer the same
    question at the boundary as well as in the middle.
    """
    counts = count_posts_in_scope(
        session,
        user_id=operator.id,
        channel_names=[channel],
        start_date=START,
        end_date=END,
    )

    assert counts == {channel: len(IN_WINDOW)}


# --------------------------------------------------------------------------
# Prompt assembly
# --------------------------------------------------------------------------


def test_the_assembled_prompt_stops_before_the_end(
    session: Session, operator: User, channel: str
) -> None:
    text = assemble_posts_text(
        session,
        PromptScope(channels=[channel], start_date=START, end_date=END),
        user_id=operator.id,
    )

    assert {post_id for post_id in SEEDED if f"ID: {post_id}\n" in text} == IN_WINDOW


# --------------------------------------------------------------------------
# Discovery aggregation
# --------------------------------------------------------------------------


def test_discovery_aggregates_over_the_same_window(
    session: Session, operator: User, channel: str
) -> None:
    result = compute_discover_candidates(
        session,
        user_id=operator.id,
        channel_names=[channel],
        start_date=START,
        end_date=END,
        filters=PostFilters(),
    )

    assert result["postsInScope"] == len(IN_WINDOW)


# --------------------------------------------------------------------------
# Semantic retrieval
# --------------------------------------------------------------------------


def _mock_provider() -> AsyncMock:
    provider = AsyncMock()
    provider.embed.return_value = EmbeddingResult(
        vectors=[[1.0, 0.0]],
        model="test-embed",
        dimensions=2,
        provider="gemini",
    )
    return provider


def test_semantic_retrieval_uses_the_same_window(
    client: TestClient, channel: str
) -> None:
    """The retrieval reads a different table and had its own copy of the rule.

    It joins `tg_post_embeddings` to `tg_posts` and applied the date predicate
    to the joined Post, so it was the copy furthest from the feed's and the
    likeliest to drift.

    The Key is patched as well as the Provider. `resolve_ai_key` runs *before*
    `get_provider` and answers 503 on a deployment with no Key, so stubbing
    only the Provider passes on a developer machine whose `.env` carries a real
    one and 503s in CI, where `.env.example` ships the field empty.
    """
    with (
        patch("app.api.routes.rag.settings.GEMINI_API_KEY", "test-key"),
        patch("app.api.routes.rag.get_provider") as get_provider,
    ):
        get_provider.return_value = _mock_provider()
        resp = client.post(
            f"{API}/rag/search",
            json={
                "query": "q",
                "channels": [channel],
                "startDate": START,
                "endDate": END,
                "limit": 50,
            },
            headers=_auth(client),
        )

    assert resp.status_code == 200, resp.text
    assert {r["postId"] for r in resp.json()["results"]} == IN_WINDOW


def test_semantic_retrieval_refuses_to_mean_all_time(client: TestClient) -> None:
    """The window is not optional on this path any more (AW-01).

    Omitting it used to mean "every Post ever", which is how one Posts path
    silently meant all time while the rest of Scope meant a window. The client
    control that asked for it is gone; this is the half that cannot be talked
    out of.
    """
    resp = client.post(
        f"{API}/rag/search",
        json={"query": "q", "limit": 10},
        headers=_auth(client),
    )

    assert resp.status_code == 422, resp.text


# --------------------------------------------------------------------------
# Auto-regeneration, where the double-count was real
# --------------------------------------------------------------------------


def _stub_provider(text: str = "regenerated") -> AsyncMock:
    provider = AsyncMock()
    provider.complete.return_value = MagicMock(
        text=text, model_dump=lambda: {"text": text}
    )
    return provider


@pytest.fixture
def regen_owner(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    session.add(
        AICredential(
            id=f"key-{uuid.uuid4().hex[:8]}",
            user_id=created.id,
            label="a key",
            provider="openai_compatible",
            base_url="https://regen.example/v1",
            key_encrypted=encrypt_token("sk-aw01"),
            last_validated=int(utc_now().timestamp() * 1000),
        )
    )
    session.commit()
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def test_a_regenerated_summary_does_not_reclaim_its_predecessors_last_post(
    session: Session, regen_owner: User
) -> None:
    """The concrete cost of an inclusive end, on the one unattended path.

    `_regenerate_one` sets `new_start = summary.end_date`, so the successor
    window begins exactly where its predecessor ended. With an inclusive end a
    Post landing on that millisecond was summarised twice — counted in the
    Summary that closed at it and again in the one that opened there.

    The Channel here is deliberately **not** followed, so the scheduler's
    freshness pass finds nothing stale and the test never reaches the scraper.
    """
    name = f"aw01-regen-{uuid.uuid4().hex[:8]}"
    for post_id, ts in SEEDED.items():
        session.add(
            Post(
                channel_name=name,
                post_id=post_id,
                text=f"post {post_id}",
                timestamp=ts,
            )
        )
    duration = END - START
    session.add(
        Summary(
            id=f"sum-{uuid.uuid4().hex[:8]}",
            user_id=regen_owner.id,
            text="the predecessor",
            channels=[name],
            # Ends where the regenerated window starts, so the successor covers
            # exactly `[START, END)`.
            start_date=START - duration,
            end_date=START,
            language="English",
            post_count=0,
            timestamp=int(time.time() * 1000),
            extra={"autoRegenerate": True},
        )
    )
    session.commit()

    with patch.object(auto_summary, "get_provider", return_value=_stub_provider()):
        asyncio.run(auto_summary.run_auto_summary())

    with Session(engine) as check:
        regenerated = check.exec(
            select(Summary).where(
                col(Summary.user_id) == regen_owner.id,
                col(Summary.start_date) == START,
            )
        ).one()

    assert regenerated.post_count == len(IN_WINDOW), (
        "the Post on the shared boundary belongs to the window that starts "
        "there and to no other"
    )


def test_the_regenerated_summary_carries_no_ignore_window_flag(
    session: Session, regen_owner: User
) -> None:
    """The removed option must not survive as a key copied forward forever.

    `_regenerate_one` spreads the predecessor's `extra` onto its successor, so
    a flag left in that list keeps reappearing on rows created long after the
    control that set it was deleted.
    """
    name = f"aw01-flag-{uuid.uuid4().hex[:8]}"
    session.add(Post(channel_name=name, post_id=1, text="p", timestamp=MID))
    duration = END - START
    session.add(
        Summary(
            id=f"sum-{uuid.uuid4().hex[:8]}",
            user_id=regen_owner.id,
            text="the predecessor",
            channels=[name],
            start_date=START - duration,
            end_date=START,
            language="English",
            post_count=0,
            timestamp=int(time.time() * 1000),
            extra={
                "autoRegenerate": True,
                "semanticSearchRespectsTimeRange": False,
            },
        )
    )
    session.commit()

    with patch.object(auto_summary, "get_provider", return_value=_stub_provider()):
        asyncio.run(auto_summary.run_auto_summary())

    with Session(engine) as check:
        regenerated = check.exec(
            select(Summary).where(
                col(Summary.user_id) == regen_owner.id,
                col(Summary.start_date) == START,
            )
        ).one()

    extra: dict[str, Any] = regenerated.extra or {}
    assert "semanticSearchRespectsTimeRange" not in extra
