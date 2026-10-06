"""Server-side port of the frontend post-view filters.

`frontend/src/lib/posts/post-view.ts::buildFilteredPostsFromRaw` filters the
posts a user sees on the Posts tab — keyword, forwarded-state, media kind — and
caps how many posts per channel are kept. Discover and the per-channel scope
counts both derive from that same filtered set, so to compute either
server-side we must reproduce these filters exactly against the database.

Parity target (keep in lockstep with the frontend):
  - keyword   → `applyKeywordFilter`        (post-view.ts)

The rest of the Post filter is a tree of Conditions (PTR-03) that only the
server evaluates; the browser sends it and never tests a Post against it.

The Scope's vocabulary lives here too: the media kinds, the feed's orders and
the cap's modes, so the schemas that accept a Scope and the services that read
one name one set of values (PFB-01).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, get_args

from sqlalchemy import (
    Boolean,
    ColumnElement,
    Float,
    Numeric,
    and_,
    case,
    cast,
    false,
    func,
    literal,
    not_,
    or_,
    true,
    type_coerce,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import col

from app.models_tg import Post
from app.services.post_media_parser import LEGACY_MEDIA_PLACEHOLDER
from app.services.reach import MS_PER_HOUR, CurvePoints, ReachSettings

ForwardedFilter = Literal["all", "forwarded", "original", "unfollowed_forwarded"]
#: A Type Condition's values: `ForwardedFilter` without `all`, which a tree
#: says by having no Type Condition at all.
PostType = Literal["forwarded", "original", "unfollowed_forwarded"]
POST_TYPE_ORDER: tuple[PostType, ...] = get_args(PostType)
#: One media kind. A Scope carries a *set* of them (PFB-01): empty means any
#: media, and a Post matches when it matches any kind in the set. The set
#: replaced a single value whose `"all"` meant what the empty set means now;
#: `app/schemas/scope.py::upgrade_legacy_scope_fields` reads the old spelling.
MediaKind = Literal[
    "text_only",
    "media_only",
    "photo",
    "video",
    "link_preview",
    "grouped",
]

#: The feed's orders. Grouping by channel is a separate switch rather than an
#: order of its own, so it can combine with any (PFB-01). The views orders read
#: the Scope's `view_measure` (PFB-03).
FeedSort = Literal["newest", "oldest", "most_views", "fewest_views"]
VIEW_SORTS: frozenset[str] = frozenset(("most_views", "fewest_views"))

#: What a views bound and the views orders compare: the View count Telegram
#: shows now, or the Estimated View count (ADR-025).
ViewMeasure = Literal["views", "estimated"]
VIEW_MEASURES: frozenset[str] = frozenset(get_args(ViewMeasure))
#: At least (`gte`) or at most (`lte`): a frozen Scope's views threshold from
#: before PTR-03, kept so an old Artifact still reads.
ViewsOp = Literal["gte", "lte"]

#: The per-channel cap's modes. `ordered` keeps each channel's first N **in the
#: chosen order**; it was `latest`, and renamed rather than reinterpreted so a
#: cap under `oldest` can never be labelled "newest" (PFB-01).
CapMode = Literal["ordered", "random"]

#: The kinds in the order the Media dropdown lists them.
MEDIA_KIND_ORDER: tuple[MediaKind, ...] = get_args(MediaKind)
MEDIA_KINDS: frozenset[str] = frozenset(MEDIA_KIND_ORDER)
FEED_SORTS: frozenset[str] = frozenset(get_args(FeedSort))
FEED_CAP_MODES: frozenset[str] = frozenset(get_args(CapMode))

# Mirrors MEDIA_ONLY_TEXT_RE in frontend/src/lib/posts/post-media.ts, as a
# POSIX pattern for `~*`. The frontend tests `post.text.trim()` against
# /^\[(?:photo|video|voice|document|poll|photo album)\]/i.
_MEDIA_ONLY_TEXT_RE = (
    r"^\[(photo|video|voice|audio|document|poll|sticker|photo album)\]"
)


@dataclass(frozen=True)
class ViewReading:
    """What "views" means for one request (PFB-03, ADR-025).

    The raw View count, or the Estimated View count through the curve and
    settings current when the request was read. `settling_curve.view_reading`
    loads them, and only when an estimate will be read; reading one unloaded
    raises rather than guessing a curve.
    """

    measure: ViewMeasure = "estimated"
    curve: CurvePoints | None = None
    settings: ReachSettings | None = None

    def of(self, entity: Any) -> ColumnElement[Any]:
        """The measure's value for each row of `entity`; NULL for none."""
        if self.measure == "views":
            return cast(entity.views_count, Float)
        if self.curve is None or self.settings is None:
            raise ValueError("an Estimated View count needs its curve loaded")
        return estimated_views_sql(
            entity.views_count, observed_age_hours(entity), self.curve, self.settings
        )

    def too_new(self, entity: Any) -> ColumnElement[bool]:
        """Rows with a View count this measure cannot judge yet: under the floor."""
        if self.measure == "views":
            return false()
        if self.settings is None:
            raise ValueError("an Estimated View count needs its settings loaded")
        return and_(
            entity.views_count.is_not(None),
            observed_age_hours(entity) < self.settings.estimation_floor_hours,
        )


# ---- The Post filter's tree (PTR-03) ----------------------------------------
#
# The Channels tab's filter over Posts: AND/OR groups and NOT on any node, so
# parentheses are just groups. Each Condition holds one value, so a tree says
# what one list per pill could not: "not Persian", "photo and not forwarded",
# "(fa and video) or (views >= 10K)".

TreeOp = Literal["and", "or"]


@dataclass(frozen=True)
class TypeCond:
    value: PostType


@dataclass(frozen=True)
class MediaCond:
    value: MediaKind


@dataclass(frozen=True)
class LanguageCond:
    value: str


@dataclass(frozen=True)
class ChannelCond:
    """One Channel by handle; one the caller does not follow matches nothing."""

    value: str


@dataclass(frozen=True)
class ViewsCond:
    """A bound on a measure, either end open; `none` keeps the Posts with no value."""

    measure: ViewMeasure
    min: float | None = None
    max: float | None = None
    none: bool = False


TreeCond = TypeCond | MediaCond | LanguageCond | ChannelCond | ViewsCond


# Generic over the Condition, so the Directory filter (DIR-02) is the same tree
# with its own vocabulary and `compile_tree` is the one place the tree's
# meaning lives.


@dataclass(frozen=True)
class TreeAtom[C]:
    cond: C
    negated: bool = False


@dataclass(frozen=True)
class TreeGroup[C]:
    op: TreeOp
    children: tuple[TreeAtom[C] | TreeGroup[C], ...] = ()
    negated: bool = False


type TreeNode[C] = TreeAtom[C] | TreeGroup[C]
#: The Post filter's tree.
type PostTree = TreeGroup[TreeCond]


def compile_tree[C](
    node: TreeNode[C], atom: Callable[[C], ColumnElement[bool]]
) -> ColumnElement[bool]:
    """`node` as one predicate, each Condition compiled by `atom`.

    Every atom is `coalesce(clause, false)`, so NOT is two-valued: a row with
    no value for a Condition (an unread Language, no View count) fails it and
    passes its negation, as a Channel with no value does on Channels. Plain SQL
    would make both NULL and drop the row either way.

    An empty group keeps every row, negated or not, so an empty tree hides
    nothing (the Channels rule again).
    """
    if isinstance(node, TreeAtom):
        clause: ColumnElement[bool] = func.coalesce(atom(node.cond), false())
    else:
        if not node.children:
            return true()
        parts = [compile_tree(child, atom) for child in node.children]
        clause = and_(*parts) if node.op == "and" else or_(*parts)
    return not_(clause) if node.negated else clause


def prune_tree[C](node: TreeGroup[C], drop: Callable[[C], bool]) -> TreeGroup[C]:
    """`node` without the Conditions `drop` names; a group left empty passes all."""
    return TreeGroup(
        op=node.op,
        negated=node.negated,
        children=tuple(
            child if isinstance(child, TreeAtom) else prune_tree(child, drop)
            for child in node.children
            if not (isinstance(child, TreeAtom) and drop(child.cond))
        ),
    )


def tree_conds[C](node: TreeNode[C]) -> list[C]:
    """Every Condition in the tree, in order."""
    if isinstance(node, TreeAtom):
        return [node.cond]
    return [cond for child in node.children for cond in tree_conds(child)]


def tree_measures(node: TreeNode[TreeCond]) -> frozenset[ViewMeasure]:
    """The measures the tree's views bounds read, so only those are loaded."""
    return frozenset(c.measure for c in tree_conds(node) if isinstance(c, ViewsCond))


@dataclass(frozen=True)
class PostFilters:
    """The Post filter as SQL predicates: the keyword and the tree (PTR-03).

    `followed_names` is only consulted for the `unfollowed_forwarded` Type;
    pass the lowercased followed-channel set when the tree holds one.
    """

    keyword: str | None = None
    #: None or an empty root keeps every Post.
    tree: PostTree | None = None
    #: One reading per measure the tree's views bounds read.
    tree_readings: Mapping[ViewMeasure, ViewReading] = field(default_factory=dict)
    #: The measure the views orders read. Not the tree's: a bound names its own.
    reading: ViewReading = ViewReading()

    def active_tree(self) -> PostTree | None:
        """The tree, when it holds anything to filter by; an empty root keeps all."""
        return self.tree if self.tree is not None and self.tree.children else None

    def reads_unfollowed(self) -> bool:
        """Whether the tree needs the followed-channel set."""
        return self.tree is not None and TypeCond("unfollowed_forwarded") in tree_conds(
            self.tree
        )


# ---- The Post selection's steps (PTR-05, ADR-026) ---------------------------
#
# The vocabulary only; `post_selection` evaluates them.


@dataclass(frozen=True)
class Rule:
    """Select or deselect every Post a Post filter matches, as it was made."""

    select: bool
    #: Reach every Post the filter does not match instead (PTR-06).
    negated: bool = False
    tree: PostTree | None = None
    keyword: str | None = None
    sort: FeedSort = "newest"
    view_measure: ViewMeasure = "estimated"
    max_per_channel: int = 0
    max_per_channel_mode: CapMode = "ordered"
    seed: int = 0


@dataclass(frozen=True)
class Pick:
    """Select or deselect one Post."""

    select: bool
    channel_name: str
    post_id: int


Step = Rule | Pick
SELECT_ALL: tuple[Step, ...] = (Rule(select=True),)


def _media_jsonb() -> ColumnElement[Any]:
    # media is a `json` column (not `jsonb`); cast so containment/length work.
    return cast(col(Post.media), JSONB)


def _kinds() -> Any:
    # Explicit `->` rather than `[...]` subscript: subscripting a CAST(...)
    # expression renders as a PG array subscript, which is a syntax error.
    return _media_jsonb().op("->")("kinds")


def _has_media() -> ColumnElement[bool]:
    return func.coalesce(func.jsonb_array_length(_kinds()), 0) > 0


def _kinds_contains(kind: str) -> ColumnElement[bool]:
    # `@>` containment avoids the jsonb `?` operator, which collides with the
    # DBAPI parameter placeholder. type_coerce marks the Python dict as a JSONB
    # bind param.
    return _media_jsonb().op("@>", return_type=Boolean)(
        type_coerce({"kinds": [kind]}, JSONB)
    )


def _is_media_only() -> ColumnElement[bool]:
    flag = _media_jsonb().op("->>")("isMediaOnly") == "true"
    placeholder = and_(_has_media(), col(Post.text) == LEGACY_MEDIA_PLACEHOLDER)
    text_re = func.trim(col(Post.text)).op("~*")(_MEDIA_ONLY_TEXT_RE)
    return or_(flag, placeholder, text_re)


def _keyword_clause(term: str) -> ColumnElement[bool]:
    like = f"%{term.lower()}%"
    return or_(
        func.lower(col(Post.text)).like(like),
        func.lower(col(Post.channel_name)).like(like),
    )


def post_type_clause(
    value: PostType, followed_names: frozenset[str] | None
) -> ColumnElement[bool]:
    if value == "forwarded":
        return col(Post.forwarded_from).is_not(None)
    if value == "original":
        return col(Post.forwarded_from).is_(None)
    followed = followed_names or frozenset()
    return and_(
        col(Post.forwarded_from).is_not(None),
        func.lower(col(Post.forwarded_from)).notin_(followed),
    )


def media_kind_clause(value: MediaKind) -> ColumnElement[bool]:
    if value == "text_only":
        return not_(_has_media())
    if value == "media_only":
        return and_(_has_media(), _is_media_only())
    if value in ("photo", "video", "link_preview"):
        return and_(_has_media(), _kinds_contains(value))
    if value == "grouped":
        # groupedCount is a JSON integer; `->>` yields its text form, cast to
        # numeric for the `> 1` test. Absent key → NULL → excluded, matching
        # the frontend's `groupedCount != null && groupedCount > 1`.
        grouped_count = func.cast(_media_jsonb().op("->>")("groupedCount"), Numeric)
        return and_(
            _has_media(),
            or_(_kinds_contains("grouped"), grouped_count > 1),
        )
    raise ValueError(f"unknown media kind: {value}")


def _atom_clause(
    cond: TreeCond,
    readings: Mapping[ViewMeasure, ViewReading],
    followed_names: frozenset[str] | None,
) -> ColumnElement[bool]:
    if isinstance(cond, TypeCond):
        return post_type_clause(cond.value, followed_names)
    if isinstance(cond, MediaCond):
        return media_kind_clause(cond.value)
    if isinstance(cond, LanguageCond):
        return col(Post.language) == cond.value
    if isinstance(cond, ChannelCond):
        # The read is already narrowed to the caller's Follows, so a Channel
        # they do not follow matches nothing here without a check of its own.
        return col(Post.channel_name) == cond.value
    value = readings[cond.measure].of(Post)
    if cond.none:
        return value.is_(None)
    bounds: list[ColumnElement[bool]] = [value.is_not(None)]
    if cond.min is not None:
        bounds.append(value >= cond.min)
    if cond.max is not None:
        bounds.append(value <= cond.max)
    return and_(*bounds)


def tree_clause(
    node: TreeNode[TreeCond],
    *,
    readings: Mapping[ViewMeasure, ViewReading],
    followed_names: frozenset[str] | None = None,
) -> ColumnElement[bool]:
    """`node` as one predicate, evaluated the way the Channels tab evaluates."""
    return compile_tree(node, lambda cond: _atom_clause(cond, readings, followed_names))


def post_filter_clauses(
    filters: PostFilters, *, followed_names: frozenset[str] | None = None
) -> list[ColumnElement[bool]]:
    """Build the WHERE predicates for `filters` (channel/date handled elsewhere)."""
    clauses: list[ColumnElement[bool]] = []
    if filters.keyword and filters.keyword.strip():
        clauses.append(_keyword_clause(filters.keyword.strip()))
    if (tree := filters.active_tree()) is not None:
        clauses.append(
            tree_clause(
                tree, readings=filters.tree_readings, followed_names=followed_names
            )
        )
    return clauses


def apply_post_filters(
    stmt: Any, filters: PostFilters, *, followed_names: frozenset[str] | None = None
) -> Any:
    """Return `stmt` narrowed by every predicate `filters` implies."""
    for clause in post_filter_clauses(filters, followed_names=followed_names):
        stmt = stmt.where(clause)
    return stmt


def analysis_window_clauses(
    start_date: int | None, end_date: int | None
) -> list[ColumnElement[bool]]:
    """The Analysis window as SQL: `start_date <= timestamp < end_date` (AW-01).

    **Half-open, and the exclusive end is the whole point.** Two adjacent
    windows must meet without sharing a Post, or dividing a period
    double-counts its boundary. `jobs/auto_summary.py` is where that was not
    academic: a regenerated Summary starts at exactly the previous one's
    `end_date`, so an inclusive end put any Post landing on that millisecond
    into both Summaries.

    It is also what lets a displayed minute mean something exact. A Fixed End
    shown as 02:00 is the instant 02:00:00.000 and is excluded, rather than
    silently meaning "02:00 and the rest of that minute" (ADR-018).

    This is the only place in `app/` where the comparison is written. It used
    to exist as five independent copies — the feed, the counts, Discover,
    semantic search and auto-regeneration — every one of them inclusive, and
    fixing any one of them alone would have left the same Scope meaning
    different things on different paths. The boundary suite runs one fixture
    through all five, and its companion guard fails any new comparison written
    elsewhere; both live in `tests/services/`.

    Either bound may be `None`, which is that side left open.
    """
    clauses: list[ColumnElement[bool]] = []
    if start_date is not None:
        clauses.append(col(Post.timestamp) >= start_date)
    if end_date is not None:
        clauses.append(col(Post.timestamp) < end_date)
    return clauses


def apply_analysis_window(
    stmt: Any, start_date: int | None, end_date: int | None
) -> Any:
    """Return `stmt` narrowed to the Analysis window."""
    for clause in analysis_window_clauses(start_date, end_date):
        stmt = stmt.where(clause)
    return stmt


# --------------------------------------------------------------------------
# The Estimated View count, as SQL (PFB-03, ADR-025)
# --------------------------------------------------------------------------


def _share_sql(curve: CurvePoints, age_hours: ColumnElement[Any]) -> Any:
    """`curve`'s share at `age_hours`, as a CASE over its knots.

    `np.interp` over log age, flat outside the knots.
    """
    points = curve.points
    at = func.ln(func.greatest(age_hours, points[0][0]))
    logs = [(math.log(age), math.log(share)) for age, share in points]
    spans = [
        (
            at >= la0,
            func.exp(ls0 + (at - la0) * ((ls1 - ls0) / (la1 - la0))),
        )
        for (la0, ls0), (la1, ls1) in zip(logs, logs[1:], strict=False)
    ]
    return case(
        (at >= logs[-1][0], literal(points[-1][1])),
        *reversed(spans),
        else_=literal(points[0][1]),
    )


def estimated_views_sql(
    views: ColumnElement[Any],
    age_hours: ColumnElement[Any],
    curve: CurvePoints,
    settings: ReachSettings,
) -> ColumnElement[Any]:
    """`reach.estimated_views` as an SQL expression over two columns.

    NULL for no View count, no observation time, or an age under the
    estimation floor: too new to judge. Built per request from the current
    curve and settings; nothing is stored, and `views_count` has no index
    (ADR-024's HOT update).
    """
    anchor = curve(settings.settling_age_hours)
    counted = cast(views, Float)
    return case(
        (age_hours >= settings.settling_age_hours, counted),
        (
            age_hours >= settings.estimation_floor_hours,
            counted * anchor / _share_sql(curve, age_hours),
        ),
        else_=None,
    )


def observed_age_hours(entity: Any) -> ColumnElement[Any]:
    """A Post's age when its View count was observed, in hours."""
    return cast(entity.views_observed_at - entity.timestamp, Float) / MS_PER_HOUR
