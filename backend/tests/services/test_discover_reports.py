"""Saved Discover reports (IDEA-011 W1).

The behaviours worth pinning are the two that define a report as an *artifact*
rather than a view: it does not change when the corpus or the selection changes,
and its follow state is nonetheless always live.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.discover_reports import (
    create_report,
    delete_report,
    get_report,
    latest_report,
    list_reports,
)
from app.services.post_filters import PostFilters
from tests.utils.setting_groups import add_test_channel


def _post(
    post_id: int,
    channel_name: str,
    timestamp: int,
    *,
    text: str | None = None,
    forwarded_from: str | None = None,
) -> Post:
    return Post(
        channel_name=channel_name,
        post_id=post_id,
        text=text if text is not None else f"Post {post_id}",
        timestamp=timestamp,
        forwarded_from=forwarded_from,
    )


def _seed(session: Session, posts: list[Post]) -> None:
    for p in posts:
        session.add(p)
    session.commit()


def _create(session: Session, **overrides: Any) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "channel_names": ["carrier"],
        "start_date": None,
        "end_date": None,
        "signals": None,
        "filters": PostFilters(),
        "max_per_channel": 0,
    }
    kwargs.update(overrides)
    return create_report(session, **kwargs)


def test_generating_saves_a_readable_report() -> None:
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])

        created = _create(session)

        assert created["candidateCount"] == 1
        assert created["candidates"][0]["name"] == "alpha_news"
        assert created["postsInScope"] == 1

        fetched = get_report(session, created["id"])
        assert fetched["candidates"] == created["candidates"]


def test_report_freezes_its_scope() -> None:
    """The scope is a snapshot of the inputs, not a pointer to live state."""
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])

        created = _create(
            session,
            channel_names=["carrier"],
            start_date=500,
            end_date=1500,
            signals={"forward"},
            filters=PostFilters(keyword="hello", forwarded="forwarded"),
            max_per_channel=25,
        )

        scope = created["scope"]
        assert scope["channels"] == ["carrier"]
        assert scope["startDate"] == 500
        assert scope["endDate"] == 1500
        assert scope["signals"] == ["forward"]
        assert scope["keyword"] == "hello"
        assert scope["forwarded"] == "forwarded"
        assert scope["maxPerChannel"] == 25


def test_new_posts_do_not_change_an_existing_report() -> None:
    """A report records what was true when it ran. Later scraping cannot edit it."""
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])
        created = _create(session)
        assert created["candidateCount"] == 1

        # The corpus grows after the report was generated.
        _seed(session, [_post(2, "carrier", 2000, forwarded_from="beta_daily")])

        refetched = get_report(session, created["id"])
        assert refetched["candidateCount"] == 1
        assert [c["name"] for c in refetched["candidates"]] == ["alpha_news"]

        # ...but a *new* report sees the new post.
        fresh = _create(session)
        assert fresh["candidateCount"] == 2
        assert fresh["id"] != created["id"]


def test_is_followed_is_live_not_frozen() -> None:
    """Counts are historical; follow state is resolved on every read."""
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])

        created = _create(session)
        assert created["candidates"][0]["isFollowed"] is False

        # Follow the candidate *after* the report was saved.
        add_test_channel(session, "alpha_news", name="alpha_news")
        session.commit()

        refetched = get_report(session, created["id"])
        assert refetched["candidates"][0]["isFollowed"] is True


def test_is_followed_matches_case_insensitively() -> None:
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="Alpha_News")])
        created = _create(session)
        add_test_channel(session, "alpha_news", name="alpha_news")
        session.commit()

        refetched = get_report(session, created["id"])
        assert refetched["candidates"][0]["isFollowed"] is True


def test_full_candidate_tail_is_persisted() -> None:
    """`minTotal` stays a view filter; nothing is dropped at save time."""
    with Session(engine) as session:
        _seed(
            session,
            [
                _post(1, "carrier", 1000, forwarded_from="alpha_news"),
                _post(2, "carrier", 1100, forwarded_from="alpha_news"),
                # Referenced exactly once — the tail D10 would page away.
                _post(3, "carrier", 1200, forwarded_from="one_hit_wonder"),
            ],
        )

        created = _create(session)
        names = {c["name"] for c in created["candidates"]}
        assert "one_hit_wonder" in names
        assert created["candidateCount"] == 2


def test_list_omits_candidates_but_reports_the_count() -> None:
    """The list projection must never ship the corpus-sized field."""
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])
        _create(session)

        rows = list_reports(session)
        assert len(rows) == 1
        assert "candidates" not in rows[0]
        assert rows[0]["candidateCount"] == 1


def test_latest_returns_the_newest_report_or_none() -> None:
    with Session(engine) as session:
        assert latest_report(session) is None

        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])
        first = _create(session)
        _seed(session, [_post(2, "carrier", 2000, forwarded_from="beta_daily")])
        second = _create(session)

        newest = latest_report(session)
        assert newest is not None
        assert newest["id"] == second["id"]
        assert newest["id"] != first["id"]


def test_list_is_newest_first() -> None:
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])
        first = _create(session)
        second = _create(session)

        rows = list_reports(session)
        assert [r["id"] for r in rows] == [second["id"], first["id"]]


def test_search_matches_scope_channels() -> None:
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])
        _create(session, channel_names=["carrier"])
        _create(session, channel_names=["somewhere_else"])

        rows = list_reports(session, search="carrier")
        assert len(rows) == 1
        assert rows[0]["scope"]["channels"] == ["carrier"]


def test_delete_removes_the_report() -> None:
    with Session(engine) as session:
        _seed(session, [_post(1, "carrier", 1000, forwarded_from="alpha_news")])
        created = _create(session)

        delete_report(session, created["id"])

        assert list_reports(session) == []
        with pytest.raises(HTTPException) as excinfo:
            get_report(session, created["id"])
        assert excinfo.value.status_code == 404


def test_missing_report_raises_404() -> None:
    with Session(engine) as session:
        with pytest.raises(HTTPException) as excinfo:
            get_report(session, "does-not-exist")
        assert excinfo.value.status_code == 404
