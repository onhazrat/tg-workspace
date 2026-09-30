"""Server-side port of the frontend post-view filters.

`frontend/src/lib/posts/post-view.ts::buildFilteredPostsFromRaw` filters the
posts a user sees on the Posts tab — keyword, forwarded-state, media kind — and
caps how many posts per channel are kept. Discover and the per-channel scope
counts both derive from that same filtered set, so to compute either
server-side we must reproduce these filters exactly against the database.

Parity targets (keep in lockstep with the frontend):
  - keyword   → `applyKeywordFilter`        (post-view.ts:112)
  - forwarded → `applyForwardedFilter`      (post-view.ts:88)
  - media     → `matchesMediaFilter`        (post-media.ts:46)
  - languages → `applyLanguageFilter`       (post-view.ts)

The Scope's vocabulary lives here too: the media kinds, the feed's orders and
the cap's modes, so the schemas that accept a Scope and the services that read
one name one set of values (PFB-01).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, get_args

from sqlalchemy import (
    Boolean,
    ColumnElement,
    Numeric,
    and_,
    cast,
    func,
    not_,
    or_,
    type_coerce,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import col

from app.models_tg import Post
from app.services.post_media_parser import LEGACY_MEDIA_PLACEHOLDER

ForwardedFilter = Literal["all", "forwarded", "original", "unfollowed_forwarded"]
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
#: order of its own, so it can combine with either (PFB-01).
FeedSort = Literal["newest", "oldest"]

#: The per-channel cap's modes. `ordered` keeps each channel's first N **in the
#: chosen order**; it was `latest`, and renamed rather than reinterpreted so a
#: cap under `oldest` can never be labelled "newest" (PFB-01).
CapMode = Literal["ordered", "random"]

FORWARDED_FILTERS: frozenset[str] = frozenset(
    ("all", "forwarded", "original", "unfollowed_forwarded")
)
#: The kinds in the order the Media pill lists them.
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
class PostFilters:
    """The subset of Posts-tab view state that maps onto SQL predicates.

    `followed_names` is only consulted for the `unfollowed_forwarded` filter;
    pass the lowercased followed-channel set when that value is possible.
    """

    keyword: str | None = None
    forwarded: ForwardedFilter = "all"
    #: Empty is any media; otherwise a Post matching any one kind is kept.
    media: tuple[MediaKind, ...] = ()
    #: Empty is any Language; otherwise the Post's own Language must be one of
    #: these. A Post whose Language is unread (NULL) never matches (PFB-02).
    languages: tuple[str, ...] = ()

    def is_noop(self) -> bool:
        return (
            not (self.keyword and self.keyword.strip())
            and self.forwarded == "all"
            and not self.media
            and not self.languages
        )


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


def _forwarded_clause(
    value: ForwardedFilter, followed_names: frozenset[str] | None
) -> ColumnElement[bool] | None:
    if value == "forwarded":
        return col(Post.forwarded_from).is_not(None)
    if value == "original":
        return col(Post.forwarded_from).is_(None)
    if value == "unfollowed_forwarded":
        followed = followed_names or frozenset()
        return and_(
            col(Post.forwarded_from).is_not(None),
            func.lower(col(Post.forwarded_from)).notin_(followed),
        )
    return None


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


def _media_clause(kinds: tuple[MediaKind, ...]) -> ColumnElement[bool] | None:
    """Any one of `kinds`, or no predicate at all for the empty set."""
    if not kinds:
        return None
    return or_(*(media_kind_clause(kind) for kind in dict.fromkeys(kinds)))


def post_filter_clauses(
    filters: PostFilters, *, followed_names: frozenset[str] | None = None
) -> list[ColumnElement[bool]]:
    """Build the WHERE predicates for `filters` (channel/date handled elsewhere)."""
    clauses: list[ColumnElement[bool]] = []
    if filters.keyword and filters.keyword.strip():
        clauses.append(_keyword_clause(filters.keyword.strip()))
    fwd = _forwarded_clause(filters.forwarded, followed_names)
    if fwd is not None:
        clauses.append(fwd)
    media = _media_clause(filters.media)
    if media is not None:
        clauses.append(media)
    if filters.languages:
        # `IN` never matches NULL, which is the rule: an unread Post has no
        # Language to be ticked.
        clauses.append(col(Post.language).in_(filters.languages))
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
