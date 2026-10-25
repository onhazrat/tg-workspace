"""The Posts view's interface (ADR-036): what it loads, and what each read ignores.

The HTTP suites prove the Posts tab answers as it did. These pin the
preconditions the view took over from its callers: an estimate is loaded
whenever the tree, the sort or a Selection rule reads one, and only then; the
followed set likewise; the curve is read once however many rules read it; each
read sets aside exactly the parts of the view its docstring names; and a
capped Selection rule reaches the Posts the feed's cap keeps, because both
rank through `post_filters.ranked_per_channel`.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.post_filters import (
    CapMode,
    FeedSort,
    PostTree,
    Rule,
    TreeAtom,
    TreeCond,
    TreeGroup,
    TypeCond,
    ViewsCond,
)
from app.services.posts_view import (
    PostsView,
    count_selected,
    count_shown,
    facets,
    feed,
    lookup,
    resolve_posts_view,
    value_histogram,
    window_histogram,
)
from tests.utils.tenancy import ANY_READER, follow_channels

#: Every Post's timestamp is under this, so a window from 0 holds them all.
END = 10_000


def _tree(cond: TreeCond) -> PostTree:
    return TreeGroup("and", (TreeAtom(cond),))


UNFOLLOWED = _tree(TypeCond("unfollowed_forwarded"))
ESTIMATE_BOUND = _tree(ViewsCond("estimated", min=1))


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def _add(session: Session, channel: str, post_id: int, **kw: Any) -> None:
    follow_channels(session, channel, user_id=ANY_READER)
    session.add(
        Post(
            channel_name=channel,
            post_id=post_id,
            text=kw.pop("text", f"{channel}-{post_id}"),
            timestamp=kw.pop("timestamp", 1000 + post_id),
            **kw,
        )
    )


def _view(session: Session, **kw: Any) -> PostsView:
    return resolve_posts_view(session, user_id=ANY_READER, start=0, end=END, **kw)


def _ids(rows: list[dict[str, Any]]) -> set[tuple[str, int]]:
    return {(r["channelName"], r["id"]) for r in rows}


def _selected(session: Session, view: PostsView) -> set[tuple[str, int]]:
    return {(r["channelName"], r["id"]) for r in feed(session, view) if r["selected"]}


# ---- What the view loads ------------------------------------------------------


def test_an_estimate_bound_reads_a_loaded_estimate(session: Session) -> None:
    view = _view(session, tree=ESTIMATE_BOUND)

    assert view.estimate is not None
    assert view.filters.tree_readings["estimated"].curve is not None
    feed(session, view)


def test_a_views_sort_reads_a_loaded_estimate(session: Session) -> None:
    view = _view(session, sort="most_views", view_measure="estimated")

    assert view.filters.reading.curve is not None
    feed(session, view)
    count_shown(session, view)


def test_a_selection_rule_reading_an_estimate_loads_it(session: Session) -> None:
    view = _view(session, steps=(Rule(select=True, tree=ESTIMATE_BOUND),))

    assert view.estimate is not None
    feed(session, view)


def test_a_view_reading_no_estimate_loads_none(session: Session) -> None:
    assert _view(session, sort="most_views", view_measure="views").estimate is None
    assert _view(session, tree=_tree(ViewsCond("views", min=1))).estimate is None


def test_a_rule_reading_unfollowed_forwards_finds_the_followed_set(
    session: Session,
) -> None:
    _add(session, "a", 1, forwarded_from="b")
    _add(session, "a", 2, forwarded_from="elsewhere")
    _add(session, "b", 1)
    session.commit()

    view = _view(session, steps=(Rule(select=True, tree=UNFOLLOWED),))

    assert view.followed is not None
    assert _selected(session, view) == {("a", 2)}


def test_a_view_needing_no_followed_set_does_not_load_it(session: Session) -> None:
    assert _view(session).followed is None
    assert _view(session, tree=UNFOLLOWED).followed is not None
    assert _view(session, with_followed=True).followed is not None


def test_the_curve_is_read_once_across_many_rules(session: Session) -> None:
    fits: list[str] = []

    def count(_conn: Any, _cursor: Any, statement: str, *_rest: Any) -> None:
        if "tg_settling_curve_fits" in statement:
            fits.append(statement)

    rules = tuple(
        Rule(select=True, tree=ESTIMATE_BOUND, sort="most_views") for _ in range(4)
    )
    event.listen(engine, "before_cursor_execute", count)
    try:
        _view(session, tree=ESTIMATE_BOUND, sort="most_views", steps=rules)
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert len(fits) == 1


# ---- What each read ignores -----------------------------------------------------


@pytest.fixture
def corpus(session: Session) -> Session:
    """Three Posts in `a`, one forwarded, and one in `b`; no keyword matches `zzz`."""
    _add(session, "a", 1, views_count=10)
    _add(session, "a", 2, views_count=20, forwarded_from="src")
    _add(session, "a", 3, views_count=30)
    _add(session, "b", 1, views_count=40)
    session.commit()
    return session


EVERYTHING = {("a", 1), ("a", 2), ("a", 3), ("b", 1)}
#: A view whose filter keeps nothing and whose cap keeps one Post per Channel.
NARROW: dict[str, Any] = {"keyword": "zzz", "max_per_channel": 1}


def test_the_feed_and_its_counts_ignore_nothing(corpus: Session) -> None:
    assert feed(corpus, _view(corpus, **NARROW)) == []
    assert count_shown(corpus, _view(corpus, **NARROW)) == ({}, 0)
    assert len(feed(corpus, _view(corpus, max_per_channel=1))) == 2


def test_the_selection_count_ignores_the_filter_and_the_cap(corpus: Session) -> None:
    assert count_selected(corpus, _view(corpus, **NARROW)) == {"a": 3, "b": 1}


def test_the_facets_ignore_the_filter_and_the_cap(corpus: Session) -> None:
    counted = facets(
        corpus,
        _view(corpus, **NARROW, tree=_tree(TypeCond("original")), with_followed=True),
    )

    assert counted.total == 4
    assert {v: n for v, n, _m in counted.types}["forwarded"] == 1


def test_the_value_histogram_applies_the_filter_only_when_filtered(
    corpus: Session,
) -> None:
    view = _view(corpus, **NARROW)

    assert value_histogram(corpus, view, "views").total == 4
    assert value_histogram(corpus, view, "channel_posts").max == 3
    assert value_histogram(corpus, view, "channel_posts_filtered").max == 0


def test_the_window_histogram_ignores_the_cap(corpus: Session) -> None:
    def bars(**kw: Any) -> int:
        return sum(
            window_histogram(
                corpus, _view(corpus, **kw), extent_start=0, extent_end=END, buckets=4
            )
        )

    assert bars(max_per_channel=1) == 4
    assert bars(keyword="a-") == 3
    assert bars(keyword="zzz") == 0


def test_the_unfiltered_window_histogram_ignores_the_filter(corpus: Session) -> None:
    bars = window_histogram(
        corpus,
        _view(corpus, **NARROW),
        extent_start=0,
        extent_end=END,
        buckets=4,
        unfiltered=True,
    )

    assert sum(bars) == 4


def test_the_lookup_ignores_the_keyword_and_the_cap(corpus: Session) -> None:
    pairs = sorted(EVERYTHING)

    assert _ids(lookup(corpus, _view(corpus, **NARROW), pairs)) == EVERYTHING
    assert _ids(
        lookup(corpus, _view(corpus, tree=_tree(TypeCond("forwarded"))), pairs)
    ) == {("a", 2)}


def test_the_reads_that_ignore_the_filter_keep_the_channels_window_and_selection(
    corpus: Session,
) -> None:
    """The other half of each read's contract: what it ignores, and no more."""
    only_b = _view(corpus, channel_names=["b"])
    none_selected = _view(corpus, steps=(Rule(select=False),), with_followed=True)

    assert value_histogram(corpus, only_b, "views").total == 1
    assert window_histogram(
        corpus, only_b, extent_start=0, extent_end=END, buckets=4, unfiltered=True
    ) == [1, 0, 0, 0]
    assert count_selected(corpus, only_b) == {"b": 1}
    counted = facets(corpus, none_selected)
    assert counted.total == 4
    assert [m for _v, _n, m in counted.types] == [0] * len(counted.types)
    late = resolve_posts_view(corpus, user_id=ANY_READER, start=1003, end=END)
    assert count_selected(corpus, late) == {"a": 1}


# ---- One cap for the feed and the Post selection ----------------------------------


@pytest.mark.parametrize(
    ("mode", "sort"),
    [
        ("random", "newest"),
        ("ordered", "newest"),
        ("ordered", "oldest"),
        ("ordered", "most_views"),
        ("ordered", "fewest_views"),
    ],
)
def test_a_capped_rule_reaches_the_posts_the_feeds_cap_keeps(
    session: Session, mode: CapMode, sort: FeedSort
) -> None:
    for channel in ("a", "b"):
        for i in range(1, 7):
            _add(session, channel, i, views_count=(i * 37) % 11)
    session.commit()
    cap: dict[str, Any] = {
        "max_per_channel": 2,
        "cap_mode": mode,
        "sort": sort,
        "seed": 7,
        "view_measure": "views",
    }
    rule = Rule(
        select=True,
        sort=sort,
        view_measure="views",
        max_per_channel=2,
        max_per_channel_mode=mode,
        seed=7,
    )

    shown = _ids(feed(session, _view(session, **cap)))
    reached = _selected(session, _view(session, steps=(rule,)))

    assert len(shown) == 4
    assert reached == shown
