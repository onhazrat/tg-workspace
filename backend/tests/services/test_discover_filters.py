"""Discover honoring the Posts-tab filters + latest cap (step 2 / T4.1).

Discover aggregates over the same filtered/capped set the Posts tab shows, so
these assert the ported filters change which posts feed the aggregation.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.discover import compute_discover_candidates
from app.services.post_filters import PostFilters


def _add(session: Session, post_id: int, **kw: Any) -> None:
    session.add(
        Post(
            channel_name=kw.pop("channel_name", "carrier"),
            post_id=post_id,
            text=kw.pop("text", f"post {post_id}"),
            timestamp=kw.pop("timestamp", 1000 + post_id),
            **kw,
        )
    )


def _totals(result: dict[str, Any]) -> dict[str, int]:
    return {c["name"]: c["total"] for c in result["candidates"]}


def test_keyword_filter_scopes_discovery() -> None:
    with Session(engine) as session:
        _add(session, 1, text="great @alpha_news read", forwarded_from=None)
        _add(session, 2, text="ignore @beta_channel here", forwarded_from=None)
        session.commit()
        # No filter: both mentions discovered.
        allc = compute_discover_candidates(session, channel_names=["carrier"])
        assert set(_totals(allc)) == {"alpha_news", "beta_channel"}
        # Keyword "great" keeps only post 1, so only alpha_news survives.
        scoped = compute_discover_candidates(
            session,
            channel_names=["carrier"],
            filters=PostFilters(keyword="great"),
        )
        assert set(_totals(scoped)) == {"alpha_news"}


def test_forwarded_filter_scopes_discovery() -> None:
    with Session(engine) as session:
        _add(session, 1, text="see @alpha_news", forwarded_from=None)
        _add(session, 2, text="body", forwarded_from="SomeSource")
        session.commit()
        # original-only removes the forwarded post, so its forward ref is gone.
        scoped = compute_discover_candidates(
            session,
            channel_names=["carrier"],
            filters=PostFilters(forwarded="original"),
        )
        assert set(_totals(scoped)) == {"alpha_news"}


def test_latest_cap_limits_posts_per_channel() -> None:
    with Session(engine) as session:
        # 5 posts, newest (higher ts) mention gamma, older mention delta.
        _add(session, 1, text="old @delta_channel", timestamp=100)
        _add(session, 2, text="old @delta_channel", timestamp=200)
        _add(session, 3, text="new @gamma_channel", timestamp=900)
        session.commit()
        capped = compute_discover_candidates(
            session,
            channel_names=["carrier"],
            max_per_channel=1,
        )
        # Only the single newest post is considered.
        assert set(_totals(capped)) == {"gamma_channel"}
        # postsInScope reflects the cap, not the 3 matching posts.
        assert capped["postsInScope"] == 1


def test_no_filters_matches_prior_behavior() -> None:
    with Session(engine) as session:
        _add(session, 1, text="hi @alpha_news")
        session.commit()
        base = compute_discover_candidates(session, channel_names=["carrier"])
        explicit = compute_discover_candidates(
            session,
            channel_names=["carrier"],
            filters=PostFilters(),
            max_per_channel=0,
        )
        assert base == explicit
