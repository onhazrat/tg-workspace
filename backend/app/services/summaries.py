"""Summary CRUD helpers for TG Summarizer data APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models_tg import Summary
from app.services.serialization import to_snake


def summary_to_camel(summary: Summary) -> dict[str, Any]:
    base = {
        "id": summary.id,
        "text": summary.text,
        "channels": summary.channels,
        "startDate": summary.start_date,
        "endDate": summary.end_date,
        "language": summary.language,
        "model": summary.model,
        "postCount": summary.post_count,
        "timestamp": summary.timestamp,
    }
    return {**base, **(summary.extra or {})}


def list_summaries(session: Session) -> list[dict[str, Any]]:
    return [summary_to_camel(s) for s in session.exec(select(Summary)).all()]


def upsert_summary(
    session: Session,
    summary_id: str,
    body: dict[str, Any],
    *,
    user_id,
) -> dict[str, Any]:
    summary = session.get(Summary, summary_id)
    known = {
        "id",
        "text",
        "channels",
        "start_date",
        "end_date",
        "startDate",
        "endDate",
        "language",
        "model",
        "post_count",
        "postCount",
        "timestamp",
    }
    if summary:
        for key, value in body.items():
            snake = to_snake(key)
            if snake in (
                "start_date",
                "end_date",
                "post_count",
                "text",
                "channels",
                "language",
                "model",
                "timestamp",
            ):
                setattr(summary, snake, value)
        extra = {
            key: value
            for key, value in body.items()
            if to_snake(key) not in known and key != "id"
        }
        summary.extra = {**(summary.extra or {}), **extra}
        summary.updated_at = datetime.utcnow()
    else:
        summary = Summary(
            id=summary_id,
            user_id=user_id,
            text=body.get("text", ""),
            channels=body.get("channels", []),
            start_date=body.get("startDate", body.get("start_date", 0)),
            end_date=body.get("endDate", body.get("end_date", 0)),
            language=body.get("language", "English"),
            model=body.get("model"),
            post_count=body.get("postCount", body.get("post_count")),
            timestamp=body.get("timestamp", 0),
            extra={
                key: value
                for key, value in body.items()
                if to_snake(key) not in known
            },
        )
    session.add(summary)
    session.commit()
    session.refresh(summary)
    return summary_to_camel(summary)


def delete_summary(session: Session, summary_id: str) -> None:
    summary = session.get(Summary, summary_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")
    session.delete(summary)
    session.commit()
