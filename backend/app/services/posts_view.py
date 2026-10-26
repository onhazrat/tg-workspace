"""The Posts view and every read the Posts tab and an Action make of it (ADR-036).

A **Posts view** is everything a Posts read is evaluated under: the Account,
the Channels, the Analysis window, the Post filter's tree and keyword, the
readings its bounds and the views orders read through, the followed set when
anything needs it, the per-Channel cap, the sort, the seed, and the Post
selection compiled to its predicate. `resolve_posts_view` builds one, frozen,
from plain values, loading the Settling curve and the followed set then and
only when something reads them; `api/post_views.view_of` reads a Posts request
into one. So a read never resolves anything, and an unloaded estimate is never
reached at read time.

Each read takes `(session, view, …)` and only its own inputs (paging, a
histogram's inputs), and its docstring says which parts of the view it
ignores. That is part of its interface, tested at `test_posts_view.py`, not
left to callers to narrow.

The feed always reads one page. `tg_posts` holds millions of rows across
hundreds of Channels, and an unbounded select here once materialised
gigabytes into a worker.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import ColumnElement, and_, func, literal, not_, or_, true
from sqlalchemy import select as sa_select
from sqlalchemy.orm import aliased
from sqlmodel import Session, col, select

from app.models_tg import Post
from app.services.follows import visible_channel_names
from app.services.language import NOT_READ
from app.services.post_filters import (
    MEDIA_KIND_ORDER,
    POST_TYPE_ORDER,
    SELECT_ALL,
    Cap,
    CapMode,
    Estimate,
    FeedSort,
    PostFilters,
    PostScope,
    PostTree,
    Step,
    ValueMeasure,
    ViewMeasure,
    ViewReading,
    channel_posts_aside,
    feed_order_by,
    media_kind_clause,
    post_filter_clauses,
    post_type_clause,
    ranked_per_channel,
    reading_of,
    reads_estimate,
    reads_unfollowed,
    tree_clause,
    tree_readings,
)
from app.services.post_selection import (
    compile_selection,
    rules_read_estimate,
    rules_read_unfollowed,
)
from app.services.posts import DEFAULT_POST_PAGE_SIZE
from app.services.serialization import post_to_camel
from app.services.settling_curve import current_estimate
from app.services.tenancy import scoped_select


@dataclass(frozen=True, eq=False)
class PostsView:
    """One Posts view, resolved: what every Posts read is evaluated under.

    `eq=False` because `selected` is SQL, whose `==` builds a predicate.
    """

    user_id: uuid.UUID
    channel_names: list[str] | None
    start: int | None
    end: int | None
    #: The keyword, the tree, and the readings its bounds and the views orders
    #: read, through `estimate` whenever one of them reads an estimate.
    filters: PostFilters
    #: The Settling curve and settings, loaded when the tree, the sort, a
    #: Selection rule or `with_estimate` reads an Estimated View count.
    estimate: Estimate | None
    #: The followed-channel set, loaded when the tree or a Selection rule reads
    #: Unfollowed forwards, or `with_followed` asked (the facets count them).
    followed: frozenset[str] | None
    max_per_channel: int
    cap_mode: CapMode
    sort: FeedSort
    seed: int
    #: The Post selection, compiled through the same estimate and followed set.
    selected: ColumnElement[bool]

    @property
    def scope(self) -> PostScope:
        return PostScope(self.user_id, self.channel_names, self.start, self.end)

    @property
    def cap(self) -> Cap:
        return Cap(
            self.max_per_channel,
            self.cap_mode,
            self.sort,
            self.seed,
            self.filters.reading,
        )


def resolve_posts_view(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_names: list[str] | None = None,
    start: int | None = None,
    end: int | None = None,
    tree: PostTree | None = None,
    keyword: str | None = None,
    view_measure: ViewMeasure = "estimated",
    max_per_channel: int = 0,
    cap_mode: CapMode = "ordered",
    sort: FeedSort = "newest",
    seed: int = 0,
    steps: Sequence[Step] | None = None,
    with_estimate: bool = False,
    with_followed: bool = False,
) -> PostsView:
    """The Posts view these plain values describe, with what it reads loaded once.

    `steps` `None` is the default selection, select all. The curve is read at
    most once however many Selection rules read it, and the followed set at
    most once however many places need it. `with_estimate` and
    `with_followed` load them for a read that needs them beyond the view: the
    estimated measure's histogram, and the facets.
    """
    steps = SELECT_ALL if steps is None else steps
    estimate = (
        current_estimate(session)
        if with_estimate
        or reads_estimate(tree, sort, view_measure)
        or rules_read_estimate(steps)
        else None
    )
    followed = (
        frozenset(visible_channel_names(session, user_id=user_id))
        if with_followed or reads_unfollowed(tree) or rules_read_unfollowed(steps)
        else None
    )
    return PostsView(
        user_id=user_id,
        channel_names=channel_names,
        start=start,
        end=end,
        filters=PostFilters(
            keyword=keyword,
            tree=tree,
            tree_readings=tree_readings(tree, estimate),
            reading=reading_of(view_measure, estimate),
        ),
        estimate=estimate,
        followed=followed,
        max_per_channel=max_per_channel,
        cap_mode=cap_mode,
        sort=sort,
        seed=seed,
        selected=compile_selection(
            steps,
            PostScope(user_id, channel_names, start, end),
            estimate=estimate,
            followed=followed,
        ),
    )


def _kept(
    view: PostsView, filters: PostFilters | None, scope: PostScope | None = None
) -> list[ColumnElement[bool]]:
    """What `filters` keeps, read through the view's followed set."""
    if filters is None:
        return []
    return post_filter_clauses(
        filters, followed_names=view.followed, scope=scope or view.scope
    )


def _in_view(stmt: Any, view: PostsView, filters: PostFilters | None) -> Any:
    """`stmt` narrowed to the Account's Follows, the view's Channels and window, and `filters`.

    The one spelling of "the Posts this view covers" the feed, the counts and
    the facets share, so none of them can count a Post another does not show.
    """
    return scoped_select(stmt, Post, view.user_id).where(
        *view.scope.clauses(), *_kept(view, filters)
    )


# ---- The feed and its counts ---------------------------------------------------


@dataclass(frozen=True)
class _Shown:
    """The Posts the feed shows, unordered, each flagged by the selection."""

    stmt: Any
    #: `Post`, or its alias over the capped subquery.
    entity: Any
    #: The selection flag as that statement can read it.
    flag: ColumnElement[bool]


def _shown(view: PostsView) -> _Shown:
    """The feed's statement before its order and page: filtered, then capped.

    The cap ranks inside `ranked_per_channel`, after the Account's scope, so a
    capped feed ranks only Posts the caller can see.
    """
    columns = select(Post, view.selected.label("selected"))
    kept = _kept(view, view.filters)
    if view.max_per_channel <= 0:
        return _Shown(_in_view(columns, view, view.filters), Post, view.selected)
    ranked = ranked_per_channel(columns, view.scope, kept, view.cap)
    capped = aliased(Post, ranked)
    stmt = select(capped, ranked.c.selected).where(ranked.c.rn <= view.max_per_channel)
    return _Shown(stmt, capped, ranked.c.selected)


def feed(
    session: Session,
    view: PostsView,
    *,
    limit: int = DEFAULT_POST_PAGE_SIZE,
    offset: int = 0,
    group_by_channel: bool = False,
    only_selected: bool = False,
    selected_first: bool = False,
) -> list[dict[str, Any]]:
    """One page of the Posts feed, filtered, capped and sorted entirely in SQL.

    Ignores nothing. Each Post says whether the Post selection selects it;
    `only_selected` keeps only those of the Posts the filter shows, which is
    what an Action and copy read, and `selected_first` orders them before the
    rest, each part in the feed's own order (PTR-05, PTR-06). The order always
    ends in `(channel_name, post_id)`, so offset paging is deterministic.
    """
    shown = _shown(view)
    stmt = shown.stmt
    order = feed_order_by(
        view.sort, group_by_channel, shown.entity, view.filters.reading
    )
    if only_selected:
        stmt = stmt.where(shown.flag)
    if selected_first:
        order = [shown.flag.desc(), *order]
    stmt = stmt.order_by(*order).offset(offset).limit(limit)
    return _flagged_rows(session, stmt)


def _flagged_rows(session: Session, stmt: Any) -> list[dict[str, Any]]:
    """Posts as the wire has them, each with its `selected` flag.

    `execute`: SQLModel's `exec` reads a `select(Post)` that gained a column
    as scalars, which drops the flag.
    """
    return [
        {**post_to_camel(p), "selected": bool(chosen)}
        for p, chosen in session.execute(stmt).all()
    ]


def counts(session: Session, view: PostsView) -> dict[str, Any]:
    """The counts read, per Channel: shown, selected, and both (PTR-06).

    What the filter shows and how many it hid as too new to judge
    (`count_shown`), what the Post selection selects filters aside
    (`count_selected`), and the selected Posts the filter shows, which the
    Adjust selection Venn subtracts the other two regions from. Ignores
    nothing; each part says what it sets aside.
    """
    shown, too_new = count_shown(session, view)
    return {
        "counts": shown,
        "too_new": too_new,
        "selected": count_selected(session, view),
        "selected_shown": _count_selected_shown(session, view),
    }


def count_shown(session: Session, view: PostsView) -> tuple[dict[str, int], int]:
    """Per Channel, how many Posts the filter shows, and how many were too new to judge.

    Ignores the selection. `max_per_channel` clamps each count to the cap: the
    `random` and `ordered` modes keep different Posts but the same number, so
    the count ignores the cap's mode, the sort and the seed. A Channel whose
    count is zero is absent.

    The second number is the Posts the filter hid that an Estimated views bound
    could not judge for being under the estimation floor, so an empty Live
    window can say why. It is one more filtered aggregate in the same scan:
    with such a bound the tree moves from the `WHERE` into the per-Channel
    count's `FILTER`, so the rows it hides are still there to be counted. A
    too-new Post the tree keeps anyway, through the other half of an OR, was
    not hidden and is not counted (PTR-03). Not clamped to the cap.
    """
    filters = view.filters
    kept: Any = func.count()
    too_new: Any = literal(0)
    estimate = filters.tree_readings.get("estimated")
    tree = filters.active_tree()
    if tree is not None and estimate is not None:
        shown = tree_clause(
            tree, filters=filters, followed_names=view.followed, scope=view.scope
        )
        kept = func.count().filter(shown)
        too_new = func.count().filter(and_(not_(shown), estimate.too_new(Post)))
        filters = replace(filters, tree=None)
    if view.max_per_channel > 0:
        kept = func.least(kept, view.max_per_channel)

    rows = session.exec(
        _in_view(select(col(Post.channel_name), kept, too_new), view, filters).group_by(
            col(Post.channel_name)
        )
    ).all()
    return (
        {channel: n for channel, n, _hidden in rows if n > 0},
        sum(hidden for _channel, _n, hidden in rows),
    )


def count_selected(session: Session, view: PostsView) -> dict[str, int]:
    """Per-Channel counts of the selected Posts in the window.

    What an Action covers (PTR-05): the selection bar's count, the Channels
    tab's "Posts in scope", and the AI paths' size check. Ignores the Post
    filter, the keyword and the cap. A Channel with none is absent.
    """
    rows = session.exec(
        _in_view(select(col(Post.channel_name), func.count()), view, None)
        .where(view.selected)
        .group_by(col(Post.channel_name))
    ).all()
    return dict(rows)


def _count_selected_shown(session: Session, view: PostsView) -> dict[str, int]:
    """Per Channel, how many of the Posts the feed shows are selected (PTR-06).

    Read over the feed's own statement, cap included, so it counts exactly the
    rows a page would flag.
    """
    shown = _shown(view)
    # `execute`: the statement began as `select(Post)`, which SQLModel's
    # `exec` would read as scalars and drop the count.
    rows = session.execute(
        shown.stmt.with_only_columns(shown.entity.channel_name, func.count())
        .where(shown.flag)
        .group_by(shown.entity.channel_name)
    ).all()
    return {str(channel): int(n) for channel, n in rows}


# ---- The facets ------------------------------------------------------------------


@dataclass(frozen=True)
class PostFacets:
    """The window's Post count, and each value's as `(value, count, selected)`."""

    total: int
    types: list[tuple[str, int, int]]
    languages: list[tuple[str, int, int]]
    media: list[tuple[str, int, int]]


def facets(session: Session, view: PostsView) -> PostFacets:
    """How many Posts in the window have each Type, media kind and Language.

    The counts the Type, Media and Language dropdowns print beside each value
    (PTR-03). Ignores the Post filter, the keyword and the cap, because a
    dropdown row is a value to funnel on, and a value to select by whatever
    the filter shows. Each value also says how many of its Posts the selection
    selects, which is what its tick reads (PTR-06). Needs the followed set,
    since it counts Unfollowed forwards: resolve the view `with_followed`.

    Languages are the ones present, most frequent first, an unread Post
    counted under `NOT_READ`, the value a Language Condition funnels it by.
    The Types are all five and the media kinds all six, in the dropdowns'
    order, zero included; both overlap, so they are filtered aggregates over
    one scan rather than a `GROUP BY`. `total` is every Post in the window, in
    the same scan.
    """
    if view.followed is None:
        raise ValueError("the facets count Unfollowed forwards: resolve with_followed")
    chosen = view.selected

    def scoped(stmt: Any) -> Any:
        return _in_view(stmt.select_from(Post), view, None)

    def both(clause: Any) -> list[Any]:
        return [func.count().filter(clause), func.count().filter(and_(clause, chosen))]

    language_rows = session.exec(
        scoped(
            select(col(Post.language), func.count(), func.count().filter(chosen))
        ).group_by(col(Post.language))
    ).all()
    counted = session.exec(
        scoped(
            select(
                func.count(),
                *(
                    agg
                    for value in POST_TYPE_ORDER
                    for agg in both(post_type_clause(value, view.followed, view.scope))
                ),
                *(
                    agg
                    for kind in MEDIA_KIND_ORDER
                    for agg in both(media_kind_clause(kind))
                ),
            )
        )
    ).one()
    total, *rest = counted
    pairs = list(zip(rest[::2], rest[1::2], strict=True))
    types, kinds = pairs[: len(POST_TYPE_ORDER)], pairs[len(POST_TYPE_ORDER) :]

    return PostFacets(
        total=total,
        types=[
            (value, n, m) for value, (n, m) in zip(POST_TYPE_ORDER, types, strict=True)
        ],
        languages=sorted(
            ((language or NOT_READ, n, m) for language, n, m in language_rows),
            key=lambda row: (-row[1], row[0]),
        ),
        media=[
            (kind, n, m) for kind, (n, m) in zip(MEDIA_KIND_ORDER, kinds, strict=True)
        ],
    )


# ---- By reference ------------------------------------------------------------------


def _by_ref(stmt: Any, pairs: list[tuple[str, int]]) -> Any:
    unique = {(name, post_id) for name, post_id in pairs}
    return stmt.where(
        or_(
            *[
                (col(Post.channel_name) == name) & (col(Post.post_id) == post_id)
                for name, post_id in unique
            ]
        )
    )


def lookup(
    session: Session, view: PostsView, pairs: list[tuple[str, int]]
) -> list[dict[str, Any]]:
    """The Posts the view's Post filter shows among `pairs`, each flagged by the selection.

    How a meaning search's ranked Posts pass the Post filter (PTR-03). Ignores
    the keyword, the cap and the sort; the filter's Channel posts Conditions
    count within the window across every Channel, the view's Channels being
    where the selection's rules reach (PTR-05). An unknown pair, a Post the
    filter hides and a Post under a Channel the caller does not Follow are all
    absent alike: a missing Post is silence, the enumeration argument
    `assert_owner` makes with a 404. The batch is capped by the caller
    (`MAX_POST_LOOKUP_BATCH`).
    """
    if not pairs:
        return []
    stmt = scoped_select(select(Post, view.selected), Post, view.user_id).where(
        *_kept(
            view,
            replace(view.filters, keyword=None),
            replace(view.scope, channel_names=None),
        )
    )
    return _flagged_rows(session, _by_ref(stmt, pairs))


def posts_by_ref(
    session: Session, pairs: list[tuple[str, int]], *, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Specific Posts by their `(channel_name, post_id)`, with no view to read them under.

    For callers that need a handful of known Posts (citations, a Directory
    entry's samples) rather than a Posts tab read. Absent as `lookup` says.
    """
    if not pairs:
        return []
    stmt = scoped_select(select(Post), Post, user_id)
    return [post_to_camel(p) for p in session.exec(_by_ref(stmt, pairs)).all()]


# ---- What an Action covers -------------------------------------------------------


def selected_refs(
    session: Session, view: PostsView, *, group_by_channel: bool = False
) -> list[tuple[str, int]]:
    """Every selected Post in the view, in the feed's order, as references.

    What an Artifact freezes: no text, and no bound, since it records exactly
    what an Action covered however many that was. Ignores the Post filter, the
    keyword and the cap.
    """
    stmt = _in_view(
        select(col(Post.channel_name), col(Post.post_id)), view, None
    ).where(view.selected)
    rows = session.exec(
        stmt.order_by(
            *feed_order_by(view.sort, group_by_channel, Post, view.filters.reading)
        )
    ).all()
    return [(name, post_id) for name, post_id in rows]


# ---- A measure's spread (PTI-01) ------------------------------------------------

#: Every spread's bar count (`BINS` in `components/Spread.tsx`), so one component draws both.
VALUE_BINS = 32


def _identity(v: float) -> float:
    return v


def _bucket_counts(session: Session, stmt: Any, index: Any, n: int) -> list[int]:
    """`stmt`, selecting `(index, count)`, grouped by `index` into `n` buckets."""
    buckets = [0] * n
    for i, c in session.exec(stmt.group_by(index)).all():
        buckets[int(i)] += c
    return buckets


@dataclass(frozen=True)
class ValueHistogram:
    """`bins[i]` holds the values from `edges[i]` up to `edges[i + 1]`."""

    bins: list[int]
    edges: list[float]
    log: bool
    median: float | None
    measured: int
    total: int
    min: float | None = None
    max: float | None = None


def _measured_value(view: PostsView, measure: ValueMeasure) -> Any:
    """What one row of `measure` reads: a Post's views, or a Channel's count."""
    if measure == "views":
        return ViewReading("views").of(Post)
    if measure == "estimated":
        if view.estimate is None:
            raise ValueError("the estimated measure: resolve the view with_estimate")
        return ViewReading("estimated", *view.estimate).of(Post)
    if measure == "channel_posts":
        return func.count()
    kept = _kept(view, channel_posts_aside(view.filters))
    return func.count().filter(and_(true(), *kept))


def value_histogram(
    session: Session,
    view: PostsView,
    measure: ValueMeasure,
    *,
    zoom: tuple[float, float] | None = None,
    log: bool | None = None,
) -> ValueHistogram:
    """One measure across the Posts, or the Channels, in the view.

    Ignores the cap, the sort and the selection, and the Post filter and
    keyword too except under `channel_posts_filtered`, so the other bars hold
    still while the Account changes another Condition. The estimated measure
    needs the view resolved `with_estimate`.

    The Channels tab's rule, so the Posts editors draw what its editors draw:
    32 bars from the lowest value to the highest, and past two orders of
    magnitude the axis is logarithmic, or nearly every Post would land in the
    first bar. A range starting at 0 is drawn on log(1 + x), since log 0 has
    no place. A Post with no value (none recorded, or too new to estimate) is
    in `total` and not in `measured`.

    `views` and `estimated` read each Post. `channel_posts` and
    `channel_posts_filtered` count Channels by their count in the window
    (PTI-02); the filtered one counts only what the filter and keyword keep
    with every Channel posts Condition set aside, as the Condition counts, and
    a Channel whose Posts it all hides is a 0.

    A `zoom` bins only its range, on the scale `log` names (the whole
    spread's when absent); `min`, `max`, `median` and the counts stay the
    whole spread's.
    """
    value = _measured_value(view, measure)
    stmt = _in_view(select(value.label("x")).select_from(Post), view, None)
    if measure.startswith("channel_posts"):
        stmt = stmt.group_by(col(Post.channel_name))
    inner = stmt.subquery()
    x = inner.c.x
    lo, hi, measured, total, median = session.execute(
        sa_select(
            func.min(x),
            func.max(x),
            func.count(x),
            func.count(),
            # The Channels tab's median, `sorted[floor(n / 2)]`: the
            # ceil(n / 2)-th largest is that element, where `percentile_cont`
            # would interpolate and ascending `percentile_disc` takes the lower.
            func.percentile_disc(0.5).within_group(x.desc()),
        ).select_from(inner)
    ).one()
    if not measured:
        return ValueHistogram([], [], False, None, 0, int(total))
    whole = (float(lo), float(hi))
    lo, hi = zoom or whole
    if log is None:
        log = whole[0] >= 0 and whole[1] / (whole[0] if whole[0] > 0 else 1) > 100
    if log:
        lo = max(lo, 0.0)  # log(1 + x) has no place below 0.
    scale: tuple[Callable[[float], float], Callable[[float], float], Any]
    if not log:
        scale = (_identity, _identity, x)
    elif lo > 0:
        scale = (math.log, math.exp, func.ln(x))
    else:
        scale = (math.log1p, math.expm1, func.ln(1 + x))
    f, inv, axis = scale
    span = f(hi) - f(lo)
    # `greatest` because Postgres' ln and Python's can part by one ulp at lo.
    index = (
        literal(0)
        if span <= 0
        else func.least(
            VALUE_BINS - 1,
            func.greatest(0, func.floor((axis - f(lo)) / span * VALUE_BINS)),
        )
    )
    bins = _bucket_counts(
        session,
        # A zoom counts only its range; unzoomed, the float ends could miss
        # the exact lowest or highest value of a numeric column.
        select(index, func.count()).where(
            *([x.is_not(None)] if zoom is None else [x >= lo, x <= hi])
        ),
        index,
        VALUE_BINS,
    )
    edges = [inv(f(lo) + span * i / VALUE_BINS) for i in range(VALUE_BINS + 1)]
    edges[0], edges[-1] = lo, hi
    return ValueHistogram(
        bins, edges, log, float(median), int(measured), int(total), *whole
    )


# ---- The Posts across time (PTI-03) ----------------------------------------------


def window_histogram(
    session: Session,
    view: PostsView,
    *,
    extent_start: int,
    extent_end: int,
    buckets: int,
    unfiltered: bool = False,
) -> list[int]:
    """How many Posts fall in each of `buckets` equal slices of the extent.

    Ignores the cap, the sort and the selection, so the bars do not depend on
    the feed's order, and `unfiltered` ignores the Post filter and keyword
    too. The extent is half-open like the Analysis window, so a Post on a
    slice's edge belongs to the later slice only: whole-number division, never
    a float that could put it on either side. The filter applies against the
    view's Analysis window rather than the extent, which is where a Channel
    posts Condition counts. Has a reply reads replies from the earlier of the
    two starts, since the extent can open before the window.
    """
    index = (
        (col(Post.timestamp) - extent_start) * buckets // (extent_end - extent_start)
    )
    scope = view.scope
    extent = replace(scope, start_date=extent_start, end_date=extent_end)
    if scope.start_date is not None:
        scope = replace(scope, replies_since=min(scope.start_date, extent_start))
    stmt = scoped_select(select(index, func.count()), Post, view.user_id).where(
        *extent.clauses(),
        *_kept(view, None if unfiltered else view.filters, scope),
    )
    return _bucket_counts(session, stmt, index, buckets)
