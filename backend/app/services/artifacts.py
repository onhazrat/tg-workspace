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
    Boolean,
    Integer,
    String,
    Text,
    cast,
    func,
    literal,
    null,
    or_,
    union_all,
)
from sqlalchemy import select as sa_select
from sqlmodel import Session, SQLModel, col

from app.models_tg import ChatSession, DiscoverReport, Summary, TagRun
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
            col(Summary.channels).label("channels"),
            col(Summary.start_date).label("start_date"),
            col(Summary.end_date).label("end_date"),
            col(Summary.timestamp).label("timestamp"),
            col(Summary.model).label("model"),
            col(Summary.post_count).label("post_count"),
            func.coalesce(
                cast(col(Summary.extra).op("->>")("status"), String),
                literal("complete"),
            ).label("status"),
            _null(String).label("mode"),
            _null(Integer).label("message_count"),
            _null(Integer).label("candidate_count"),
            col(Summary.language).label("language"),
            _starred(Summary).label("is_starred"),
            _text_flag(Summary, "note").label("note"),
            col(Summary.acted_by_email).label("acted_by_email"),
            _flag(Summary, "autoRegenerate").label("auto_regenerate"),
            _flag(Summary, "autoPublish").label("auto_publish"),
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
            col(ChatSession.channels).label("channels"),
            col(ChatSession.start_date).label("start_date"),
            col(ChatSession.end_date).label("end_date"),
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
            literal(False).label("auto_regenerate"),
            literal(False).label("auto_publish"),
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
            col(TagRun.channels).label("channels"),
            col(TagRun.start_date).label("start_date"),
            col(TagRun.end_date).label("end_date"),
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
            literal(False).label("auto_regenerate"),
            literal(False).label("auto_publish"),
        ),
        TagRun,
        user_id,
    )


def _discovery_leg(user_id: uuid.UUID) -> Any:
    return _scoped(
        sa_select(
            literal("discovery").label("kind"),
            col(DiscoverReport.id).label("id"),
            func.coalesce(col(DiscoverReport.keyword), literal("Discover")).label(
                "title"
            ),
            col(DiscoverReport.channels).label("channels"),
            col(DiscoverReport.start_date).label("start_date"),
            col(DiscoverReport.end_date).label("end_date"),
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
            literal(False).label("auto_regenerate"),
            literal(False).label("auto_publish"),
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
            cast(col(Summary.channels), Text).ilike(like),
            col(Summary.model).ilike(like),
            col(Summary.extra).op("->>")("note").ilike(like),
        )
    if kind == "chat":
        return or_(
            col(ChatSession.title).ilike(like),
            cast(col(ChatSession.channels), Text).ilike(like),
            col(ChatSession.model).ilike(like),
            col(ChatSession.extra).op("->>")("note").ilike(like),
        )
    if kind == "tag":
        return or_(
            cast(col(TagRun.channels), Text).ilike(like),
            col(TagRun.model).ilike(like),
            col(TagRun.mode).ilike(like),
            col(TagRun.status).ilike(like),
        )
    return or_(
        cast(col(DiscoverReport.channels), Text).ilike(like),
        col(DiscoverReport.keyword).ilike(like),
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
        "channels": row["channels"] or [],
        "startDate": row["start_date"],
        "endDate": row["end_date"],
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
    }
    if kind == "summary":
        out["status"] = row["status"]
        out["language"] = row["language"]
        out["autoRegenerate"] = bool(row["auto_regenerate"])
        out["autoPublish"] = bool(row["auto_publish"])
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


_MODELS = {
    "summary": Summary,
    "chat": ChatSession,
    "tag": TagRun,
    "discovery": DiscoverReport,
}


def list_artifacts(
    session: Session,
    *,
    kind: str | None = None,
    search: str | None = None,
    starred: bool = False,
    limit: int = DEFAULT_ARTIFACT_PAGE_SIZE,
    offset: int = 0,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """One newest-first page of every saved artifact.

    `kind` filters by **not building the leg**, rather than by a `WHERE kind =`
    on the outside: `?kind=chat` must not put `tg_tag_runs` in the plan at all.

    `starred` is a server predicate rather than a client-side filter, and that
    was a correction. Filtering the fetched pages looked cheaper — it only ever
    narrows what is on screen — but it interacts badly with paging: with no
    starred rows in the loaded pages the list renders empty, the infinite-scroll
    sentinel stays in view, and each fetch immediately triggers the next, so the
    browser walks the entire history back to back while showing "no matches".
    """
    kinds = (kind,) if kind else ARTIFACT_KINDS
    term = (search or "").strip()

    legs = []
    for one in kinds:
        leg = _LEGS[one](user_id)
        if term:
            leg = leg.where(_search(one, term))
        if starred:
            leg = leg.where(_starred(_MODELS[one]))
        timestamp_col, id_col = _SORT[one]
        # Each leg can contribute at most `offset + limit` rows to the final
        # page, so bounding it here is exact rather than approximate. With the
        # (timestamp DESC, id) indexes this turns four sorts into four index
        # scans feeding a MergeAppend.
        legs.append(leg.order_by(timestamp_col.desc(), id_col).limit(offset + limit))

    # UNION ALL, never UNION: `channels` is a PostgreSQL `json` column and
    # `json` has no equality operator, so a de-duplicating UNION fails outright.
    # It is also semantically right — two artifacts never dedupe.
    unioned = union_all(*legs).subquery("artifact")
    statement = (
        sa_select(unioned)
        .order_by(unioned.c.timestamp.desc(), unioned.c.id)
        .offset(offset)
        .limit(limit)
    )
    return [_row_to_camel(row) for row in session.execute(statement).mappings().all()]


__all__ = [
    "ARTIFACT_FORBIDDEN_COLUMNS",
    "ARTIFACT_KINDS",
    "DEFAULT_ARTIFACT_PAGE_SIZE",
    "MAX_ARTIFACT_PAGE_SIZE",
    "list_artifacts",
]
