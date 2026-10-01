"""Discover over the two scopes that used to require a client-side aggregation.

Before IDEA-011 D14 a `random` per-channel cap and a semantic query each fell
back to `computeDiscoveryCandidates` in the browser, so the counting rules had
two implementations. These cover the server reproducing both.

Since PTR-05 both reach a report as its Post selection: a cap is a Selection
rule's, and ranked Posts are deselect-all then one Pick each. `_run` spells
each old knob as the selection that replaced it.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.discover import compute_discover_candidates
from app.services.discover_reports import create_report
from app.services.post_filters import Pick, Rule, Step
from app.services.post_selection import PostScope, selection_clause
from tests.utils.discover import report_scope
from tests.utils.tenancy import ANY_READER, follow_channels


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
    # Ticket 21: `Post` is `FOLLOW_SCOPED`, so under enforcement every carrier
    # here is unreadable without a follow. `ANY_READER`, because that is the
    # account `_run` reads as — an operator-owned follow leaves it just as empty.
    follow_channels(
        session,
        "carrier",
        *(f"source_{i:02d}" for i in range(count)),
        user_id=ANY_READER,
    )


def _run(
    session: Session,
    *,
    post_ids: list[tuple[str, int]] | None = None,
    start_date: int | None = None,
    **cap: Any,
) -> dict[str, Any]:
    names = ["carrier"]
    follow_channels(session, *names, user_id=ANY_READER)
    steps: list[Step] = (
        [Rule(select=True, **cap)]
        if post_ids is None
        else [Rule(select=False), *(Pick(True, c, p) for c, p in post_ids)]
    )
    return compute_discover_candidates(
        session,
        channel_names=names,
        start_date=start_date,
        selected=selection_clause(
            session, steps, PostScope(ANY_READER, names, start_date, None)
        ),
        user_id=ANY_READER,
    )


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


def test_random_cap_differs_from_ordered_cap() -> None:
    """Otherwise the mode is not actually being applied."""
    with Session(engine) as session:
        _seed_posts(session, count=30)
        ordered = _run(session, max_per_channel=5, max_per_channel_mode="ordered")
        random_pick = _run(
            session, max_per_channel=5, max_per_channel_mode="random", seed=3
        )
        assert ordered["postsInScope"] == random_pick["postsInScope"] == 5
        # `ordered` takes the newest five; a seeded shuffle almost certainly
        # does not. Compare as sets so ordering differences alone do not pass.
        assert {c["name"] for c in ordered["candidates"]} != {
            c["name"] for c in random_pick["candidates"]
        }


def test_ordered_cap_takes_the_newest_posts_by_default() -> None:
    """`ordered` under the default order keeps what `latest` kept (PFB-01)."""
    with Session(engine) as session:
        _seed_posts(session, count=10)
        result = _run(session, max_per_channel=3, max_per_channel_mode="ordered")
        assert {c["name"] for c in result["candidates"]} == {
            "source_09",
            "source_08",
            "source_07",
        }


def test_ordered_cap_follows_the_order() -> None:
    """Under `oldest` the cap keeps each channel's earliest N, as the feed does.

    A capped report reads the Posts the feed shows only while the two rank a
    channel the same way; keeping the newest N here while the feed kept the
    oldest would report on Posts nobody was looking at.
    """
    with Session(engine) as session:
        _seed_posts(session, count=10)
        result = _run(
            session, max_per_channel=3, max_per_channel_mode="ordered", sort="oldest"
        )
        assert {c["name"] for c in result["candidates"]} == {
            "source_00",
            "source_01",
            "source_02",
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


def test_saved_report_reads_and_records_its_selection() -> None:
    """The cap and its seed travel in the rule, and the report covers its Posts."""
    selection = [
        {
            "kind": "rule",
            "select": True,
            "filter": {"maxPerChannel": 3, "maxPerChannelMode": "random", "seed": 42},
        }
    ]
    with Session(engine) as session:
        _seed_posts(session, count=10)
        report = create_report(
            session,
            scope=report_scope(channels=["carrier"], selection=selection),
            signals=None,
            user_id=ANY_READER,
        )
        scope = report["scope"]
        assert scope["selection"][0]["filter"]["maxPerChannelMode"] == "random"
        assert scope["selection"][0]["filter"]["seed"] == 42
        assert report["postsInScope"] == 3


def test_unrestricted_report_records_no_scoped_post_count() -> None:
    with Session(engine) as session:
        _seed_posts(session, count=4)
        report = create_report(
            session,
            scope=report_scope(channels=["carrier"]),
            signals=None,
            user_id=ANY_READER,
        )
        assert report["scope"]["scopedPostCount"] is None
        assert report["scope"]["maxPerChannelMode"] == "ordered"
