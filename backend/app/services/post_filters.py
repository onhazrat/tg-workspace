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

The per-channel cap's `latest` mode is reproduced by `latest_per_channel_cap`;
its `random` mode uses a browser-seeded PRNG and is deliberately *not* ported
(the caller falls back to the client path when random mode is active). See
`docs/architecture-remediation-plan.md` step 2 and the phase-4 scope decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

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

ForwardedFilter = Literal["all", "forwarded", "original", "unfollowed_forwarded"]
MediaFilter = Literal[
    "all",
    "text_only",
    "media_only",
    "photo",
    "video",
    "link_preview",
    "grouped",
]

FORWARDED_FILTERS: frozenset[str] = frozenset(
    ("all", "forwarded", "original", "unfollowed_forwarded")
)
MEDIA_FILTERS: frozenset[str] = frozenset(
    ("all", "text_only", "media_only", "photo", "video", "link_preview", "grouped")
)

# Mirrors MEDIA_ONLY_TEXT_RE in frontend/src/lib/posts/post-media.ts, as a
# POSIX pattern for `~*`. The frontend tests `post.text.trim()` against
# /^\[(?:photo|video|voice|document|poll|photo album)\]/i.
_MEDIA_ONLY_TEXT_RE = r"^\[(photo|video|voice|document|poll|photo album)\]"

# Frontend sentinel: text set to this exact string means "media, no caption".
_MEDIA_PLACEHOLDER_TEXT = "[Media/No Text Content]"


@dataclass(frozen=True)
class PostFilters:
    """The subset of Posts-tab view state that maps onto SQL predicates.

    `followed_names` is only consulted for the `unfollowed_forwarded` filter;
    pass the lowercased followed-channel set when that value is possible.
    """

    keyword: str | None = None
    forwarded: ForwardedFilter = "all"
    media: MediaFilter = "all"

    def is_noop(self) -> bool:
        return (
            not (self.keyword and self.keyword.strip())
            and self.forwarded == "all"
            and self.media == "all"
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
    placeholder = and_(_has_media(), col(Post.text) == _MEDIA_PLACEHOLDER_TEXT)
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


def _media_clause(value: MediaFilter) -> ColumnElement[bool] | None:
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
    return None


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
    return clauses


def apply_post_filters(
    stmt: Any, filters: PostFilters, *, followed_names: frozenset[str] | None = None
) -> Any:
    """Return `stmt` narrowed by every predicate `filters` implies."""
    for clause in post_filter_clauses(filters, followed_names=followed_names):
        stmt = stmt.where(clause)
    return stmt
