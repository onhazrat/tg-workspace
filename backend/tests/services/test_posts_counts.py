"""Per-channel scope counts (T4.2) — SQL GROUP BY replacing client tallying."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.post_filters import PostFilters
from app.services.posts import count_posts_in_scope
from tests.utils.tenancy import ANY_READER


def _add(session: Session, channel: str, post_id: int, **kw: Any) -> None:
    session.add(
        Post(
            channel_name=channel,
            post_id=post_id,
            text=kw.pop("text", f"{channel}-{post_id}"),
            timestamp=kw.pop("timestamp", 1000 + post_id),
            **kw,
        )
    )


def test_counts_group_by_channel() -> None:
    with Session(engine) as session:
        for i in range(3):
            _add(session, "a", i)
        for i in range(5):
            _add(session, "b", i)
        session.commit()
        counts = count_posts_in_scope(
            session, channel_names=["a", "b"], user_id=ANY_READER
        )
        assert counts == {"a": 3, "b": 5}


def test_counts_respect_channel_and_date_scope() -> None:
    with Session(engine) as session:
        _add(session, "a", 1, timestamp=100)
        _add(session, "a", 2, timestamp=500)
        _add(session, "b", 1, timestamp=500)
        session.commit()
        counts = count_posts_in_scope(
            session,
            channel_names=["a"],
            start_date=200,
            end_date=900,
            user_id=ANY_READER,
        )
        assert counts == {"a": 1}


def test_counts_apply_filters() -> None:
    with Session(engine) as session:
        _add(session, "a", 1, text="vpn deal", forwarded_from="src")
        _add(session, "a", 2, text="vpn deal", forwarded_from=None)
        _add(session, "a", 3, text="other", forwarded_from="src")
        session.commit()
        counts = count_posts_in_scope(
            session,
            channel_names=["a"],
            filters=PostFilters(keyword="vpn", forwarded="forwarded"),
            user_id=ANY_READER,
        )
        assert counts == {"a": 1}


def test_counts_clamp_to_max_per_channel() -> None:
    """The cap clamps the number, independent of which posts it would pick."""
    with Session(engine) as session:
        for i in range(10):
            _add(session, "a", i)
        for i in range(3):
            _add(session, "b", i)
        session.commit()
        counts = count_posts_in_scope(
            session, channel_names=["a", "b"], max_per_channel=5, user_id=ANY_READER
        )
        assert counts == {"a": 5, "b": 3}


def test_counts_empty_when_no_match() -> None:
    with Session(engine) as session:
        _add(session, "a", 1, text="nothing")
        session.commit()
        counts = count_posts_in_scope(
            session,
            channel_names=["a"],
            filters=PostFilters(keyword="zzz"),
            user_id=ANY_READER,
        )
        assert counts == {}
