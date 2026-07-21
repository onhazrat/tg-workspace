"""Tag run CRUD helpers for TG Summarizer data APIs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.models_tg import TagRun
from app.services.serialization import to_snake

DEFAULT_TAG_RUN_PAGE_SIZE = 100
MAX_TAG_RUN_PAGE_SIZE = 1000


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
    }


def tag_run_to_camel_light(tag_run: TagRun) -> dict[str, Any]:
    """List-view projection: identity and metadata only.

    Deliberately omits `promptText`, `responseText`, `suggestions` and
    `allTagsSnapshot`. `promptText` holds a full serialized post corpus, so
    listing every run with the heavy fields re-downloaded every historical
    prompt — tens of MB. Callers that need those fetch the run by id.
    """
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
        "error": tag_run.error,
        "createdAt": tag_run.created_at,
        "updatedAt": tag_run.updated_at_ms,
    }


def list_tag_runs(
    session: Session,
    *,
    limit: int = DEFAULT_TAG_RUN_PAGE_SIZE,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Return one newest-first page of tag runs in the light projection."""
    statement = (
        select(TagRun)
        .order_by(col(TagRun.created_at).desc(), col(TagRun.id))
        .offset(offset)
        .limit(limit)
    )
    return [tag_run_to_camel_light(row) for row in session.exec(statement).all()]


def get_tag_run(session: Session, tag_run_id: str) -> dict[str, Any]:
    """Return one tag run in full, including the heavy prompt/response fields."""
    row = session.get(TagRun, tag_run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Tag run not found")
    return tag_run_to_camel(row)


def upsert_tag_run(
    session: Session,
    tag_run_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
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
    now_ms = int(datetime.utcnow().timestamp() * 1000)
    tag_run = session.get(TagRun, tag_run_id)
    if tag_run:
        for key, value in body.items():
            snake = to_snake(key)
            if snake in known:
                setattr(tag_run, snake, value)
        tag_run.updated_at_ms = now_ms
        tag_run.updated_at = datetime.utcnow()
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
        )
    session.add(tag_run)
    session.commit()
    session.refresh(tag_run)
    return tag_run_to_camel(tag_run)


def delete_tag_run(session: Session, tag_run_id: str) -> None:
    tag_run = session.get(TagRun, tag_run_id)
    if not tag_run:
        raise HTTPException(status_code=404, detail="Tag run not found")
    session.delete(tag_run)
    session.commit()
