"""Tag run CRUD helpers for TG Summarizer data APIs."""

from __future__ import annotations

import uuid
from typing import Any
from typing import cast as typing_cast

from fastapi import HTTPException
from sqlalchemy import select as sa_select
from sqlmodel import Session, col

from app.core import acting_owner
from app.models_tg import TagRun, utc_now
from app.services.serialization import to_snake
from app.services.tenancy import (
    assert_owner,
    assert_owner_on_write,
    scoped_select,
)

#: This family's 404, reused by `assert_owner` so a foreign row and an absent
#: one answer identically. See `SUMMARY_NOT_FOUND`.
TAG_RUN_NOT_FOUND = "Tag run not found"

DEFAULT_TAG_RUN_PAGE_SIZE = 100
MAX_TAG_RUN_PAGE_SIZE = 1000

#: Columns that hold a corpus rather than metadata. `prompt_text` is a full
#: serialized post corpus; `response_text` is the model's whole reply.
HEAVY_TAG_RUN_COLUMNS = frozenset(
    {
        "prompt_text",
        "response_text",
        "suggestions",
        "all_tags_snapshot",
        "channel_context_options",
        "apply_result",
    }
)


def _light_columns() -> list[Any]:
    """Every `tg_tag_runs` column except the corpus-sized ones.

    Selecting columns rather than the entity is the whole point.
    `list_tag_runs` used to do `select(TagRun)` and drop the heavy fields in
    Python — which reads them off disk anyway, detoasting every historical
    prompt on every call, and looks fine from the wire because the projection
    happened after. `defer()` is not the fix either: `logs.py::_light_columns`
    explains why a deferred attribute plus an attribute read is a silent N+1.
    """
    return [
        c
        # `__table__` is set by SQLModel's metaclass at runtime, so it is
        # invisible to the type checkers — same cast `logs.py::_log_table` uses.
        for c in typing_cast(Any, TagRun).__table__.columns
        if c.key not in HEAVY_TAG_RUN_COLUMNS
    ]


def tag_run_to_camel(tag_run: TagRun) -> dict[str, Any]:
    return {
        "id": tag_run.id,
        "status": tag_run.status,
        "source": tag_run.source,
        "mode": tag_run.mode,
        "channels": tag_run.channels,
        "startDate": tag_run.start_date,
        "endDate": tag_run.end_date,
        "postCount": tag_run.post_count,
        "model": tag_run.model,
        "promptText": tag_run.prompt_text,
        "responseText": tag_run.response_text,
        "allTagsSnapshot": tag_run.all_tags_snapshot,
        "channelContextOptions": tag_run.channel_context_options,
        "suggestions": tag_run.suggestions,
        "applyResult": tag_run.apply_result,
        "error": tag_run.error,
        "createdAt": tag_run.created_at,
        "updatedAt": tag_run.updated_at_ms,
        **(tag_run.extra or {}),
    }


def tag_run_to_camel_light(tag_run: TagRun) -> dict[str, Any]:
    """List-view projection: identity and metadata only.

    Deliberately omits `promptText`, `responseText`, `suggestions` and
    `allTagsSnapshot`. `promptText` holds a full serialized post corpus, so
    listing every run with the heavy fields re-downloaded every historical
    prompt — tens of MB. Callers that need those fetch the run by id.
    """
    return _light_from_mapping(
        {c.key: getattr(tag_run, c.key) for c in _light_columns()}
    )


def _light_from_mapping(row: dict[str, Any]) -> dict[str, Any]:
    """The list projection, built from a column mapping rather than an entity.

    Kept separate so `list_tag_runs` never has to materialise a `TagRun` — the
    entity is what pulls the corpus columns along with it.
    """
    return {
        "id": row["id"],
        "status": row["status"],
        "source": row["source"],
        "mode": row["mode"],
        "channels": row["channels"],
        "startDate": row["start_date"],
        "endDate": row["end_date"],
        "postCount": row["post_count"],
        "model": row["model"],
        "error": row["error"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at_ms"],
        **(row.get("extra") or {}),
    }


def list_tag_runs(
    session: Session,
    *,
    limit: int = DEFAULT_TAG_RUN_PAGE_SIZE,
    offset: int = 0,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return one newest-first page of tag runs in the light projection.

    The scope predicate goes on the column select, not on a wrapper: the light
    projection is what runs, and a filter applied after it would be a second
    query shape nobody tests.
    """
    statement = (
        scoped_select(sa_select(*_light_columns()), TagRun, user_id)
        .order_by(col(TagRun.created_at).desc(), col(TagRun.id))
        .offset(offset)
        .limit(limit)
    )
    return [
        _light_from_mapping(dict(row._mapping))
        for row in session.execute(statement).all()
    ]


def get_tag_run(
    session: Session, tag_run_id: str, *, user_id: uuid.UUID
) -> dict[str, Any]:
    """Return one tag run in full, including the heavy prompt/response fields.

    `prompt_text` is a whole serialized post corpus, so this is the one read in
    the family where a missing ownership check hands over somebody else's
    posts rather than their metadata.
    """
    row = session.get(TagRun, tag_run_id)
    if row is None:
        raise HTTPException(status_code=404, detail=TAG_RUN_NOT_FOUND)
    assert_owner(row.user_id, user_id, detail=TAG_RUN_NOT_FOUND)
    return tag_run_to_camel(row)


#: Snake-cased spellings of wire keys whose column is named differently.
#:
#: `to_snake("updatedAt")` is `"updated_at"`, but the column is
#: `updated_at_ms` — so the key passed the "not a known column" test, landed in
#: `extra`, and because `extra` is spread *last* it shadowed the real value on
#: every read. A client round-tripping a run then pinned its own `updatedAt`
#: forever while the column kept advancing underneath.
_COLUMN_ALIASES = frozenset({"updated_at", "created_at"})


def _extra_from_body(body: dict[str, Any], known: set[str]) -> dict[str, Any]:
    """Everything the columns do not claim, bound for the open `extra` bag.

    `isStarred` and `note` live here for the same reason they do on `Summary`:
    they are conditional per row, and declaring them would emit explicit `null`s
    on every row that has neither. Unknown keys used to be silently dropped,
    which meant starring a tag run appeared to work and did nothing.
    """
    return {
        key: value
        for key, value in body.items()
        if key != "id"
        and key not in known
        and to_snake(key) not in known
        and to_snake(key) not in _COLUMN_ALIASES
    }


def _merge_extra(
    existing: dict[str, Any] | None, incoming: dict[str, Any]
) -> dict[str, Any]:
    """Merge, treating an explicit null as a removal — as summaries do."""
    merged = {
        **(existing or {}),
        **{k: v for k, v in incoming.items() if v is not None},
    }
    for key, value in incoming.items():
        if value is None:
            merged.pop(key, None)
            merged.pop(to_snake(key), None)
    return merged


def upsert_tag_run(
    session: Session,
    tag_run_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Create a tag run, or merge into the caller's existing one.

    The ownership check is `upsert_summary`'s, for the same reason.
    """
    known = {
        "status",
        "source",
        "mode",
        "channels",
        "start_date",
        "startDate",
        "end_date",
        "endDate",
        "post_count",
        "postCount",
        "model",
        "prompt_text",
        "promptText",
        "response_text",
        "responseText",
        "all_tags_snapshot",
        "allTagsSnapshot",
        "channel_context_options",
        "channelContextOptions",
        "suggestions",
        "apply_result",
        "applyResult",
        "error",
        "created_at",
        "createdAt",
        "updated_at_ms",
        "updatedAt",
    }
    now_ms = int(utc_now().timestamp() * 1000)
    tag_run = session.get(TagRun, tag_run_id)
    if tag_run:
        assert_owner_on_write(tag_run.user_id, user_id, detail=TAG_RUN_NOT_FOUND)
        for key, value in body.items():
            snake = to_snake(key)
            if snake in known:
                setattr(tag_run, snake, value)
        tag_run.extra = _merge_extra(tag_run.extra, _extra_from_body(body, known))
        tag_run.updated_at_ms = now_ms
        tag_run.updated_at = utc_now()
    else:
        tag_run = TagRun(
            id=tag_run_id,
            user_id=user_id,
            status=body.get("status", "pending"),
            source=body.get("source", "generated"),
            mode=body.get("mode", "add"),
            channels=body.get("channels", []),
            start_date=body.get("startDate", body.get("start_date", 0)),
            end_date=body.get("endDate", body.get("end_date", 0)),
            post_count=body.get("postCount", body.get("post_count")),
            model=body.get("model"),
            prompt_text=body.get("promptText", body.get("prompt_text")),
            response_text=body.get("responseText", body.get("response_text")),
            all_tags_snapshot=body.get(
                "allTagsSnapshot", body.get("all_tags_snapshot", [])
            ),
            channel_context_options=body.get(
                "channelContextOptions", body.get("channel_context_options", {})
            ),
            suggestions=body.get("suggestions", {}),
            apply_result=body.get("applyResult", body.get("apply_result", {})),
            error=body.get("error"),
            created_at=body.get("createdAt", body.get("created_at", now_ms)),
            updated_at_ms=body.get("updatedAt", body.get("updated_at_ms", now_ms)),
            extra=_extra_from_body(body, known),
        )
    acting_owner.stamp(session, tag_run)
    session.add(tag_run)
    session.commit()
    session.refresh(tag_run)
    return tag_run_to_camel(tag_run)


def delete_tag_run(session: Session, tag_run_id: str, *, user_id: uuid.UUID) -> None:
    tag_run = session.get(TagRun, tag_run_id)
    if not tag_run:
        raise HTTPException(status_code=404, detail=TAG_RUN_NOT_FOUND)
    assert_owner_on_write(tag_run.user_id, user_id, detail=TAG_RUN_NOT_FOUND)
    session.delete(tag_run)
    session.commit()
