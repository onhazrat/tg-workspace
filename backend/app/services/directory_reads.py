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
can see and change. Bots, groups, personal accounts and handles not fetched yet
are listed only to a `DATA_ADMIN` reader (DPF), whose opening view is still
the followable Channels.

## "Your channels"

One set of handles per request, chosen by the view: every Channel the Account
follows (resolved here, through the Follow seam), or handles the browser sends
(its Channels tab selection, or the Channels ticked in the list). The "Yours"
count, its sort and the "Cited by your channels" Condition all read that set,
counted in **distinct** Citing Channels, never in Reference rows: twenty
Posts from one Channel cite once.

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
paging and re-sorting reuse them. The key carries the Account's Follow set, so
a follow or an unfollow is never read through a stale total; a view reading the
Dismissed Condition keys on the Account's Dismissals too, so a Dismissal or a
take-back moves the total at once (DIR-06).
"""

from __future__ import annotations

import math
import time
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Literal, get_args

from sqlalchemy import (
    ARRAY,
    ColumnElement,
    DateTime,
    Float,
    Select,
    String,
    all_,
    and_,
    any_,
    case,
    cast,
    distinct,
    false,
    func,
    literal,
    or_,
    outerjoin,
    true,
)
from sqlalchemy import select as sa_select
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import TSQUERY
from sqlmodel import Session, col, select

from app.models_tg import (
    Channel,
    CitationCount,
    CitationPair,
    DirectoryEntry,
    DirectorySearchDocument,
    PostReference,
    utc_now,
)
from app.services import search_text, tags
from app.services.channel_directory import LISTED_KIND
from app.services.channel_directory_samples import samples_by_handle
from app.services.channel_tags import tag_key
from app.services.dismissals import dismissed_handles
from app.services.follows import visible_channel_names
from app.services.language import NOT_READ
from app.services.post_filters import (
    TreeAtom,
    TreeGroup,
    TreeNode,
    compile_tree,
    map_tree,
    prune_tree,
    tree_conds,
)
from app.services.posts import lookup_posts
from app.services.settings_registry import DIRECTORY_COLUMNS_KEY
from app.services.settings_store import get_global_setting
from app.services.telegram_web import normalize_handle
from app.services.tenancy import scoped_select, unscoped_select

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
    "photos",
    "videos",
    "files",
    "links",
    # Distinct Channels citing it and it cites, every kind (DIR-05, ADR-028).
    "cited_by",
    "cites",
    "sample_count",
    # The probe queue's numbers (DPF), `DATA_ADMIN` only as their columns are.
    "attempts",
    "latest_id",
    "telegram_chat_id",
    "priority",
    "priority_boost",
    "effective_priority",
]
DIRECTORY_MEASURES: tuple[DirectoryMeasure, ...] = get_args(DirectoryMeasure)
#: An entry's moments, each named by its column (DPF). A Time bound and the sort
#: read them; the distribution reads them as epoch ms.
DirectoryMoment = Literal[
    "last_post_at",
    "created_at",
    "checked_at",
    "attempted_at",
    "retry_after",
    "refresh_due_at",
]
DIRECTORY_MOMENTS: tuple[DirectoryMoment, ...] = get_args(DirectoryMoment)
#: What the "is" Condition tests, and what the "contains" Condition searches.
IsField = Literal["status", "kind"]
ContainsField = Literal["last_error"]
TimeMode = Literal["live", "fixed"]
#: Every column of the catalogue, plus the "your channels" reads: how many cite
#: it, and how many days since the newest of them did.
DirectorySort = Literal[
    DirectoryMeasure,
    DirectoryMoment,
    "language",
    "status",
    "kind",
    "followable",
    "bio",
    "last_error",
    "mine",
    "mine_last_days",
    "relevance",
    # The weighted score of the first Shared parents / children Condition (DIR-07).
    "shared_parents",
    "shared_children",
]
DirectoryFlag = Literal["followed", "followable", "dismissed"]
ReferenceKind = Literal["forward", "mention", "link", "reply"]
#: Shared parents: cited by whoever cites the Seeds. Shared children: cites
#: what the Seeds cite (DIR-07).
SharedRelation = Literal["parents", "children"]
#: Every follow, the Channels tab selection, or the Channels ticked here.
YoursSource = Literal["follows", "selection", "ticked"]
#: Where a search looks: the handle and display name, the bio, the samples.
SearchField = Literal["name", "bio", "posts"]
SEARCH_FIELDS: tuple[SearchField, ...] = get_args(SearchField)
_WEIGHTS: dict[SearchField, str] = {"name": "A", "bio": "B", "posts": "C"}
Scale = Literal["log", "linear"]

#: A column of the Directory table (DCOL), in table order: the ten the table
#: always had, then the rest of the Channel counters, then what the probe
#: recorded, then the probe queue's own bookkeeping. Every column of
#: `tg_channel_directory` but the four the Channel cell already shows or that
#: never vary in this list (handle, display name, photo, kind).
DirectoryColumn = Literal[
    "language",
    "subscribers",
    "reach",
    "posts_per_week",
    "forward_pct",
    "last_post_at",
    "mine",
    "cited_by",
    "cites",
    "created_at",
    "photos",
    "videos",
    "files",
    "links",
    "status",
    "followable",
    "kind",
    "bio",
    "sample_count",
    "checked_at",
    "refresh_due_at",
    "attempts",
    "last_error",
    "attempted_at",
    "retry_after",
    "priority",
    "priority_boost",
    "effective_priority",
    "telegram_chat_id",
    "latest_id",
]
DIRECTORY_COLUMNS: tuple[DirectoryColumn, ...] = get_args(DirectoryColumn)
#: The probe queue's bookkeeping, for `DATA_ADMIN` only: `last_error` is the
#: text of whatever exception a probe raised, which can name a proxy, and the
#: proxies themselves are behind that Permission. `kind` too, since only a
#: holder is shown an entry that is not a Channel (DPF).
#:
#: A sort or a Condition naming one of these is refused to anybody else
#: (`internal_reads`): ordering or narrowing by a value leaks it a row at a time.
INTERNAL_COLUMNS: frozenset[DirectoryColumn] = frozenset(
    {
        "kind",
        "attempts",
        "last_error",
        "attempted_at",
        "retry_after",
        "priority",
        "priority_boost",
        "effective_priority",
        "telegram_chat_id",
        "latest_id",
    }
)
#: On by default until an Operator stores defaults of their own: the ten the
#: table showed before the catalogue existed. Once stored, a column the stored
#: defaults do not name is off.
OPENING_COLUMNS: tuple[DirectoryColumn, ...] = DIRECTORY_COLUMNS[:10]


def column_defaults(session: Session) -> frozenset[DirectoryColumn]:
    """The columns on by default for this deployment."""
    stored = get_global_setting(session, DIRECTORY_COLUMNS_KEY).get("on")
    if not isinstance(stored, list):
        return frozenset(OPENING_COLUMNS)
    return frozenset(c for c in DIRECTORY_COLUMNS if c in stored)


def visible_columns(*, internals: bool) -> tuple[DirectoryColumn, ...]:
    """The catalogue one caller may see, in table order."""
    return tuple(c for c in DIRECTORY_COLUMNS if internals or c not in INTERNAL_COLUMNS)


#: Measures whose spread is drawn on a linear scale; the rest are log. The
#: queue's numbers go negative, which a log axis folds onto zero.
_LINEAR: frozenset[str] = frozenset(
    {
        "forward_pct",
        "priority",
        "priority_boost",
        "effective_priority",
        "telegram_chat_id",
        *DIRECTORY_MOMENTS,
    }
)
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
class IsCond:
    """The verdict or the kind is exactly `value`."""

    field: IsField
    value: str


@dataclass(frozen=True)
class ContainsCond:
    """Any part of the text, case-insensitive."""

    field: ContainsField
    value: str


@dataclass(frozen=True)
class TimeCond:
    """A Time bound, `[start, end)` on one moment, either end open (DPF).

    Fixed ends are epoch ms; Live ends are signed ms from the view's `now`,
    negative for the past, resolved on the server's clock so a shared link
    means one thing to every reader. `none` keeps only entries with no value.
    """

    moment: DirectoryMoment
    mode: TimeMode
    start: int | None = None
    end: int | None = None
    none: bool = False


@dataclass(frozen=True)
class MineCond:
    """Cited by your channels, ever or within the last `days`."""

    days: int | None = None


# The three Conditions taking Seeds hold either the handles the browser
# resolved or `tag`, a Tag of the reader's that `resolve_view` swaps for its
# handles before anything compiles (DFP-05).


@dataclass(frozen=True)
class CitedByCond:
    """Cited by any of the Seeds, in the view's Reference kinds."""

    seeds: tuple[str, ...]
    tag: str | None = None


@dataclass(frozen=True)
class CitesCond:
    """Cites any of the Seeds, in the view's Reference kinds."""

    seeds: tuple[str, ...]
    tag: str | None = None


@dataclass(frozen=True)
class SharedCond:
    """Shared parents or Shared children with the Seeds, at least `min` shared."""

    relation: SharedRelation
    seeds: tuple[str, ...]
    min: int = 2
    tag: str | None = None


@dataclass(frozen=True)
class TagCond:
    """In one of the reader's Tags, by name; a Tag they lack matches nothing (DFP-04)."""

    name: str


DirectoryCond = (
    LanguageCond
    | NameCond
    | MeasureCond
    | FlagCond
    | IsCond
    | ContainsCond
    | TimeCond
    | MineCond
    | CitedByCond
    | CitesCond
    | SharedCond
    | TagCond
)
DirectoryTree = TreeGroup[DirectoryCond]


@dataclass(frozen=True)
class SearchQuery:
    """What was typed, resolved against every text search configuration."""

    fields: tuple[SearchField, ...]
    #: The words as one `tsquery`; `None` when no word survived.
    tsquery: str | None
    #: For each configuration that drops some of the words as stop words, the
    #: `tsquery` without them, read only for rows indexed under it.
    relaxed: tuple[tuple[str, str], ...]
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
    #: Lowercased handles the Account has dismissed (DIR-06).
    dismissed: frozenset[str]
    #: Lowercased handles "your channels" are, already resolved.
    sources: frozenset[str]
    #: Empty means every kind.
    kinds: tuple[ReferenceKind, ...]
    now: datetime
    search: SearchQuery | None = None
    #: Each Tag the tree names, by its key, resolved to the reader's handles.
    tags: Mapping[str, frozenset[str]] = field(default_factory=dict)
    #: Whether every kind of entry is listed, not only Channels. True for a
    #: `DATA_ADMIN` reader (DPF).
    every_kind: bool = False


def resolve_view(
    session: Session,
    user_id: uuid.UUID,
    *,
    tree: DirectoryTree | None,
    source: YoursSource,
    handles: Sequence[str],
    kinds: Sequence[ReferenceKind],
    search: tuple[str, Sequence[SearchField]] | None = None,
    every_kind: bool = False,
) -> DirectoryView:
    """The view, with "every follow" resolved from the Account's own Follows.

    Handles the browser sends are taken as they are: a selection or a tick list
    that is empty counts 0 for every row, and is never swapped for anything.
    `search` is what was typed and the fields it looks in. `every_kind` lists
    entries that are not Channels too, for a reader who may see them.
    """
    followed = frozenset(visible_channel_names(session, user_id=user_id))
    found = _resolve_tags(session, user_id, tree)
    sources = (
        followed
        if source == "follows"
        else frozenset(normalize_handle(h) for h in handles if h.strip())
    )
    return DirectoryView(
        user_id=user_id,
        tree=None if tree is None else _seeded(tree, found),
        followed=followed,
        dismissed=frozenset(dismissed_handles(session, user_id=user_id)),
        sources=sources,
        kinds=tuple(sorted(set(kinds))),
        now=utc_now(),
        search=None if search is None else resolve_search(session, *search),
        tags=found,
        every_kind=every_kind,
    )


def _resolve_tags(
    session: Session, user_id: uuid.UUID, tree: DirectoryTree | None
) -> dict[str, frozenset[str]]:
    """Each Tag `tree` names, by its key, resolved to `user_id`'s handles."""
    if tree is None:
        return {}
    named = {
        tag_key(name): name
        for name in map(_named_tag, tree_conds(tree))
        if name is not None
    }
    return {
        key: frozenset(tags.handles_for_tag(session, user_id=user_id, name=name))
        for key, name in named.items()
    }


def _named_tag(cond: DirectoryCond) -> str | None:
    """The Tag a Condition names: In the Tag's, or the one its Seeds come from."""
    if isinstance(cond, TagCond):
        return cond.name
    if isinstance(cond, SharedCond | CitedByCond | CitesCond):
        return cond.tag
    return None


def _seeded(tree: DirectoryTree, found: Mapping[str, frozenset[str]]) -> DirectoryTree:
    """`tree` with every Tag-sourced Seed list swapped for the Tag's handles,
    so a Tag reads exactly as the handles it holds now (DFP-05)."""

    def seeded(c: DirectoryCond) -> DirectoryCond:
        if not isinstance(c, SharedCond | CitedByCond | CitesCond) or not c.tag:
            return c
        seeds = tuple(sorted(found.get(tag_key(c.tag), frozenset())))
        return replace(c, seeds=seeds, tag=None)

    return map_tree(tree, seeded)


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
    configuration and the words are joined with AND. A word a configuration
    drops as a stop word is left out **for rows indexed under that
    configuration only** (`relaxed`): they hold no lexeme for it, so keeping it
    would make "the news" miss every English Channel, while a Persian row,
    indexed with `simple`, must still hold "only" to match "only fans". The
    fields become weight labels, so a field limit is read from the same index.
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
    per_term: dict[int, dict[str, str]] = {}
    if operands:
        for i, cfg, query in session.execute(
            _PER_CONFIG, {"ops": operands, "cfgs": list(search_text.CONFIGS)}
        ).all():
            per_term.setdefault(int(i), {})[str(cfg)] = str(query)
    # A word no configuration keeps (punctuation `simple` drops too) is gone.
    forms = [f for f in per_term.values() if any(f.values())]
    tsquery = _all_of(forms)
    relaxed = []
    for cfg in search_text.CONFIGS:
        kept = [f for f in forms if f[cfg]]
        # Every word a stop word here: the whole query, which these rows miss.
        if kept and len(kept) < len(forms):
            relaxed.append((cfg, _all_of(kept) or ""))
    typo = " ".join(terms)
    return SearchQuery(
        fields=chosen,
        tsquery=tsquery,
        relaxed=tuple(relaxed),
        typo=typo if "name" in chosen and len(typo) >= search_text.PREFIX_FROM else "",
        stems=frozenset(search_text.lexemes(tsquery or "")),
    )


def _all_of(forms: Sequence[dict[str, str]]) -> str | None:
    """Each word as any of its forms, the words joined with AND."""
    words = [" | ".join(sorted({q for q in f.values() if q})) for f in forms]
    return " & ".join(f"( {w} )" for w in words) or None


def _matches_query(query: str) -> ColumnElement[bool]:
    return col(DirectorySearchDocument.tsv).op("@@")(cast(literal(query), TSQUERY))


def _search_match(search: SearchQuery) -> ColumnElement[bool]:
    doc = DirectorySearchDocument
    clauses: list[ColumnElement[bool]] = []
    if search.tsquery:
        clauses.append(_matches_query(search.tsquery))
    for cfg, query in search.relaxed:
        clauses.append(and_(col(doc.ts_config) == cfg, _matches_query(query)))
    if search.typo:
        # `<%` is word similarity, so a typo inside a longer name still counts.
        clauses.append(literal(search.typo).op("<%")(col(doc.names)))
    return or_(*clauses) if clauses else false()


def _relevance(search: SearchQuery) -> ColumnElement[Any]:
    """Match strength times the log of subscribers (ADR-027)."""
    doc = DirectorySearchDocument
    strength: ColumnElement[Any] = literal(0.0)
    if search.tsquery:
        strength = _rank(search.tsquery)
    if search.relaxed:
        strength = case(
            *((col(doc.ts_config) == cfg, _rank(q)) for cfg, q in search.relaxed),
            else_=strength,
        )
    if search.typo:
        # A name typed with a typo ranks below most word matches.
        strength = func.greatest(
            strength, func.word_similarity(search.typo, col(doc.names)) * 0.1
        )
    return strength * func.ln(10 + func.coalesce(col(DirectoryEntry.subscribers), 0))


def _rank(query: str) -> ColumnElement[Any]:
    tsv = col(DirectorySearchDocument.tsv)
    return func.ts_rank(tsv, cast(literal(query), TSQUERY), 1)


# ---- Compiling the tree ---------------------------------------------------------


def _handles(values: frozenset[str] | Sequence[str]) -> Any:
    return literal(sorted(values), ARRAY(String))


def _listed(every_kind: bool = False) -> ColumnElement[bool]:
    """Channels only, unless the reader may see every kind (DPF). The search
    document holds Channels only either way, so a search never reaches the rest."""
    return true() if every_kind else col(DirectoryEntry.kind) == LISTED_KIND


def measure_sql(measure: DirectoryMeasure | DirectoryMoment) -> ColumnElement[Any]:
    """`measure` for each entry, a moment as epoch ms; NULL where it has no value."""
    if measure == "forward_pct":
        return col(DirectoryEntry.forward_share) * 100.0
    if measure in DIRECTORY_MOMENTS:
        # Naive UTC columns, whose epoch Postgres reads without a time zone.
        return func.extract("epoch", getattr(DirectoryEntry, measure)) * 1000.0
    if measure in _COUNTED:
        # Read off `_entries`' join; a handle with no row cites, and is cited
        # by, nobody.
        return cast(func.coalesce(getattr(CitationCount, measure), 0), Float)
    return cast(getattr(DirectoryEntry, measure), Float)


#: The measures `tg_citation_counts` holds rather than the entry.
_COUNTED: frozenset[str] = frozenset({"cited_by", "cites"})


def _entries(tree: TreeNode[DirectoryCond] | None, *reads: str) -> Any:
    """What a Directory statement reads from: the entries, joined to their
    citation counts only when the tree or one of `reads` (a sort, a measure)
    reads them. A hash join over the counts measured 0.2 s on the staging
    copy where a correlated lookup per entry took 2.6 s."""
    counted = any(m in _COUNTED for m in reads) or (
        tree is not None
        and any(
            isinstance(c, MeasureCond) and c.measure in _COUNTED
            for c in tree_conds(tree)
        )
    )
    if not counted:
        return DirectoryEntry
    return outerjoin(
        DirectoryEntry,
        CitationCount,
        col(CitationCount.handle) == col(DirectoryEntry.handle),
    )


def _of_kinds(view: DirectoryView) -> list[ColumnElement[bool]]:
    if not view.kinds:
        return []
    return [col(PostReference.kind) == any_(_handles(view.kinds))]


def _references(
    view: DirectoryView, *, days: int | None = None
) -> list[ColumnElement[bool]]:
    """The References "your channels" make, narrowed by the Reference kinds,
    and to the last `days` when given."""
    clauses = [col(PostReference.source_channel) == any_(_handles(view.sources))]
    clauses += _of_kinds(view)
    if days is not None:
        since_ms = _epoch_ms(view.now) - days * 86_400_000
        clauses.append(col(PostReference.timestamp) >= since_ms)
    return clauses


# ---- Shared parents and Shared children (DIR-07) ----------------------------------
#
# Both read the citation pairs, which keep no kinds, so the view's Reference
# kinds do not narrow them.

#: A middle Channel past this many links is an aggregator, not a taste: a
#: source citing more than this many Channels, or a target cited by more.
AGGREGATOR_LINKS = 3000


def _ends(relation: SharedRelation) -> tuple[Any, Any]:
    """The pair's (middle, candidate) ends: parents cite the candidate, children
    are cited by it."""
    p = CitationPair
    if relation == "parents":
        return col(p.citing_handle), col(p.cited_handle)
    return col(p.cited_handle), col(p.citing_handle)


def _middle(cond: SharedCond) -> Any:
    """The Channels between the Seeds and a candidate: who cites the Seeds
    (parents) or whom they cite (children), past aggregators and the Seeds."""
    middle, seed = _ends(cond.relation)
    degree = (
        CitationCount.cites if cond.relation == "parents" else CitationCount.cited_by
    )
    seeds = _handles(cond.seeds)
    return (
        sa_select(middle)
        .distinct()
        .join(CitationCount, col(CitationCount.handle) == middle)
        .where(seed == any_(seeds), middle != all_(seeds))
        .where(col(degree) <= AGGREGATOR_LINKS)
    )


def _shared(cond: SharedCond, among: Sequence[str] | None = None) -> Any:
    """Per candidate, how many middle Channels it shares with the Seeds; never a Seed."""
    middle, candidate = _ends(cond.relation)
    where = [middle.in_(_middle(cond)), candidate != all_(_handles(cond.seeds))]
    if among is not None:
        where.append(candidate == any_(_handles(among)))
    return (
        sa_select(candidate.label("handle"), func.count().label("n"))
        .where(*where)
        .group_by(candidate)
    )


def _shared_score(cond: SharedCond) -> Any:
    """The candidates passing `cond` with the weighted score the sort reads:
    shared / sqrt(degree(candidate) * |middle|), so a giant does not win by size."""
    shared = _shared(cond).having(func.count() >= cond.min).subquery("shared")
    degree = (
        CitationCount.cited_by if cond.relation == "parents" else CitationCount.cites
    )
    middles = (
        sa_select(func.count()).select_from(_middle(cond).subquery()).scalar_subquery()
    )
    score = shared.c.n / func.sqrt(
        func.greatest(func.coalesce(col(degree), 1), 1) * func.greatest(middles, 1)
    )
    return (
        sa_select(shared.c.handle, score.label("score"))
        .select_from(
            outerjoin(
                shared, CitationCount, col(CitationCount.handle) == shared.c.handle
            )
        )
        .subquery("shared_score")
    )


def _first_shared(
    tree: TreeNode[DirectoryCond] | None, relation: SharedRelation
) -> SharedCond | None:
    """The Condition a relation's column and sort read: its first in the tree."""
    if tree is None:
        return None
    return next(
        (
            c
            for c in tree_conds(tree)
            if isinstance(c, SharedCond) and c.relation == relation
        ),
        None,
    )


def _atom(cond: DirectoryCond, view: DirectoryView) -> ColumnElement[bool]:
    handle = col(DirectoryEntry.handle)
    if isinstance(cond, SharedCond):
        if not cond.seeds:
            return false()
        _, candidate = _ends(cond.relation)
        return handle.in_(
            _shared(cond).with_only_columns(candidate).having(func.count() >= cond.min)
        )
    if isinstance(cond, LanguageCond):
        if cond.value == NOT_READ:
            return col(DirectoryEntry.language).is_(None)
        return col(DirectoryEntry.language) == cond.value
    if isinstance(cond, TagCond):
        tagged = view.tags.get(tag_key(cond.name), frozenset())
        return handle == any_(_handles(tagged)) if tagged else false()
    if isinstance(cond, NameCond):
        return or_(
            handle.icontains(cond.value, autoescape=True),
            col(DirectoryEntry.display_name).icontains(cond.value, autoescape=True),
        )
    if isinstance(cond, IsCond):
        return col(getattr(DirectoryEntry, cond.field)) == cond.value
    if isinstance(cond, ContainsCond):
        return col(getattr(DirectoryEntry, cond.field)).icontains(
            cond.value, autoescape=True
        )
    if isinstance(cond, TimeCond):
        return _time_bound(cond, view.now)
    if isinstance(cond, FlagCond):
        if cond.value == "followable":
            return col(DirectoryEntry.status) == "ok"
        if cond.value == "dismissed":
            return handle == any_(_handles(view.dismissed))
        return handle == any_(_handles(view.followed))
    if isinstance(cond, MineCond):
        if not view.sources:
            return false()
        refs = _references(view, days=cond.days)
        # Uncorrelated, so Postgres hashes it once even under an OR or a NOT.
        return handle.in_(sa_select(col(PostReference.target_handle)).where(*refs))
    if isinstance(cond, CitedByCond | CitesCond):
        # Live from the References, not the pairs: the view's Reference kinds
        # narrow these two, and a pair keeps no kinds.
        r = PostReference
        entry_end, named_end = (
            (r.target_handle, r.source_channel)
            if isinstance(cond, CitedByCond)
            else (r.source_channel, r.target_handle)
        )
        return handle.in_(
            sa_select(col(entry_end)).where(
                col(named_end) == any_(_handles(cond.seeds)), *_of_kinds(view)
            )
        )
    value = measure_sql(cond.measure)
    if cond.none:
        return value.is_(None)
    bounds: list[ColumnElement[bool]] = [value.is_not(None)]
    if cond.min is not None:
        bounds.append(value >= cond.min)
    if cond.max is not None:
        bounds.append(value <= cond.max)
    return and_(*bounds)


def _time_bound(cond: TimeCond, now: datetime) -> ColumnElement[bool]:
    """`[start, end)` against the column itself, so a moment index could serve it."""
    column = col(getattr(DirectoryEntry, cond.moment))
    if cond.none:
        return column.is_(None)
    base = _epoch_ms(now) if cond.mode == "live" else 0
    bounds: list[ColumnElement[bool]] = [column.is_not(None)]
    if cond.start is not None:
        bounds.append(column >= literal(_naive(base + cond.start), DateTime))
    if cond.end is not None:
        bounds.append(column < literal(_naive(base + cond.end), DateTime))
    return and_(*bounds)


def _naive(ms: int) -> datetime:
    """Epoch ms as the naive UTC the columns hold."""
    return datetime.fromtimestamp(ms / 1000, UTC).replace(tzinfo=None)


def _where(view: DirectoryView, tree: TreeNode[DirectoryCond] | None) -> Any:
    clause = true() if tree is None else compile_tree(tree, lambda c: _atom(c, view))
    if view.search is None:
        return and_(_listed(view.every_kind), clause)
    doc = DirectorySearchDocument
    found = col(DirectoryEntry.handle).in_(
        sa_select(col(doc.handle)).where(_search_match(view.search))
    )
    return and_(_listed(view.every_kind), clause, found)


def internal_reads(
    tree: DirectoryTree | None, *reads: str
) -> frozenset[DirectoryColumn]:
    """The internal columns a sort, a measure or the tree's Conditions read (DPF).

    The route refuses a request naming any of them from a reader without
    `DATA_ADMIN`, because a sort or a filter on a hidden column reads it out a
    row at a time.
    """
    named = set(reads)
    for cond in () if tree is None else tree_conds(tree):
        if isinstance(cond, MeasureCond):
            named.add(cond.measure)
        elif isinstance(cond, TimeCond):
            named.add(cond.moment)
        elif isinstance(cond, IsCond | ContainsCond):
            named.add(cond.field)
    return frozenset(c for c in INTERNAL_COLUMNS if c in named)


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
    followable: bool
    followed: bool
    dismissed: bool
    #: The asked-for columns' fields, by response field name (DCOL). A column
    #: nobody asked for is absent, which is not the same as a `None` value:
    #: `None` is "not measured".
    columns: dict[str, Any] = field(default_factory=dict)
    #: The reader's Tags on it, as first written (DFP-04).
    tags: list[str] = field(default_factory=list)
    #: Shared parents / children with the first such Condition's Seeds;
    #: `None` while the view has no such Condition (DIR-07).
    shared_parents: int | None = None
    shared_children: int | None = None
    #: `None` unless a search asked for its matches.
    match: DirectoryMatch | None = None

    def fields(self) -> dict[str, Any]:
        """The row as one flat mapping, its columns beside the rest."""
        out = asdict(self)
        return {**{k: v for k, v in out.items() if k != "columns"}, **self.columns}


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
    first: Sequence[str] = (),
) -> list[str]:
    handle = col(DirectoryEntry.handle)
    ticked = sorted({normalize_handle(h) for h in first if h.strip()})
    statement = unscoped_select(
        sa_select(handle)
        .select_from(_entries(view.tree, sort))
        .where(_where(view, view.tree)),
        reason=_SCOPE_REASON,
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
    elif sort == "followable":
        key = col(DirectoryEntry.status) == "ok"
    elif (
        sort == "language"
        or sort == "status"
        or sort == "kind"
        or sort == "bio"
        or sort == "last_error"
    ):
        # Straight off a text column, in its collation's order.
        key = col(getattr(DirectoryEntry, sort))
    elif sort in DIRECTORY_MOMENTS:
        # The column itself rather than `measure_sql`'s epoch ms. The order is
        # the same, and no expression is computed for every row the sort reads,
        # which cost ~100 ms a page on staging's 1.06M entries (2026-10-18).
        key = col(getattr(DirectoryEntry, sort))
    elif sort == "shared_parents" or sort == "shared_children":
        cond = _first_shared(
            view.tree, "parents" if sort == "shared_parents" else "children"
        )
        if cond is None:
            # A stale link sorting by a relation that is off falls to the handle.
            key = literal(0)
        else:
            scored = _shared_score(cond)
            statement = statement.outerjoin(scored, scored.c.handle == handle)
            key = scored.c.score
    else:
        key = measure_sql(sort)
    ordered = key.desc() if descending else key.asc()
    leading = [(handle == any_(_handles(ticked))).desc()] if ticked else []
    statement = (
        statement.order_by(*leading, ordered.nulls_last(), handle)
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


#: Which `tg_channel_directory` columns each Directory column reads. A
#: timestamp travels as epoch ms, and `created_at` as `found_at`. The three
#: counts, `mine`, `cited_by` and `cites`, are not here: they are read off
#: other tables, and only for a page that shows them.
_ENTRY_COLUMNS: dict[DirectoryColumn, tuple[str, ...]] = {
    "language": ("language",),
    "subscribers": ("subscribers",),
    # The entry's Reach, the one the bound, the sort and the distribution
    # read. Not the Post-based one Discover shows for a followed Channel: a
    # row must never show a Reach outside the bound that let it through, or
    # out of the sort's order.
    "reach": ("reach", "reach_estimated"),
    "posts_per_week": ("posts_per_week",),
    "forward_pct": ("forward_share",),
    "last_post_at": ("last_post_at",),
    "created_at": ("created_at",),
    "photos": ("photos",),
    "videos": ("videos",),
    "files": ("files",),
    "links": ("links",),
    "status": ("status",),
    "kind": ("kind",),
    # Every row carries `followable`, shown or not: Follow reads it.
    "followable": (),
    "bio": ("bio",),
    "sample_count": ("sample_count",),
    "checked_at": ("checked_at",),
    "refresh_due_at": ("refresh_due_at",),
    "attempts": ("attempts",),
    "last_error": ("last_error",),
    "attempted_at": ("attempted_at",),
    "retry_after": ("retry_after",),
    "priority": ("priority",),
    "priority_boost": ("priority_boost",),
    "effective_priority": ("effective_priority",),
    "telegram_chat_id": ("telegram_chat_id",),
    "latest_id": ("latest_id",),
}
#: What every row reads off the entry, whatever it shows.
_ROW_CORE = ("handle", "display_name", "photo_url", "status")


def _wire(name: str, value: Any) -> tuple[str, Any]:
    key = "found_at" if name == "created_at" else name
    return key, _ms(value) if isinstance(value, datetime) else value


def _rows(
    session: Session,
    view: DirectoryView,
    handles: list[str],
    columns: frozenset[DirectoryColumn],
    *,
    show_matches: bool = False,
) -> list[DirectoryRow]:
    """The page's rows, carrying `columns` and nothing more (DCOL).

    A count no column shows is not counted: the page is already chosen and
    ordered by `_page_handles`, which reads whatever the sort and the filter
    need on its own, so skipping one here never changes which rows come back.
    """
    if not handles:
        return []
    read = sorted(
        {name for c in columns for name in _ENTRY_COLUMNS.get(c, ())} - set(_ROW_CORE)
    )
    entries = {
        e.handle: e
        for e in session.execute(
            unscoped_select(
                sa_select(
                    *(col(getattr(DirectoryEntry, n)) for n in (*_ROW_CORE, *read))
                ).where(col(DirectoryEntry.handle) == any_(_handles(handles))),
                reason=_SCOPE_REASON,
            )
        ).all()
    }
    shown = [n for c in columns for n in _ENTRY_COLUMNS.get(c, ())]
    mine: dict[str, tuple[int, int | None]] = {}
    if "mine" in columns and view.sources:
        aggregate = _mine_aggregate(view, among=handles)
        mine = {
            str(h): (int(n), last_at)
            for h, n, last_at in session.execute(sa_select(aggregate)).all()
        }
    counted: dict[str, tuple[int, int]] = {}
    if "cited_by" in columns or "cites" in columns:
        counted = {
            str(h): (int(by), int(out))
            for h, by, out in session.execute(
                unscoped_select(
                    sa_select(
                        col(CitationCount.handle),
                        col(CitationCount.cited_by),
                        col(CitationCount.cites),
                    ).where(col(CitationCount.handle) == any_(_handles(handles))),
                    reason=_SCOPE_REASON,
                )
            ).all()
        }
    shared: dict[SharedRelation, dict[str, int] | None] = {}
    for relation in get_args(SharedRelation):
        cond = _first_shared(view.tree, relation)
        shared[relation] = (
            None
            if cond is None
            else {
                str(h): int(n)
                for h, n in session.execute(_shared(cond, among=handles)).all()
            }
        )
    matches = (
        _matches(session, view.search, handles)
        if show_matches and view.search is not None
        else {}
    )
    tagged = tags.tag_names_by_handle(session, user_id=view.user_id, handles=handles)
    rows = []
    for handle in handles:
        e = entries[handle]
        values = dict(_wire(n, getattr(e, n)) for n in shown)
        if "mine" in columns:
            n, last_at = mine.get(handle, (0, None))
            values |= {"mine": n, "mine_last_at": last_at}
        if "cited_by" in columns:
            values["cited_by"] = counted.get(handle, (0, 0))[0]
        if "cites" in columns:
            values["cites"] = counted.get(handle, (0, 0))[1]
        rows.append(
            DirectoryRow(
                handle=handle,
                display_name=e.display_name,
                photo_url=e.photo_url,
                followable=e.status == "ok",
                followed=handle in view.followed,
                dismissed=handle in view.dismissed,
                columns=values,
                tags=tagged.get(handle, []),
                shared_parents=_count_of(shared["parents"], handle),
                shared_children=_count_of(shared["children"], handle),
                match=matches.get(handle),
            )
        )
    return rows


def _count_of(counts: dict[str, int] | None, handle: str) -> int | None:
    return None if counts is None else counts.get(handle, 0)


# ---- Totals, cached ---------------------------------------------------------------

_counts: dict[str, tuple[float, int, list[LanguageCount]]] = {}
#: The Directory's size per `every_kind`, with when it goes stale.
_size: dict[bool, tuple[float, int]] = {}


def forget_cached_counts() -> None:
    """Drop every cached total, Language count and the Directory's size."""
    _counts.clear()
    _size.clear()


def _view_key(view: DirectoryView, tree: DirectoryTree | None) -> str:
    return repr(
        (
            view.user_id,
            # The set, not its size: following one Channel and unfollowing
            # another within the TTL leaves the size where it was.
            hash(view.followed),
            tree,
            sorted(view.sources) if _reads(tree, MineCond) else None,
            view.kinds if _reads(tree, MineCond, CitedByCond, CitesCond) else None,
            view.search,
            # A Dismissal or a take-back changes the key, so the total moves
            # at once rather than after the TTL (DIR-06).
            hash(view.dismissed) if _reads_dismissed(tree) else None,
            # Tagging a Channel moves the total at once, like a Dismissal.
            sorted((k, hash(v)) for k, v in view.tags.items()),
            view.every_kind,
        )
    )


def _reads_dismissed(tree: DirectoryTree | None) -> bool:
    return tree is not None and FlagCond("dismissed") in tree_conds(tree)


def _reads(tree: DirectoryTree | None, *kinds: type) -> bool:
    return tree is not None and any(isinstance(c, kinds) for c in tree_conds(tree))


def _is_language(cond: DirectoryCond) -> bool:
    return isinstance(cond, LanguageCond)


def _count(
    session: Session, view: DirectoryView, tree: TreeNode[DirectoryCond] | None
) -> int:
    statement = unscoped_select(
        sa_select(func.count()).select_from(_entries(tree)).where(_where(view, tree)),
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
        .select_from(_entries(without))
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
    columns: frozenset[DirectoryColumn],
    show_matches: bool = False,
    first: Sequence[str] = (),
) -> DirectoryPage:
    """One page of the view, its total and its Language counts.

    Each row carries `columns` and nothing else of the entry (DCOL).
    `show_matches` adds each row's snippets while a search is on; without it
    the samples are not read at all. `first` (the ticked handles) leads the
    order, each part in the view's sort; it narrows nothing.
    """
    handles = _page_handles(
        session, view, sort=sort, descending=descending, page=page, first=first
    )
    total, languages = _totals(session, view)
    return DirectoryPage(
        rows=_rows(session, view, handles, columns, show_matches=show_matches),
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
    # The candidate is not in `view.tree`, so `resolve_view` never saw its Tag:
    # resolve it here, exactly as the tree's were.
    alone = TreeGroup(op="and", children=(candidate,))
    view = replace(
        view, tags={**view.tags, **_resolve_tags(session, view.user_id, alone)}
    )
    added = _seeded(alone, view.tags)
    parts = (added,) if view.tree is None else (view.tree, added)
    return _count(session, view, TreeGroup(op="and", children=parts))


#: The most entries Tick all turns into Ticks; above it a view is All matching
#: (ADR-031). The same number as the ticked Seeds a Condition takes.
MAX_TICK_ALL = 10_000


def matching(view: DirectoryView, *, unfollowed: bool = False) -> Select[tuple[str]]:
    """The handles `view` matches, as a statement a write reads from (ADR-031).

    The list's own query with no order and no page, so an All matching write
    reaches exactly the entries the list pages through. `unfollowed` leaves out
    the Account's Follows, as Follow and Dismiss do.
    """
    handle = col(DirectoryEntry.handle)
    statement = (
        sa_select(handle)
        .select_from(_entries(view.tree))
        .where(_where(view, view.tree))
    )
    if unfollowed and view.followed:
        statement = statement.where(handle != all_(_handles(view.followed)))
    return unscoped_select(statement, reason=_SCOPE_REASON)


def view_handles(session: Session, view: DirectoryView) -> list[str] | None:
    """Every handle `view` matches, by handle; `None` above `MAX_TICK_ALL`."""
    found = session.execute(
        matching(view).order_by(DirectoryEntry.handle).limit(MAX_TICK_ALL + 1)
    )
    handles = [str(h) for h in found.scalars().all()]
    return None if len(handles) > MAX_TICK_ALL else handles


def directory_follows(
    session: Session,
    user_id: uuid.UUID,
    channels: Sequence[dict[str, Any]],
    *,
    source: YoursSource,
    handles: Sequence[str],
    kinds: Sequence[ReferenceKind],
) -> list[dict[str, Any]]:
    """What a Follow from the Directory sends to the follow job.

    `channels` (`{"name", "discoveredVia"}` each) minus the ones this Account
    dismissed, since Follow is withheld on those until the Dismissal is taken
    back (DIR-06); Discover's own follow keeps its contract. Each one sent
    without a discovered-via gets the newest Reference the view's "your
    channels" make to it (DIR-02), resolved here so ticks from any page get
    one. Empty when every Channel sent is dismissed.
    """
    dismissed = dismissed_handles(session, user_id=user_id)
    kept = [c for c in channels if normalize_handle(str(c["name"])) not in dismissed]
    if not kept:
        return []
    view = resolve_view(
        session, user_id, tree=None, source=source, handles=handles, kinds=kinds
    )
    newest = newest_references(session, view, [str(c["name"]) for c in kept])
    return [
        c
        if c["discoveredVia"] is not None
        else {**c, "discoveredVia": newest.get(normalize_handle(str(c["name"])))}
        for c in kept
    ]


def newest_references(
    session: Session, view: DirectoryView, handles: Sequence[str]
) -> dict[str, dict[str, Any]]:
    """Per handle, the newest Reference "your channels" make to it, as a discovered-via.

    In the shape `ChannelFollow.discovered_via` stores; a handle none of them
    cites is absent.
    """
    targets = sorted({normalize_handle(h) for h in handles if h.strip()})
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


# ---- The detail panel (DIR-03) --------------------------------------------------------

#: What the panel shows of an entry: its measures, its Language and its bio.
_PANEL_COLUMNS: frozenset[DirectoryColumn] = frozenset(
    {
        "subscribers",
        "reach",
        "posts_per_week",
        "forward_pct",
        "last_post_at",
        "created_at",
        "photos",
        "videos",
        "files",
        "links",
        "cited_by",
        "cites",
        "language",
        "bio",
    }
)
#: And what it adds for a `DATA_ADMIN` reader: the kind, which only such a
#: reader is shown anything but a Channel of, and the Priority boost it sets
#: there (DPF).
_PANEL_INTERNALS: frozenset[DirectoryColumn] = frozenset(
    {"kind", "priority_boost", "effective_priority"}
)


def entry(
    session: Session, user_id: uuid.UUID, handle: str, *, internals: bool = False
) -> tuple[DirectoryRow, str | None] | None:
    """One listed entry by handle, as a row (with no "your channels" count)
    and its bio; `None` when the Directory does not list it to this reader.

    The panel reads this rather than the list's row, so it opens on a Channel
    that is not on the current page, and the bio stays out of the list.
    `internals` is a `DATA_ADMIN` reader, who is listed every kind.
    """
    listed = session.execute(
        unscoped_select(
            sa_select(col(DirectoryEntry.handle)).where(
                col(DirectoryEntry.handle) == handle, _listed(internals)
            ),
            reason=_SCOPE_REASON,
        )
    ).first()
    if listed is None:
        return None
    view = resolve_view(
        session, user_id, tree=None, source="selection", handles=(), kinds=()
    )
    columns = _PANEL_COLUMNS | (_PANEL_INTERNALS if internals else frozenset())
    row = _rows(session, view, [handle], columns)[0]
    return row, row.columns.pop("bio")


#: How many citing Posts "Why it's here" quotes; the rest are counted.
WHY_LIMIT = 20


@dataclass(frozen=True)
class CitingPost:
    channel: str
    display_name: str | None
    post_id: int
    timestamp: int
    kinds: list[str]
    #: `None` where the Account may not read the Post and no sample holds it.
    text: str | None


@dataclass(frozen=True)
class Why:
    posts: list[CitingPost]
    #: Every citing Post, of which `posts` are the newest.
    total: int
    #: The Channels shared with the Shared parents Seeds; `None` when that
    #: Condition is off (DIR-07).
    parents: SharedWhy | None = None
    #: The same for the Shared children Seeds.
    children: SharedWhy | None = None


def why_its_here(
    session: Session,
    view: DirectoryView,
    handle: str,
    *,
    days: int | None,
) -> Why:
    """The Posts of "your channels" that cite `handle`, newest first, and the
    Channels it shares with the Seeds of each Shared Condition in the view's
    tree, whatever the Seeds came from (DFP-05).

    One entry per Post, with every kind it cites in; inside the last `days`
    when the "Cited by your channels" Condition sets a window, so the panel
    counts what the sort and the Condition count.
    """
    parents = _first_shared(view.tree, "parents")
    children = _first_shared(view.tree, "children")
    return replace(
        _citing_posts(session, view, handle, days=days),
        parents=None if parents is None else shared_why(session, handle, parents),
        children=None if children is None else shared_why(session, handle, children),
    )


def _citing_posts(
    session: Session, view: DirectoryView, handle: str, *, days: int | None
) -> Why:
    if not view.sources:
        return Why(posts=[], total=0)
    r = PostReference
    per_post = (
        sa_select(
            col(r.source_channel).label("channel"),
            col(r.source_post_id).label("post_id"),
            func.max(col(r.timestamp)).label("ts"),
            func.array_agg(distinct(col(r.kind))).label("kinds"),
        )
        .where(*_references(view, days=days), col(r.target_handle) == handle)
        .group_by(col(r.source_channel), col(r.source_post_id))
        .subquery("per_post")
    )
    total = int(
        session.execute(
            unscoped_select(
                sa_select(func.count()).select_from(per_post), reason=_SCOPE_REASON
            )
        ).scalar_one()
    )
    rows = session.execute(
        unscoped_select(
            sa_select(per_post)
            .order_by(
                per_post.c.ts.desc(), per_post.c.channel, per_post.c.post_id.desc()
            )
            .limit(WHY_LIMIT),
            reason=_SCOPE_REASON,
        )
    ).all()
    keys = [(str(row.channel), int(row.post_id)) for row in rows]
    texts = _citing_texts(session, view.user_id, keys)
    names = _display_names(session, frozenset(channel for channel, _ in keys))
    return Why(
        posts=[
            CitingPost(
                channel=channel,
                display_name=names.get(channel),
                post_id=post_id,
                timestamp=int(row.ts),
                kinds=sorted(row.kinds),
                text=texts.get((channel, post_id)),
            )
            for (channel, post_id), row in zip(keys, rows, strict=True)
        ],
        total=total,
    )


def _citing_texts(
    session: Session, user_id: uuid.UUID, keys: list[tuple[str, int]]
) -> dict[tuple[str, int], str]:
    """Each citing Post's words: the stored Post where the Account may read it,
    else the sample the probe kept. A Reference is a corpus fact; a Post's words
    are read through the Follow seam, so a selection sent with somebody else's
    Channel in it quotes nothing a sample does not already show everybody."""
    if not keys:
        return {}
    channels = {channel for channel, _ in keys}
    # References store the handle lowercased; Posts keep the Channel's own case.
    names = session.exec(
        scoped_select(select(Channel.name), Channel, user_id).where(
            func.lower(col(Channel.name)).in_(channels)
        )
    ).all()
    real = {str(n).lower(): str(n) for n in names}
    texts = {
        (str(post["channelName"]).lower(), int(post["id"])): str(post["text"] or "")
        for post in lookup_posts(
            session,
            [(real[c], p) for c, p in keys if c in real],
            user_id=user_id,
        )
    }
    missing = {(c, p) for c, p in keys if (c, p) not in texts}
    if missing:
        for channel, samples in samples_by_handle(
            session, sorted({c for c, _ in missing})
        ).items():
            for sample in samples:
                if (channel, sample.post_id) in missing:
                    texts[(channel, sample.post_id)] = sample.text
    return texts


#: How many shared Channels "Why it's here" names per relation; the rest are counted.
SHARED_LIMIT = 5


@dataclass(frozen=True)
class SharedChannel:
    handle: str
    display_name: str | None


@dataclass(frozen=True)
class SharedWhy:
    #: The middle Channels linking `handle` to the Seeds, most References first.
    channels: list[SharedChannel]
    total: int


def shared_why(session: Session, handle: str, cond: SharedCond) -> SharedWhy:
    """The Channels `handle` shares with the Seeds: for parents, those citing both
    it and a Seed; for children, those both it and a Seed cite (DIR-07)."""
    middle, candidate = _ends(cond.relation)
    if not cond.seeds:
        return SharedWhy(channels=[], total=0)
    rows = (
        session.execute(
            unscoped_select(
                sa_select(middle)
                .where(candidate == handle, middle.in_(_middle(cond)))
                .order_by(col(CitationPair.reference_count).desc(), middle),
                reason=_SCOPE_REASON,
            )
        )
        .scalars()
        .all()
    )
    few = [str(h) for h in rows[:SHARED_LIMIT]]
    names = _display_names(session, frozenset(few))
    return SharedWhy(
        channels=[SharedChannel(h, names.get(h)) for h in few], total=len(rows)
    )


def _display_names(session: Session, handles: frozenset[str]) -> dict[str, str | None]:
    return {
        str(h): name
        for h, name in session.execute(
            unscoped_select(
                sa_select(
                    col(DirectoryEntry.handle), col(DirectoryEntry.display_name)
                ).where(col(DirectoryEntry.handle) == any_(_handles(handles))),
                reason=_SCOPE_REASON,
            )
        ).all()
    }


#: How many Channels each side of the panel's neighbour lists shows.
NEIGHBOURS_LIMIT = 10


@dataclass(frozen=True)
class Neighbour:
    handle: str
    display_name: str | None
    #: References between the two, every kind.
    references: int
    kinds: list[str]


@dataclass(frozen=True)
class Neighbours:
    #: The Channels citing it most.
    cited_by: list[Neighbour]
    #: The Channels it cites most.
    cites: list[Neighbour]


def neighbours(session: Session, handle: str) -> Neighbours:
    """Who cites `handle` most and whom it cites most (DIR-05), from the
    citation pairs, every kind; ties fall to the handle."""
    p, r = CitationPair, PostReference

    def side(near: Any, far: Any, ref_near: Any, ref_far: Any) -> list[Neighbour]:
        top = session.execute(
            unscoped_select(
                sa_select(col(far), col(p.reference_count))
                .where(col(near) == handle)
                .order_by(col(p.reference_count).desc(), col(far))
                .limit(NEIGHBOURS_LIMIT),
                reason=_SCOPE_REASON,
            )
        ).all()
        others = [str(h) for h, _ in top]
        kinds = {
            str(h): sorted(k)
            for h, k in session.execute(
                unscoped_select(
                    sa_select(col(ref_far), func.array_agg(distinct(col(r.kind))))
                    .where(
                        col(ref_near) == handle, col(ref_far) == any_(_handles(others))
                    )
                    .group_by(col(ref_far)),
                    reason=_SCOPE_REASON,
                )
            ).all()
        }
        names = _display_names(session, frozenset(others))
        return [
            Neighbour(
                handle=str(h),
                display_name=names.get(str(h)),
                references=int(n),
                kinds=kinds.get(str(h), []),
            )
            for h, n in top
        ]

    return Neighbours(
        cited_by=side(
            p.cited_handle, p.citing_handle, r.target_handle, r.source_channel
        ),
        cites=side(p.citing_handle, p.cited_handle, r.source_channel, r.target_handle),
    )


def directory_size(session: Session, *, every_kind: bool = False) -> int:
    """How many entries the Directory lists at all: the filter row's "of M".

    Channels, or every entry for a reader listed every kind (DPF).
    """
    hit = _size.get(every_kind)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]
    statement = unscoped_select(
        sa_select(func.count()).select_from(DirectoryEntry).where(_listed(every_kind)),
        reason=_SCOPE_REASON,
    )
    size = int(session.execute(statement).scalar_one())
    _size[every_kind] = (time.monotonic() + COUNTS_TTL_SECONDS, size)
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
    session: Session, view: DirectoryView, measure: DirectoryMeasure | DirectoryMoment
) -> Distribution:
    """`measure` across the view with its own bounds left out, for the bound editor.

    A moment's spread is in epoch ms, on a linear scale (DPF).
    """
    tree = _without(
        view.tree,
        lambda c: (
            (isinstance(c, MeasureCond) and c.measure == measure)
            or (isinstance(c, TimeCond) and c.moment == measure)
        ),
    )
    where = _where(view, tree)
    value = measure_sql(measure)
    total, measured, lo, hi, median = session.execute(
        unscoped_select(
            sa_select(
                func.count(),
                func.count(value),
                func.min(value),
                func.max(value),
                func.percentile_cont(0.5).within_group(value),
            )
            .select_from(_entries(tree, measure))
            .where(where),
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
                    .select_from(_entries(tree, measure))
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
