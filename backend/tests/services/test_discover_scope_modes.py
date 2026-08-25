"""Discover over the two scopes that used to require a client-side aggregation.

Before IDEA-011 D14 a `random` per-channel cap and a semantic query each fell
back to `computeDiscoveryCandidates` in the browser, so the counting rules had
two implementations. These cover the server reproducing both.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.discover import compute_discover_candidates
from app.services.discover_reports import create_report
from app.services.post_filters import PostFilters
from tests.utils.tenancy import ANY_READER


def _post(post_id: int, forwarded_from: str, timestamp: int) -> Post:
    return Post(
        channel_name="carrier",
        post_id=post_id,
        text=f"Post {post_id}",
        timestamp=timestamp,
        forwarded_from=forwarded_from,
    )


def _seed_posts(session: Session, count: int = 12) -> None:
    for i in range(count):
        session.add(_post(i, f"source_{i:02d}", 1000 + i))
    session.commit()


def _run(session: Session, **kwargs: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"channel_names": ["carrier"]}
    base.update(kwargs)
    return compute_discover_candidates(session, **base, user_id=ANY_READER)


# --- random per-channel cap ------------------------------------------------


def test_random_cap_limits_posts_per_channel() -> None:
    with Session(engine) as session:
        _seed_posts(session)
        result = _run(session, max_per_channel=4, max_per_channel_mode="random", seed=7)
        assert result["postsInScope"] == 4


def test_random_cap_is_stable_for_a_seed() -> None:
    """The same seed must select the same posts, or a saved report is a lie."""
    with Session(engine) as session:
        _seed_posts(session)
        first = _run(session, max_per_channel=4, max_per_channel_mode="random", seed=7)
        second = _run(session, max_per_channel=4, max_per_channel_mode="random", seed=7)
        assert [c["name"] for c in first["candidates"]] == [
            c["name"] for c in second["candidates"]
        ]


def test_random_cap_differs_from_latest_cap() -> None:
    """Otherwise the mode is not actually being applied."""
    with Session(engine) as session:
        _seed_posts(session, count=30)
        latest = _run(session, max_per_channel=5, max_per_channel_mode="latest")
        random_pick = _run(
            session, max_per_channel=5, max_per_channel_mode="random", seed=3
        )
        assert latest["postsInScope"] == random_pick["postsInScope"] == 5
        # `latest` takes the newest five; a seeded shuffle almost certainly
        # does not. Compare as sets so ordering differences alone do not pass.
        assert {c["name"] for c in latest["candidates"]} != {
            c["name"] for c in random_pick["candidates"]
        }


def test_latest_cap_takes_the_newest_posts() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=10)
        result = _run(session, max_per_channel=3, max_per_channel_mode="latest")
        assert {c["name"] for c in result["candidates"]} == {
            "source_09",
            "source_08",
            "source_07",
        }


# --- explicit post set (semantic query) ------------------------------------


def test_post_ids_restrict_the_scope() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=10)
        result = _run(session, post_ids=[("carrier", 2), ("carrier", 5)])
        assert result["postsInScope"] == 2
        assert {c["name"] for c in result["candidates"]} == {
            "source_02",
            "source_05",
        }


def test_empty_post_ids_is_an_empty_scope_not_an_unrestricted_one() -> None:
    """A semantic search matching nothing must not silently widen to everything."""
    with Session(engine) as session:
        _seed_posts(session, count=10)
        result = _run(session, post_ids=[])
        assert result["candidates"] == []
        assert result["postsInScope"] == 0


def test_post_ids_none_means_no_restriction() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=6)
        result = _run(session, post_ids=None)
        assert result["postsInScope"] == 6


def test_post_ids_ignore_unknown_and_duplicate_refs() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=5)
        result = _run(
            session,
            post_ids=[("carrier", 1), ("carrier", 1), ("carrier", 999)],
        )
        assert result["postsInScope"] == 1


def test_post_ids_still_respect_the_date_range() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=10)
        result = _run(
            session,
            post_ids=[("carrier", 1), ("carrier", 8)],
            start_date=1005,
        )
        assert result["postsInScope"] == 1
        assert result["candidates"][0]["name"] == "source_08"


# --- the scope snapshot ----------------------------------------------------


def test_saved_report_records_the_cap_mode_seed_and_scope_size() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=10)
        report = create_report(
            session,
            channel_names=["carrier"],
            start_date=None,
            end_date=None,
            signals=None,
            filters=PostFilters(),
            max_per_channel=3,
            max_per_channel_mode="random",
            seed=42,
            post_ids=[("carrier", 1), ("carrier", 2), ("carrier", 3)],
            user_id=ANY_READER,
        )
        scope = report["scope"]
        assert scope["maxPerChannelMode"] == "random"
        assert scope["seed"] == 42
        assert scope["scopedPostCount"] == 3


def test_unrestricted_report_records_no_scoped_post_count() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=4)
        report = create_report(
            session,
            channel_names=["carrier"],
            start_date=None,
            end_date=None,
            signals=None,
            filters=PostFilters(),
            max_per_channel=0,
            user_id=ANY_READER,
        )
        assert report["scope"]["scopedPostCount"] is None
        assert report["scope"]["maxPerChannelMode"] == "latest"
