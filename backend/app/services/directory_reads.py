"""The Directory tab's reads: one page, its totals, a measure's spread (DIR-02).

A read model over three corpus tables, `tg_channel_directory` (the entries),
`tg_post_references` (who cites whom) and the caller's Follows. It writes
nothing. The Directory filter is a tree of Conditions the browser sends and
only this module evaluates; `post_filters.compile_tree` gives the tree its
meaning (an atom with no value fails, an empty group passes everything), so the
Directory and the Post filter cannot disagree about what AND, OR and NOT mean.

## What is listed

Every entry whose page said it is a Channel (`kind = 'channel'`), followable or
not: "Followable" is a Condition, so the opening view's rule is one the Account
can see and change. Bots, groups and personal accounts are never listed.

## "Your channels"

One set of handles per request, chosen by the view: every Channel the Account
follows (resolved here, through the Follow seam), or handles the browser sends
(its Channels tab selection, or the Channels ticked in the list). The "Yours"
count, its sort and the "Cited by your channels" Condition all read that set,
counted in **distinct** Citing Channels, never in Reference rows: a plain
mention is stored as both a mention and a link.

## Picking the page first

The page is chosen from the Directory entry alone and the "Yours" aggregate is
joined to it only when the sort reads it; otherwise it is counted for the
page's hundred handles. "Cited by your channels" compiles to an uncorrelated
`IN`, which Postgres hashes once, so it needs no join either.

## Totals

The Language counts are one GROUP BY over the view without its Language
Conditions. When the view has none, their sum *is* the total, so the total
costs nothing more and is always exact; only a view with a Language Condition
counts again. Both are cached per Account and view for a few minutes, so
paging and re-sorting reuse them. The key carries the Account's Follow count, so
a follow or an unfollow is never read through a stale total.
"""

from __future__ import annotations

import math
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, get_args

from sqlalchemy import (
    ARRAY,
    ColumnElement,
    DateTime,
    Float,
    String,
    and_,
    any_,
    cast,
    distinct,
    false,
    func,
    literal,
    or_,
    true,
)
from sqlalchemy import select as sa_select
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import TSQUERY
from sqlmodel import Session, col

from app.models_tg import (
    DirectoryEntry,
    DirectorySearchDocument,
    PostReference,
    utc_now,
)
from app.services import search_text
from app.services.channel_directory import LISTED_KIND, followed_reach
from app.services.channel_directory_samples import samples_by_handle
from app.services.follows import visible_channel_names
from app.services.post_filters import (
    TreeAtom,
    TreeGroup,
    TreeNode,
    compile_tree,
    prune_tree,
    tree_conds,
)
from app.services.tenancy import unscoped_select

PAGE_SIZE = 100
#: How long a view's total and Language counts, and the Directory's size, are
#: reused. A Directory that grows while it is read moves by a row or two.
COUNTS_TTL_SECONDS = 300
_MAX_CACHED_VIEWS = 1000

#: Why nothing here goes through `scoped_select`.
_SCOPE_REASON = (
    "Directory entries and References are corpus (`tenancy.SCOPES`): a fact "
    "about a public Channel has one answer for every Account. What is private "
    "to the Account, its Follows, comes in through `visible_channel_names`."
)

# ---- The vocabulary -----------------------------------------------------------

#: What a bound, the distribution and the sort can read off an entry.
DirectoryMeasure = Literal[
    "subscribers",
    "reach",
    "posts_per_week",
    "forward_pct",
    "last_post_days",
    "found_days",
    "photos",
    "videos",
    "files",
    "links",
]
DIRECTORY_MEASURES: tuple[DirectoryMeasure, ...] = get_args(DirectoryMeasure)
#: The measures plus the two "your channels" reads: how many cite it, and how
#: many days since the newest of them did.
DirectorySort = Literal[DirectoryMeasure, "mine", "mine_last_days", "relevance"]
DirectoryFlag = Literal["followed", "followable"]
ReferenceKind = Literal["forward", "mention", "link", "reply"]
#: Every follow, the Channels tab selection, or the Channels ticked here.
YoursSource = Literal["follows", "selection", "ticked"]
#: Where a search looks: the handle and display name, the bio, the samples.
SearchField = Literal["name", "bio", "posts"]
SEARCH_FIELDS: tuple[SearchField, ...] = get_args(SearchField)
_WEIGHTS: dict[SearchField, str] = {"name": "A", "bio": "B", "posts": "C"}
Scale = Literal["log", "linear"]

#: Measures whose spread is drawn on a log scale; the rest are linear.
_LINEAR: frozenset[str] = frozenset({"forward_pct", "found_days"})
_HISTOGRAM_BINS = 32


@dataclass(frozen=True)
class LanguageCond:
    value: str


@dataclass(frozen=True)
class NameCond:
    """Any part of the handle or the display name, case-insensitive."""

    value: str


@dataclass(frozen=True)
class MeasureCond:
    """A bound, either end open; `none` keeps only the entries with no value."""

    measure: DirectoryMeasure
    min: float | None = None
    max: float | None = None
    none: bool = False


@dataclass(frozen=True)
class FlagCond:
    value: DirectoryFlag


@dataclass(frozen=True)
class MineCond:
    """Cited by your channels, ever or within the last `days`."""

    days: int | None = None


DirectoryCond = LanguageCond | NameCond | MeasureCond | FlagCond | MineCond
DirectoryTree = TreeGroup[DirectoryCond]


@dataclass(frozen=True)
class SearchQuery:
    """What was typed, resolved against every text search configuration."""

    fields: tuple[SearchField, ...]
    #: The words as one `tsquery`; `None` when no word survived.
    tsquery: str | None
    #: The normalised text for the trigram typo match on names; "" for none.
    typo: str
    #: Every lexeme the `tsquery` names, for highlighting.
    stems: frozenset[str]


@dataclass(frozen=True)
class DirectoryView:
    """Everything a Directory read is evaluated under, resolved for one Account."""

    user_id: uuid.UUID
    tree: DirectoryTree | None
    #: Lowercased handles the Account follows.
    followed: frozenset[str]
    #: Lowercased handles "your channels" are, already resolved.
    sources: frozenset[str]
    #: Empty means every kind.
    kinds: tuple[ReferenceKind, ...]
    now: datetime
    search: SearchQuery | None = None


def resolve_view(
    session: Session,
    user_id: uuid.UUID,
    *,
    tree: DirectoryTree | None,
    source: YoursSource,
    handles: Sequence[str],
    kinds: Sequence[ReferenceKind],
    search: tuple[str, Sequence[SearchField]] | None = None,
) -> DirectoryView:
    """The view, with "every follow" resolved from the Account's own Follows.

    Handles the browser sends are taken as they are: a selection or a tick list
    that is empty counts 0 for every row, and is never swapped for anything.
    `search` is what was typed and the fields it looks in.
    """
    followed = frozenset(visible_channel_names(session, user_id=user_id))
    sources = (
        followed
        if source == "follows"
        else frozenset(h.strip().lstrip("@").lower() for h in handles if h.strip())
    )
    return DirectoryView(
        user_id=user_id,
        tree=tree,
        followed=followed,
        sources=sources,
        kinds=tuple(sorted(set(kinds))),
        now=utc_now(),
        search=None if search is None else resolve_search(session, *search),
    )


# ---- Search (DIR-04, ADR-027) ---------------------------------------------------

_PER_CONFIG = sa_text(
    """
    SELECT o.i, c.cfg, to_tsquery(CAST(c.cfg AS regconfig), o.op)::text
    FROM unnest(CAST(:ops AS text[])) WITH ORDINALITY AS o(op, i)
    CROSS JOIN unnest(CAST(:cfgs AS text[])) AS c(cfg)
    """
)


def resolve_search(
    session: Session, text: str, fields: Sequence[SearchField]
) -> SearchQuery:
    """What was typed, as one `tsquery` over every configuration a row can use.

    Every word but the last matches whole and the last as a prefix from
    `search_text.PREFIX_FROM` characters. Each word is tried under every
    configuration and the words are joined with AND. A word one configuration
    drops as a stop word is left out: rows indexed under that configuration
    hold no lexeme for it, so keeping it would make "the news" miss every
    English Channel. The fields become weight labels, so a field limit is read
    from the same index.
    """
    chosen = tuple(f for f in SEARCH_FIELDS if f in set(fields))
    weights = (
        ""
        if len(chosen) == len(SEARCH_FIELDS)
        else "".join(_WEIGHTS[f] for f in chosen)
    )
    terms = search_text.query_terms(text)
    operands = [
        search_text.term_operand(t, last=i == len(terms) - 1, weights=weights)
        for i, t in enumerate(terms)
    ]
    per_term: dict[int, list[str]] = {}
    if operands:
        for i, _cfg, query in session.execute(
            _PER_CONFIG, {"ops": operands, "cfgs": list(search_text.CONFIGS)}
        ).all():
            per_term.setdefault(int(i), []).append(str(query))
    kept = [parts for parts in per_term.values() if all(parts)]
    if not kept:
        kept = [[p for p in parts if p] for parts in per_term.values()]
    words = [" | ".join(sorted(set(parts))) for parts in kept if parts]
    tsquery = " & ".join(f"( {w} )" for w in words) or None
    typo = " ".join(terms)
    return SearchQuery(
        fields=chosen,
        tsquery=tsquery,
        typo=typo if "name" in chosen and len(typo) >= search_text.PREFIX_FROM else "",
        stems=frozenset(search_text.lexemes(tsquery or "")),
    )


def _search_match(search: SearchQuery) -> ColumnElement[bool]:
    doc = DirectorySearchDocument
    clauses: list[ColumnElement[bool]] = []
    if search.tsquery:
        clauses.append(col(doc.tsv).op("@@")(cast(literal(search.tsquery), TSQUERY)))
    if search.typo:
        # `<%` is word similarity, so a typo inside a longer name still counts.
        clauses.append(literal(search.typo).op("<%")(col(doc.names)))
    return or_(*clauses) if clauses else false()


def _relevance(search: SearchQuery) -> ColumnElement[Any]:
    """Match strength times the log of subscribers (ADR-027)."""
    doc = DirectorySearchDocument
    strength: ColumnElement[Any] = literal(0.0)
    if search.tsquery:
        strength = func.ts_rank(col(doc.tsv), cast(literal(search.tsquery), TSQUERY), 1)
    if search.typo:
        # A name typed with a typo ranks below most word matches.
        strength = func.greatest(
            strength, func.word_similarity(search.typo, col(doc.names)) * 0.1
        )
    return strength * func.ln(10 + func.coalesce(col(DirectoryEntry.subscribers), 0))


# ---- Compiling the tree ---------------------------------------------------------


def _handles(values: frozenset[str] | Sequence[str]) -> Any:
    return literal(sorted(values), ARRAY(String))


def _listed() -> ColumnElement[bool]:
    return col(DirectoryEntry.kind) == LISTED_KIND


def _days_since(column: Any, now: datetime) -> ColumnElement[Any]:
    # A bound parameter for `now` rather than SQL's `now()`: the columns are
    # naive UTC, and `now()` would bring the session's time zone into it.
    return func.extract("epoch", literal(now, DateTime) - column) / 86400.0


def measure_sql(measure: DirectoryMeasure, now: datetime) -> ColumnElement[Any]:
    """`measure` for each entry; NULL where the entry has no value."""
    if measure == "forward_pct":
        return col(DirectoryEntry.forward_share) * 100.0
    if measure == "last_post_days":
        return _days_since(col(DirectoryEntry.last_post_at), now)
    if measure == "found_days":
        return _days_since(col(DirectoryEntry.created_at), now)
    return cast(getattr(DirectoryEntry, measure), Float)


def _references(view: DirectoryView) -> list[ColumnElement[bool]]:
    """The References "your channels" make, narrowed by the Reference kinds."""
    clauses = [col(PostReference.source_channel) == any_(_handles(view.sources))]
    if view.kinds:
        clauses.append(col(PostReference.kind) == any_(_handles(view.kinds)))
    return clauses


def _atom(cond: DirectoryCond, view: DirectoryView) -> ColumnElement[bool]:
    handle = col(DirectoryEntry.handle)
    if isinstance(cond, LanguageCond):
        return col(DirectoryEntry.language) == cond.value
    if isinstance(cond, NameCond):
        return or_(
            handle.icontains(cond.value, autoescape=True),
            col(DirectoryEntry.display_name).icontains(cond.value, autoescape=True),
        )
    if isinstance(cond, FlagCond):
        if cond.value == "followable":
            return col(DirectoryEntry.status) == "ok"
        return handle == any_(_handles(view.followed))
    if isinstance(cond, MineCond):
        if not view.sources:
            return false()
        refs = _references(view)
        if cond.days is not None:
            since_ms = int(view.now.timestamp() * 1000) - cond.days * 86_400_000
            refs.append(col(PostReference.timestamp) >= since_ms)
        # Uncorrelated, so Postgres hashes it once even under an OR or a NOT.
        return handle.in_(sa_select(col(PostReference.target_handle)).where(*refs))
    value = measure_sql(cond.measure, view.now)
    if cond.none:
        return value.is_(None)
    bounds: list[ColumnElement[bool]] = [value.is_not(None)]
    if cond.min is not None:
        bounds.append(value >= cond.min)
    if cond.max is not None:
        bounds.append(value <= cond.max)
    return and_(*bounds)


def _where(view: DirectoryView, tree: TreeNode[DirectoryCond] | None) -> Any:
    clause = true() if tree is None else compile_tree(tree, lambda c: _atom(c, view))
    if view.search is None:
        return and_(_listed(), clause)
    doc = DirectorySearchDocument
    found = col(DirectoryEntry.handle).in_(
        sa_select(col(doc.handle)).where(_search_match(view.search))
    )
    return and_(_listed(), clause, found)


def _without(tree: DirectoryTree | None, drop: Any) -> TreeGroup[DirectoryCond] | None:
    return None if tree is None else prune_tree(tree, drop)


# ---- "Your channels" --------------------------------------------------------------


def _mine_aggregate(view: DirectoryView, among: Sequence[str] | None = None) -> Any:
    """Per cited handle: distinct Citing Channels among the sources, and the newest."""
    refs = _references(view)
    if among is not None:
        refs.append(col(PostReference.target_handle) == any_(_handles(among)))
    return (
        sa_select(
            col(PostReference.target_handle).label("handle"),
            func.count(distinct(col(PostReference.source_channel))).label("n"),
            func.max(col(PostReference.timestamp)).label("last_at"),
        )
        .where(*refs)
        .group_by(col(PostReference.target_handle))
        .subquery("mine")
    )


# ---- The page ---------------------------------------------------------------------


@dataclass(frozen=True)
class MatchedPost:
    post_id: int
    timestamp: int
    parts: list[search_text.SnippetPart]


@dataclass(frozen=True)
class DirectoryMatch:
    """Why a row matched: the bio and the newest Post, matched words marked."""

    bio: list[search_text.SnippetPart] | None
    post: MatchedPost | None


@dataclass(frozen=True)
class DirectoryRow:
    handle: str
    display_name: str | None
    photo_url: str | None
    language: str | None
    subscribers: int | None
    reach: int | None
    reach_estimated: bool
    posts_per_week: float | None
    forward_share: float | None
    last_post_at: int | None
    found_at: int
    photos: int | None
    videos: int | None
    files: int | None
    links: int | None
    followable: bool
    followed: bool
    mine: int
    mine_last_at: int | None
    #: `None` unless a search asked for its matches.
    match: DirectoryMatch | None = None


@dataclass(frozen=True)
class LanguageCount:
    language: str | None
    count: int


@dataclass(frozen=True)
class DirectoryPage:
    rows: list[DirectoryRow]
    total: int
    languages: list[LanguageCount]
    #: How many Channels "your channels" are, so an empty source can say so.
    yours_size: int


def _ms(moment: datetime | None) -> int | None:
    # Naive UTC columns; see `channel_directory._epoch_ms`.
    return None if moment is None else _epoch_ms(moment)


def _epoch_ms(moment: datetime) -> int:
    return int(moment.replace(tzinfo=UTC).timestamp() * 1000)


def _page_handles(
    session: Session,
    view: DirectoryView,
    *,
    sort: DirectorySort,
    descending: bool,
    page: int,
) -> list[str]:
    handle = col(DirectoryEntry.handle)
    statement = unscoped_select(
        sa_select(handle).where(_where(view, view.tree)), reason=_SCOPE_REASON
    )
    if sort == "relevance" and view.search is not None:
        doc = DirectorySearchDocument
        statement = statement.join(doc, col(doc.handle) == handle)
        key: Any = _relevance(view.search)
    elif sort == "mine" or sort == "mine_last_days":
        mine = _mine_aggregate(view)
        statement = statement.outerjoin(mine, mine.c.handle == handle)
        now_ms = _epoch_ms(view.now)
        key = (
            func.coalesce(mine.c.n, 0)
            if sort == "mine"
            else (now_ms - mine.c.last_at) / 86_400_000.0
        )
    elif sort == "relevance":
        # Relevance with nothing searched has nothing to rank by.
        key = literal(0)
    else:
        key = measure_sql(sort, view.now)
    ordered = key.desc() if descending else key.asc()
    statement = (
        statement.order_by(ordered.nulls_last(), handle)
        .offset(page * PAGE_SIZE)
        .limit(PAGE_SIZE)
    )
    return [str(h) for h in session.execute(statement).scalars().all()]


def _matches(
    session: Session, search: SearchQuery, handles: list[str]
) -> dict[str, DirectoryMatch]:
    """The snippets for the page's rows, cut in Python (ADR-027).

    Only for the rows on the page, which is what keeps them cheap: Postgres's
    `ts_headline` re-parses the whole document per row, and could not match a
    folded Persian letter or a CJK pair against the original text anyway. The
    Post quoted is the newest of the indexed samples that matches.
    """
    stems = set(search.stems)
    if not stems or not handles:
        return {}
    bios: dict[str, str | None] = {}
    if "bio" in search.fields:
        bios = {
            str(h): b
            for h, b in session.execute(
                unscoped_select(
                    sa_select(
                        col(DirectoryEntry.handle), col(DirectoryEntry.bio)
                    ).where(col(DirectoryEntry.handle) == any_(_handles(handles))),
                    reason=_SCOPE_REASON,
                )
            ).all()
        }
    posts: dict[str, MatchedPost] = {}
    if "posts" in search.fields:
        for handle, samples in samples_by_handle(session, handles).items():
            for sample, words in search_text.indexed(samples):
                parts = search_text.snippet(words, stems)
                if parts is not None:
                    posts[handle] = MatchedPost(
                        post_id=sample.post_id, timestamp=sample.timestamp, parts=parts
                    )
                    break
    out = {}
    for handle in handles:
        bio = bios.get(handle)
        out[handle] = DirectoryMatch(
            bio=None if not bio else search_text.snippet(bio, stems),
            post=posts.get(handle),
        )
    return out


def _rows(
    session: Session,
    view: DirectoryView,
    handles: list[str],
    *,
    show_matches: bool = False,
) -> list[DirectoryRow]:
    if not handles:
        return []
    d = DirectoryEntry
    entries = {
        row.handle: row
        for row in session.execute(
            unscoped_select(
                sa_select(
                    col(d.handle),
                    col(d.display_name),
                    col(d.photo_url),
                    col(d.language),
                    col(d.subscribers),
                    col(d.reach),
                    col(d.reach_estimated),
                    col(d.posts_per_week),
                    col(d.forward_share),
                    col(d.last_post_at),
                    col(d.created_at),
                    col(d.photos),
                    col(d.videos),
                    col(d.files),
                    col(d.links),
                    col(d.status),
                ).where(col(d.handle) == any_(_handles(handles))),
                reason=_SCOPE_REASON,
            )
        ).all()
    }
    mine: dict[str, tuple[int, int | None]] = {}
    if view.sources:
        aggregate = _mine_aggregate(view, among=handles)
        mine = {
            str(h): (int(n), last_at)
            for h, n, last_at in session.execute(sa_select(aggregate)).all()
        }
    # A followed Channel answers the Post-based Reach, as everywhere else.
    reach = followed_reach(session, set(handles))
    matches = (
        _matches(session, view.search, handles)
        if show_matches and view.search is not None
        else {}
    )
    rows = []
    for handle in handles:
        e = entries[handle]
        n, last_at = mine.get(handle, (0, None))
        own = reach.get(handle)
        rows.append(
            DirectoryRow(
                handle=handle,
                display_name=e.display_name,
                photo_url=e.photo_url,
                language=e.language,
                subscribers=e.subscribers,
                reach=e.reach if own is None else own.value,
                reach_estimated=e.reach_estimated if own is None else own.estimated,
                posts_per_week=e.posts_per_week,
                forward_share=e.forward_share,
                last_post_at=_ms(e.last_post_at),
                found_at=_epoch_ms(e.created_at),
                photos=e.photos,
                videos=e.videos,
                files=e.files,
                links=e.links,
                followable=e.status == "ok",
                followed=handle in view.followed,
                mine=n,
                mine_last_at=last_at,
                match=matches.get(handle),
            )
        )
    return rows


# ---- Totals, cached ---------------------------------------------------------------

_counts: dict[str, tuple[float, int, list[LanguageCount]]] = {}
_size: list[tuple[float, int]] = []


def forget_cached_counts() -> None:
    """Drop every cached total, Language count and the Directory's size."""
    _counts.clear()
    _size.clear()


def _view_key(view: DirectoryView, tree: DirectoryTree | None) -> str:
    return repr(
        (
            view.user_id,
            len(view.followed),
            tree,
            sorted(view.sources) if _reads_sources(tree) else None,
            view.kinds if _reads_sources(tree) else None,
            view.search,
        )
    )


def _reads_sources(tree: DirectoryTree | None) -> bool:
    return tree is not None and any(isinstance(c, MineCond) for c in tree_conds(tree))


def _is_language(cond: DirectoryCond) -> bool:
    return isinstance(cond, LanguageCond)


def _count(
    session: Session, view: DirectoryView, tree: TreeNode[DirectoryCond] | None
) -> int:
    statement = unscoped_select(
        sa_select(func.count()).select_from(DirectoryEntry).where(_where(view, tree)),
        reason=_SCOPE_REASON,
    )
    return int(session.execute(statement).scalar_one())


def _totals(session: Session, view: DirectoryView) -> tuple[int, list[LanguageCount]]:
    key = _view_key(view, view.tree)
    hit = _counts.get(key)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1], hit[2]
    without = _without(view.tree, _is_language)
    language = col(DirectoryEntry.language)
    statement = unscoped_select(
        sa_select(language, func.count())
        .where(_where(view, without))
        .group_by(language)
        .order_by(func.count().desc(), language),
        reason=_SCOPE_REASON,
    )
    languages = [
        LanguageCount(language=lang, count=int(n))
        for lang, n in session.execute(statement).all()
    ]
    has_language = view.tree is not None and any(
        _is_language(c) for c in tree_conds(view.tree)
    )
    total = (
        _count(session, view, view.tree)
        if has_language
        else sum(entry.count for entry in languages)
    )
    if len(_counts) >= _MAX_CACHED_VIEWS:
        _counts.clear()
    _counts[key] = (time.monotonic() + COUNTS_TTL_SECONDS, total, languages)
    return total, languages


def list_page(
    session: Session,
    view: DirectoryView,
    *,
    sort: DirectorySort,
    descending: bool,
    page: int,
    show_matches: bool = False,
) -> DirectoryPage:
    """One page of the view, its total and its Language counts.

    `show_matches` adds each row's snippets while a search is on; without it
    the samples are not read at all.
    """
    handles = _page_handles(session, view, sort=sort, descending=descending, page=page)
    total, languages = _totals(session, view)
    return DirectoryPage(
        rows=_rows(session, view, handles, show_matches=show_matches),
        total=total,
        languages=languages,
        yours_size=len(view.sources),
    )


def count_view(
    session: Session, view: DirectoryView, candidate: TreeAtom[DirectoryCond] | None
) -> int:
    """How many entries the view leaves, with `candidate` added with AND when given."""
    if candidate is None:
        return _totals(session, view)[0]
    parts: tuple[TreeAtom[DirectoryCond] | TreeGroup[DirectoryCond], ...] = (
        (candidate,) if view.tree is None else (view.tree, candidate)
    )
    return _count(session, view, TreeGroup(op="and", children=parts))


def newest_references(
    session: Session, view: DirectoryView, handles: Sequence[str]
) -> dict[str, dict[str, Any]]:
    """Per handle, the newest Reference "your channels" make to it, as a discovered-via.

    In the shape `ChannelFollow.discovered_via` stores; a handle none of them
    cites is absent.
    """
    targets = sorted({h.strip().lstrip("@").lower() for h in handles if h.strip()})
    if not view.sources or not targets:
        return {}
    r = PostReference
    rows = session.execute(
        unscoped_select(
            sa_select(
                col(r.target_handle),
                col(r.source_channel),
                col(r.source_post_id),
                col(r.timestamp),
            )
            .where(*_references(view), col(r.target_handle) == any_(_handles(targets)))
            .distinct(col(r.target_handle))
            .order_by(
                col(r.target_handle), col(r.timestamp).desc(), col(r.source_post_id)
            ),
            reason=_SCOPE_REASON,
        )
    ).all()
    return {
        str(target): {"channelName": source, "postId": post_id, "timestamp": ts}
        for target, source, post_id, ts in rows
    }


def directory_size(session: Session) -> int:
    """How many Channels the Directory lists at all: the filter row's "of M"."""
    if _size and _size[0][0] > time.monotonic():
        return _size[0][1]
    statement = unscoped_select(
        sa_select(func.count()).select_from(DirectoryEntry).where(_listed()),
        reason=_SCOPE_REASON,
    )
    size = int(session.execute(statement).scalar_one())
    _size[:] = [(time.monotonic() + COUNTS_TTL_SECONDS, size)]
    return size


# ---- A measure's spread -------------------------------------------------------------


@dataclass(frozen=True)
class Bin:
    lo: float
    hi: float
    count: int


@dataclass(frozen=True)
class Distribution:
    scale: Scale
    #: Entries in the view under every other Condition.
    total: int
    #: Of those, how many have no value and so fail any bound on this measure.
    no_value: int
    min: float | None
    max: float | None
    median: float | None
    bins: list[Bin]


def distribution(
    session: Session, view: DirectoryView, measure: DirectoryMeasure
) -> Distribution:
    """`measure` across the view with its own bounds left out, for the bound editor."""
    tree = _without(
        view.tree, lambda c: isinstance(c, MeasureCond) and c.measure == measure
    )
    where = _where(view, tree)
    value = measure_sql(measure, view.now)
    total, measured, lo, hi, median = session.execute(
        unscoped_select(
            sa_select(
                func.count(),
                func.count(value),
                func.min(value),
                func.max(value),
                func.percentile_cont(0.5).within_group(value),
            ).where(where),
            reason=_SCOPE_REASON,
        )
    ).one()
    scale: Scale = "linear" if measure in _LINEAR else "log"
    bins: list[Bin] = []
    if measured and hi is not None and lo is not None and hi > lo:

        def to_axis(v: float) -> float:
            return math.log(max(v, 0) + 1) if scale == "log" else v

        def from_axis(u: float) -> float:
            return math.exp(u) - 1 if scale == "log" else u

        a, b = to_axis(lo), to_axis(hi)
        axis = func.ln(func.greatest(value, 0) + 1) if scale == "log" else value
        bucket = func.least(
            func.width_bucket(axis, a, b, _HISTOGRAM_BINS), _HISTOGRAM_BINS
        )
        counts = {
            int(n_bucket): int(n)
            for n_bucket, n in session.execute(
                unscoped_select(
                    sa_select(bucket, func.count())
                    .where(where, value.is_not(None))
                    .group_by(bucket),
                    reason=_SCOPE_REASON,
                )
            ).all()
        }
        step = (b - a) / _HISTOGRAM_BINS
        bins = [
            Bin(
                lo=from_axis(a + i * step),
                hi=from_axis(a + (i + 1) * step),
                count=counts.get(i + 1, 0),
            )
            for i in range(_HISTOGRAM_BINS)
        ]
    return Distribution(
        scale=scale,
        total=int(total),
        no_value=int(total) - int(measured),
        min=None if lo is None else float(lo),
        max=None if hi is None else float(hi),
        median=None if median is None else float(median),
        bins=bins,
    )
