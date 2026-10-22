"""One time-ordered list over every artifact, whatever its kind.

A **read model**: takes a `Session`, never commits, owns no table. It aggregates
`tg_summaries`, `tg_chat_sessions`, `tg_tag_runs` and `tg_discover_reports` into
a single newest-first page so History can show all four kinds interleaved
instead of a summary list with two other kinds bolted on beside it.

Each leg also carries `acted_by_email` (ticket 27), which is what makes "the
acting Owner is visible in that User's History" true — History is the one screen
that lists every kind, so it is the one place the answer has to be.

## The one rule this module exists to keep

**Every leg selects named columns. None of them selects an entity.**

Two of the four tables keep a corpus in the same table as their metadata:
`TagRun.prompt_text` / `response_text` / `suggestions`, and
`DiscoverReport.candidates`. `select(TagRun)` reads them off disk whether or not
the projection keeps them — which is exactly how `list_tag_runs` and
`list_reports` were quietly detoasting every historical prompt and candidate
array before this module existed. The other two tables put their corpus in a
companion payload table, and this module does not import those models at all, so
that half is fail-closed by construction.

Pinned by `tests/services/test_artifact_list_payload_cost.py`.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Integer,
    String,
    Text,
    case,
    cast,
    exists,
    func,
    literal,
    null,
    or_,
    union_all,
)
from sqlalchemy import select as sa_select
from sqlmodel import Session, SQLModel, col

from app.models_tg import ChatSession, DiscoverReport, Summary, SummaryAttempt, TagRun
from app.services.analysis_window import ResolvedWindow
from app.services.logs import ANY_TIME, LogSpread
from app.services.spread_bars import Bin, spread_range
from app.services.tenancy import scoped_select

DEFAULT_ARTIFACT_PAGE_SIZE = 100
MAX_ARTIFACT_PAGE_SIZE = 1000

ARTIFACT_KINDS = ("summary", "chat", "tag", "discovery")

#: How much of a summary's body travels as the list preview. The read cost is
#: unchanged either way — the detoast happens server-side — but four kinds on
#: one page multiplies the *wire* cost, and the list renders a two-line clamp.
ARTIFACT_TITLE_CHARS = 200

#: Columns that carry a corpus rather than metadata, across the four tables.
#: Exported so the guard asserts against the emitted SQL rather than against a
#: hand-copy of this list.
ARTIFACT_FORBIDDEN_COLUMNS = frozenset(
    {
        "prompt_text",
        "response_text",
        "suggestions",
        "all_tags_snapshot",
        "channel_context_options",
        "apply_result",
        "candidates",
        "cited_posts",
        "chat_messages",
        "messages",
        # AW-06. The frozen Scope's explicit Post selection, which runs to
        # thousands of refs. `scope` itself is read here and is not heavy — it
        # is the filters and two integers — which is exactly why the frozen
        # value was split across two columns in the first place.
        "scope_posts",
    }
)


def _null(type_: Any) -> Any:
    """A typed NULL.

    Postgres infers `unknown` for a bare NULL in a UNION leg, which either fails
    to unify with the other legs or silently degrades the column to text. Every
    absent per-kind field is cast explicitly.
    """
    return cast(null(), type_)


def _starred(model: Any) -> Any:
    """`extra->>'isStarred'` as a boolean.

    Reading `extra` is cheap *only because* the corpus-sized fields were moved
    out of it — that is the property this depends on, and the payload-cost
    guards are what keep it true.
    """
    return func.coalesce(
        cast(col(model.extra).op("->>")("isStarred"), Boolean), literal(False)
    )


def _flag(model: Any, key: str) -> Any:
    """One small boolean out of `extra`, defaulting to false."""
    return func.coalesce(cast(col(model.extra).op("->>")(key), Boolean), literal(False))


def _text_flag(model: Any, key: str) -> Any:
    """One small string out of `extra`."""
    return cast(col(model.extra).op("->>")(key), String)


def _scope_text(model: Any, key: str) -> Any:
    """One key of the frozen Scope as text, for a title or an `ILIKE`.

    AW-07 dropped the `channels` / `start_date` / `end_date` trio and, on
    reports, the seven duplicated filter columns, so the Scope is the only
    place left holding them — which was the point of dropping them. `channels`
    comes back as the JSON array's own text (`["a", "b"]`), which is what
    `cast(col(Model.channels), Text)` produced here before and matches the same
    way.

    `NULL` on a row a legacy write door opened with no Scope, so such a row
    matches nothing rather than matching everything: there is no window or
    channel list to search, which is the honest answer and the same one the
    projection gives.
    """
    return cast(col(model.scope).op("->>")(key), Text)


def _failed_attempts() -> Any:
    """How many of a Summary's Attempts did not finish, for History's red card.

    Stopped counts with failed: either one leaves the Summary Failed. Reads
    `outcome` alone: `partial_text` and `error` are stored out of line and a
    count never detoasts them.
    """
    return (
        sa_select(func.count())
        .where(
            col(SummaryAttempt.summary_id) == col(Summary.id),
            col(SummaryAttempt.outcome).in_(("failed", "stopped")),
        )
        .scalar_subquery()
    )


def _summary_status() -> Any:
    """A Summary's status as History shows it: `running` while an Attempt runs.

    Generate stores its Summary Failed before Attempt 1 starts, so a network
    that drops in between leaves it Failed rather than nowhere (SFR-02). That
    stored status must not paint the card red while the Attempt is running, so
    a running Attempt that has started outranks it. One counting down to an
    automatic retry has not started, and its Summary is still Failed.
    """
    started = exists().where(
        col(SummaryAttempt.summary_id) == col(Summary.id),
        col(SummaryAttempt.outcome) == "running",
        col(SummaryAttempt.started_at)
        <= cast(func.extract("epoch", func.now()) * 1000, BigInteger),
    )
    return case(
        (started, literal("running")),
        else_=func.coalesce(
            cast(col(Summary.extra).op("->>")("status"), String), literal("complete")
        ),
    )


def _scoped(leg: Any, model: type[SQLModel], user_id: uuid.UUID) -> Any:
    """One leg, narrowed to the rows this account may see.

    This endpoint hand-rolled its own predicate — `owner == me OR owner IS
    NULL` — before ticket 17, written pre-emptively while nothing else scoped
    at all. It now goes through the seam like the four families it unions, so
    History and `/data/summaries` cannot answer differently about the same row:
    two owner filters with different NULL handling is precisely the drift
    `tenancy.py` exists to prevent, and it would have surfaced as a summary
    visible in one list and absent from the other.

    Applied per leg because there is nowhere else to put it. The union is
    wrapped in a subquery that projects the labelled output columns — `kind`,
    `id`, `title` and the rest — and `user_id` is not one of them, so a
    predicate on the outside has nothing to name. Adding it to the projection
    to filter on it later would ship every artifact's owner to the caller in
    order to throw the rows away one layer up.
    """
    return scoped_select(leg, model, user_id)


def _summary_leg(user_id: uuid.UUID) -> Any:
    return _scoped(
        sa_select(
            literal("summary").label("kind"),
            col(Summary.id).label("id"),
            func.left(col(Summary.text), ARTIFACT_TITLE_CHARS).label("title"),
            col(Summary.timestamp).label("timestamp"),
            col(Summary.model).label("model"),
            col(Summary.post_count).label("post_count"),
            _summary_status().label("status"),
            _null(String).label("mode"),
            _null(Integer).label("message_count"),
            _null(Integer).label("candidate_count"),
            col(Summary.language).label("language"),
            _starred(Summary).label("is_starred"),
            _text_flag(Summary, "note").label("note"),
            col(Summary.acted_by_email).label("acted_by_email"),
            col(Summary.scope).label("scope"),
            _flag(Summary, "autoRegenerate").label("auto_regenerate"),
            _flag(Summary, "autoPublish").label("auto_publish"),
            _failed_attempts().label("failed_attempts"),
        ),
        Summary,
        user_id,
    )


def _chat_leg(user_id: uuid.UUID) -> Any:
    return _scoped(
        sa_select(
            literal("chat").label("kind"),
            col(ChatSession.id).label("id"),
            col(ChatSession.title).label("title"),
            col(ChatSession.timestamp).label("timestamp"),
            col(ChatSession.model).label("model"),
            col(ChatSession.post_count).label("post_count"),
            _null(String).label("status"),
            col(ChatSession.mode).label("mode"),
            col(ChatSession.message_count).label("message_count"),
            _null(Integer).label("candidate_count"),
            col(ChatSession.language).label("language"),
            _starred(ChatSession).label("is_starred"),
            _text_flag(ChatSession, "note").label("note"),
            col(ChatSession.acted_by_email).label("acted_by_email"),
            col(ChatSession.scope).label("scope"),
            literal(False).label("auto_regenerate"),
            literal(False).label("auto_publish"),
            _null(Integer).label("failed_attempts"),
        ),
        ChatSession,
        user_id,
    )


def _tag_leg(user_id: uuid.UUID) -> Any:
    return _scoped(
        sa_select(
            literal("tag").label("kind"),
            col(TagRun.id).label("id"),
            (literal("Tags · ") + col(TagRun.mode)).label("title"),
            # The only rename: tag runs date from `created_at`, not `timestamp`.
            # Deliberately *not* `updated_at_ms`, and never the naive `updated_at`
            # datetime every one of these tables also carries — unifying TIMESTAMP
            # with BIGINT fails at execution rather than at type-check.
            col(TagRun.created_at).label("timestamp"),
            col(TagRun.model).label("model"),
            col(TagRun.post_count).label("post_count"),
            col(TagRun.status).label("status"),
            col(TagRun.mode).label("mode"),
            _null(Integer).label("message_count"),
            _null(Integer).label("candidate_count"),
            _null(String).label("language"),
            _starred(TagRun).label("is_starred"),
            _text_flag(TagRun, "note").label("note"),
            col(TagRun.acted_by_email).label("acted_by_email"),
            col(TagRun.scope).label("scope"),
            literal(False).label("auto_regenerate"),
            literal(False).label("auto_publish"),
            _null(Integer).label("failed_attempts"),
        ),
        TagRun,
        user_id,
    )


def _discovery_leg(user_id: uuid.UUID) -> Any:
    return _scoped(
        sa_select(
            literal("discovery").label("kind"),
            col(DiscoverReport.id).label("id"),
            func.coalesce(
                _scope_text(DiscoverReport, "keyword"), literal("Discover")
            ).label("title"),
            col(DiscoverReport.timestamp).label("timestamp"),
            # Discover runs no model.
            _null(String).label("model"),
            col(DiscoverReport.posts_in_scope).label("post_count"),
            _null(String).label("status"),
            _null(String).label("mode"),
            _null(Integer).label("message_count"),
            col(DiscoverReport.candidate_count).label("candidate_count"),
            _null(String).label("language"),
            _starred(DiscoverReport).label("is_starred"),
            _text_flag(DiscoverReport, "note").label("note"),
            col(DiscoverReport.acted_by_email).label("acted_by_email"),
            col(DiscoverReport.scope).label("scope"),
            literal(False).label("auto_regenerate"),
            literal(False).label("auto_publish"),
            _null(Integer).label("failed_attempts"),
        ),
        DiscoverReport,
        user_id,
    )


_LEGS = {
    "summary": _summary_leg,
    "chat": _chat_leg,
    "tag": _tag_leg,
    "discovery": _discovery_leg,
}

_SORT = {
    "summary": (col(Summary.timestamp), col(Summary.id)),
    "chat": (col(ChatSession.timestamp), col(ChatSession.id)),
    "tag": (col(TagRun.created_at), col(TagRun.id)),
    "discovery": (col(DiscoverReport.timestamp), col(DiscoverReport.id)),
}


def _search(kind: str, term: str) -> Any:
    """What each kind matches, and what it deliberately does not.

    The rule: a leg may only search columns it is already allowed to read. The
    `EXISTS`-against-a-payload-table trick that `summaries._search_clause` uses
    to reach prompt bodies is available here and is deliberately unused — the
    contract of this endpoint is that it never opens a payload table, and an
    `EXISTS` over `prompt_text` across a four-way union is precisely how the
    26 MB regression comes back. `/data/summaries?search=` still reaches them.

    Tag runs and reports keep their corpus in the *same* table, so an `ILIKE`
    over it would detoast that corpus for every row scanned. Reports also
    exclude `candidates` on the older ground `discover_reports._search_clause`
    gives: matching the candidate blob makes every report containing a popular
    handle a hit for that handle.
    """
    like = f"%{term}%"
    if kind == "summary":
        return or_(
            col(Summary.text).ilike(like),
            _scope_text(Summary, "channels").ilike(like),
            col(Summary.model).ilike(like),
            col(Summary.extra).op("->>")("note").ilike(like),
        )
    if kind == "chat":
        return or_(
            col(ChatSession.title).ilike(like),
            _scope_text(ChatSession, "channels").ilike(like),
            col(ChatSession.model).ilike(like),
            col(ChatSession.extra).op("->>")("note").ilike(like),
        )
    if kind == "tag":
        return or_(
            _scope_text(TagRun, "channels").ilike(like),
            col(TagRun.model).ilike(like),
            col(TagRun.mode).ilike(like),
            col(TagRun.status).ilike(like),
        )
    return or_(
        _scope_text(DiscoverReport, "channels").ilike(like),
        _scope_text(DiscoverReport, "keyword").ilike(like),
    )


def _row_to_camel(row: Any) -> dict[str, Any]:
    """One artifact, with only the keys its kind actually has.

    The per-kind extras are dropped rather than emitted as `null`, which is what
    makes the response a discriminated union instead of one model with four
    mostly-empty fields — see `app/schemas/artifacts.py`.
    """
    kind = row["kind"]
    out: dict[str, Any] = {
        "kind": kind,
        "id": row["id"],
        "title": row["title"] or "",
        "timestamp": row["timestamp"],
        "model": row["model"],
        "postCount": row["post_count"],
        "isStarred": bool(row["is_starred"]),
        "note": row["note"],
        # Ticket 27. Emitted for every kind rather than as a per-kind extra:
        # "an Owner wrote this on your behalf" is a fact about an artifact, not
        # about a summary, and a field only some kinds carried would be one
        # narrowing by `kind` could not tell you about.
        "actedByEmail": row["acted_by_email"],
        # AW-06, and on the base for the same reason `actedByEmail` is: "which
        # Posts produced this" is a fact about an artifact, not about a summary.
        # It is the *whole* reason History stopped reading four per-kind
        # subsets — the four legs select one column holding one shape, and
        # AW-07 dropped the `channels`/`startDate`/`endDate` trio it superseded,
        # so a History row can no longer carry two Scopes that disagree.
        #
        # Without its Post refs. Those live in a payload table or a heavy
        # column depending on the family, and this module's one rule is that it
        # opens neither; `scopedPostCount` inside the value is what a list shows
        # instead.
        "scope": row["scope"],
    }
    if kind == "summary":
        out["status"] = row["status"]
        out["language"] = row["language"]
        out["autoRegenerate"] = bool(row["auto_regenerate"])
        out["autoPublish"] = bool(row["auto_publish"])
        out["failedAttempts"] = row["failed_attempts"]
    elif kind == "chat":
        out["messageCount"] = row["message_count"]
        out["mode"] = row["mode"]
        out["language"] = row["language"]
    elif kind == "tag":
        out["status"] = row["status"]
        out["mode"] = row["mode"]
    else:
        out["candidateCount"] = row["candidate_count"]
    return out


#: Which kinds a status filter reaches, and the column it compares (SFR-01).
#: Failed is a Summary's state only: a Tag run's own `failed` is not the red
#: card, and Tag runs join when their Attempts do.
_STATUS_KINDS: dict[str, tuple[str, ...]] = {
    "pending": ("summary", "tag"),
    "failed": ("summary",),
}

_STATUS_COLUMNS = {
    "summary": _summary_status(),
    "tag": col(TagRun.status),
}

_MODELS = {
    "summary": Summary,
    "chat": ChatSession,
    "tag": TagRun,
    "discovery": DiscoverReport,
}


def _kinds(kind: str | None, status: str | None) -> tuple[str, ...]:
    """The legs to build. A kind with no such state is not in the plan at all."""
    kinds: tuple[str, ...] = (kind,) if kind else ARTIFACT_KINDS
    if status:
        kinds = tuple(one for one in kinds if one in _STATUS_KINDS[status])
    return kinds


def _legs(
    user_id: uuid.UUID,
    kinds: tuple[str, ...],
    *,
    search: str | None,
    starred: bool,
    status: str | None,
) -> list[Any]:
    """One leg per kind under the shared filters, unordered and unpaged.

    The list, the counts and the spread all start here, so none of them
    re-implements a leg or a filter.
    """
    term = (search or "").strip()
    legs = []
    for one in kinds:
        leg = _LEGS[one](user_id)
        if term:
            leg = leg.where(_search(one, term))
        if starred:
            leg = leg.where(_starred(_MODELS[one]))
        if status:
            leg = leg.where(_STATUS_COLUMNS[one] == status)
        legs.append(leg)
    return legs


def _union(legs: list[Any]) -> Any:
    # UNION ALL, never UNION: `scope` is a PostgreSQL `json` column and `json`
    # has no equality operator, so a de-duplicating UNION fails outright. It is
    # also semantically right — two artifacts never dedupe.
    return union_all(*legs).subquery("artifact")


def _window_edge(unioned: Any, edge: str) -> Any:
    """The frozen Scope's `start` or `end`; `NULL` for an Artifact with none."""
    return cast(unioned.c.scope.op("->>")(edge), BigInteger)


def _bounded(statement: Any, unioned: Any, moment: str, bound: ResolvedWindow) -> Any:
    """The time filter: Written inside `[start, end)`, or a window overlapping it.

    An overlap is `window.end > start AND window.start < end`, so a window that
    began before the bound and ends inside it is kept. A `NULL` window compares
    as unknown, so an Artifact without one never matches a window filter.
    """
    if moment == "written":
        if bound.start is not None:
            statement = statement.where(unioned.c.timestamp >= bound.start)
        if bound.end is not None:
            statement = statement.where(unioned.c.timestamp < bound.end)
        return statement
    if bound.start is not None:
        statement = statement.where(_window_edge(unioned, "end") > bound.start)
    if bound.end is not None:
        statement = statement.where(_window_edge(unioned, "start") < bound.end)
    return statement


def list_artifacts(
    session: Session,
    *,
    kind: str | None = None,
    search: str | None = None,
    starred: bool = False,
    status: str | None = None,
    moment: str = "written",
    bound: ResolvedWindow = ANY_TIME,
    sort: str = "written",
    descending: bool = True,
    limit: int = DEFAULT_ARTIFACT_PAGE_SIZE,
    offset: int = 0,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """One page of every saved artifact, newest Written first by default.

    `kind` filters by **not building the leg**, rather than by a `WHERE kind =`
    on the outside: `?kind=chat` must not put `tg_tag_runs` in the plan at all.

    `starred` is a server predicate rather than a client-side filter, and that
    was a correction. Filtering the fetched pages looked cheaper — it only ever
    narrows what is on screen — but it interacts badly with paging: with no
    starred rows in the loaded pages the list renders empty, the infinite-scroll
    sentinel stays in view, and each fetch immediately triggers the next, so the
    browser walks the entire history back to back while showing "no matches".

    `sort` is the Written moment or the window's start, and a missing window
    sorts last in either direction. Every order ends on `id`, because offset
    paging repeats or drops rows without a total order.
    """
    kinds = _kinds(kind, status)
    if not kinds:
        return []
    legs = _legs(user_id, kinds, search=search, starred=starred, status=status)
    if sort == "written" and bound.start is None and bound.end is None:
        # Each leg can contribute at most `offset + limit` rows to the final
        # page, so bounding it here is exact rather than approximate. With the
        # (timestamp DESC, id) indexes this turns four sorts into four index
        # scans feeding a MergeAppend. A bound or the window sort filters or
        # orders on the outside, where a per-leg limit would cut rows short.
        legs = [
            leg.order_by(
                _SORT[one][0].desc() if descending else _SORT[one][0].asc(),
                _SORT[one][1],
            ).limit(offset + limit)
            for one, leg in zip(kinds, legs, strict=True)
        ]
    unioned = _union(legs)
    key = unioned.c.timestamp if sort == "written" else _window_edge(unioned, "start")
    order = key.desc() if descending else key.asc()
    statement = (
        _bounded(sa_select(unioned), unioned, moment, bound)
        .order_by(order.nulls_last(), unioned.c.id)
        .offset(offset)
        .limit(limit)
    )
    return [_row_to_camel(row) for row in session.execute(statement).mappings().all()]


def _has_status(kind: str, status: str | None, wanted: str) -> bool:
    """Whether a row is what the `wanted` status filter would keep."""
    return kind in _STATUS_KINDS[wanted] and status == wanted


def count_artifacts(
    session: Session,
    *,
    kind: str | None = None,
    search: str | None = None,
    starred: bool = False,
    status: str | None = None,
    moment: str = "written",
    bound: ResolvedWindow = ANY_TIME,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """The footer's total, and each Kind and Status choice as a facet.

    A Kind is counted under every filter but Kind, a Status under every filter
    but Status, and the total under all of them, so each count says what
    picking it would show. One statement over the four legs under search,
    starred and the time filter, grouped by kind and status; the facets are
    summed here from the groups.
    """
    legs = _legs(user_id, ARTIFACT_KINDS, search=search, starred=starred, status=None)
    unioned = _union(legs)
    groups = session.execute(
        _bounded(
            sa_select(unioned.c.kind, unioned.c.status, func.count()),
            unioned,
            moment,
            bound,
        ).group_by(unioned.c.kind, unioned.c.status)
    ).all()

    kinds = dict.fromkeys(ARTIFACT_KINDS, 0)
    statuses = dict.fromkeys(_STATUS_KINDS, 0)
    total = statuses_all = 0
    for one, state, n in groups:
        kind_ok = kind is None or one == kind
        status_ok = status is None or _has_status(one, state, status)
        if status_ok:
            kinds[one] += n
        if kind_ok:
            statuses_all += n
            for wanted in statuses:
                statuses[wanted] += n if _has_status(one, state, wanted) else 0
        if kind_ok and status_ok:
            total += n
    return {
        "total": total,
        "kinds": kinds,
        "kindsAll": sum(kinds.values()),
        "statuses": statuses,
        "statusesAll": statuses_all,
    }


def artifact_spread(
    session: Session,
    *,
    kind: str | None = None,
    search: str | None = None,
    starred: bool = False,
    status: str | None = None,
    moment: str = "written",
    zoom: tuple[float, float] | None = None,
    user_id: uuid.UUID,
) -> LogSpread:
    """When Artifacts were Written, or their windows started, as the Logs spread.

    Under every History filter but the time filter itself, so the popover shows
    what lies around the bound. An Artifact with no window is left out under
    `window`. A `zoom` bins only its range; the total, min, max and median stay
    the whole spread's.
    """
    kinds = _kinds(kind, status)
    if not kinds:
        return LogSpread(total=0, min=None, max=None, median=None, bins=[])
    unioned = _union(
        _legs(user_id, kinds, search=search, starred=starred, status=status)
    )
    value = (
        unioned.c.timestamp if moment == "written" else _window_edge(unioned, "start")
    )
    total, lo, hi, median = session.execute(
        sa_select(
            func.count(value),
            func.min(value),
            func.max(value),
            func.percentile_cont(0.5).within_group(value),
        )
    ).one()
    bins: list[Bin] = []
    covered = spread_range(lo, hi, zoom)
    if covered is not None:
        bar = covered.bar_of(value)
        counts = session.execute(
            sa_select(bar, func.count()).where(*covered.holds(value)).group_by(bar)
        ).all()
        bins = covered.bars({int(i): int(n) for i, n in counts})
    return LogSpread(
        total=int(total),
        min=None if lo is None else int(lo),
        max=None if hi is None else int(hi),
        median=None if median is None else float(median),
        bins=bins,
    )


__all__ = [
    "ARTIFACT_FORBIDDEN_COLUMNS",
    "ARTIFACT_KINDS",
    "DEFAULT_ARTIFACT_PAGE_SIZE",
    "MAX_ARTIFACT_PAGE_SIZE",
    "artifact_spread",
    "count_artifacts",
    "list_artifacts",
]
