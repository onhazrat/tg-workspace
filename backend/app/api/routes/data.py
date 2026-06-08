"""CRUD and sync APIs for TG Summarizer data."""

import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db
from app.models_tg import (
    AppSetting,
    BotCredential,
    Channel,
    ChatDestination,
    Post,
    PostEmbedding,
    PostTranslation,
    Summary,
    SyncMeta,
)

router = APIRouter(prefix="/data", tags=["data"])


def _to_snake(key: str) -> str:
    out: list[str] = []
    for i, ch in enumerate(key):
        if ch.isupper() and i > 0:
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def _normalize_body(body: dict[str, Any]) -> dict[str, Any]:
    return {_to_snake(k): v for k, v in body.items()}


def _apply_channel_fields(ch: Channel, body: dict[str, Any]) -> None:
    normalized = _normalize_body(body)
    for key, value in normalized.items():
        if key in Channel.model_fields and key not in ("id",):
            setattr(ch, key, value)


def _touch_sync(session: Session, resource: str) -> None:
    meta = session.get(SyncMeta, resource)
    etag = str(uuid.uuid4())
    if meta:
        meta.etag = etag
        meta.updated_at = datetime.utcnow()
        session.add(meta)
    else:
        session.add(SyncMeta(resource=resource, etag=etag))
    session.commit()


@router.get("/sync-meta")
def get_sync_meta(session: Session = Depends(get_db)) -> dict[str, Any]:
    rows = session.exec(select(SyncMeta)).all()
    return {r.resource: {"etag": r.etag, "updatedAt": r.updated_at.isoformat()} for r in rows}


@router.get("/channels")
def list_channels(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
    channels = session.exec(select(Channel)).all()
    return [c.model_dump() for c in channels]


@router.put("/channels/{channel_id}")
def upsert_channel(channel_id: str, body: dict[str, Any], session: Session = Depends(get_db)) -> dict:
    normalized = _normalize_body(body)
    ch = session.get(Channel, channel_id)
    if ch:
        _apply_channel_fields(ch, normalized)
        ch.updated_at = datetime.utcnow()
    else:
        name = normalized.get("name", channel_id)
        extras = {
            k: v for k, v in normalized.items() if k in Channel.model_fields and k not in ("id", "name")
        }
        ch = Channel(id=channel_id, name=name, **extras)
    session.add(ch)
    session.commit()
    session.refresh(ch)
    _touch_sync(session, "channels")
    return ch.model_dump()


@router.get("/posts")
def list_posts(
    channel_name: str | None = None,
    session: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = select(Post)
    if channel_name:
        stmt = stmt.where(Post.channel_name == channel_name)
    posts = session.exec(stmt).all()
    return [
        {
            "id": p.post_id,
            "channelName": p.channel_name,
            "text": p.text,
            "date": p.date,
            "timestamp": p.timestamp,
            "forwardedFrom": p.forwarded_from,
            "forwardedFromName": p.forwarded_from_name,
        }
        for p in posts
    ]


@router.post("/posts/bulk")
def bulk_upsert_posts(body: list[dict[str, Any]], session: Session = Depends(get_db)) -> dict:
    count = 0
    for item in body:
        channel = item["channelName"]
        post_id = int(item["id"])
        existing = session.exec(
            select(Post).where(Post.channel_name == channel, Post.post_id == post_id)
        ).first()
        if existing:
            existing.text = item.get("text", existing.text)
            existing.date = item.get("date", existing.date)
            existing.timestamp = item.get("timestamp", existing.timestamp)
            existing.forwarded_from = item.get("forwardedFrom")
            existing.forwarded_from_name = item.get("forwardedFromName")
            existing.updated_at = datetime.utcnow()
            session.add(existing)
        else:
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=item.get("text", ""),
                    date=item.get("date", ""),
                    timestamp=item.get("timestamp", 0),
                    forwarded_from=item.get("forwardedFrom"),
                    forwarded_from_name=item.get("forwardedFromName"),
                )
            )
        count += 1
    session.commit()
    _touch_sync(session, "posts")
    return {"upserted": count}


@router.get("/summaries")
def list_summaries(session: Session = Depends(get_db)) -> list[dict]:
    return [s.model_dump() for s in session.exec(select(Summary)).all()]


@router.put("/summaries/{summary_id}")
def upsert_summary(summary_id: str, body: dict[str, Any], session: Session = Depends(get_db)) -> dict:
    s = session.get(Summary, summary_id)
    known = {"id", "text", "channels", "start_date", "end_date", "language", "model", "post_count", "timestamp"}
    if s:
        for k, v in body.items():
            snake = "".join(f"_{c.lower()}" if c.isupper() else c for c in k).lstrip("_")
            if snake in known:
                setattr(s, snake, v)
        extra = {k: v for k, v in body.items() if k not in known and k != "id"}
        s.extra = {**(s.extra or {}), **extra}
        s.updated_at = datetime.utcnow()
    else:
        s = Summary(
            id=summary_id,
            text=body.get("text", ""),
            channels=body.get("channels", []),
            start_date=body.get("startDate", 0),
            end_date=body.get("endDate", 0),
            language=body.get("language", "English"),
            model=body.get("model"),
            post_count=body.get("postCount"),
            timestamp=body.get("timestamp", 0),
            extra={k: v for k, v in body.items() if k not in known},
        )
    session.add(s)
    session.commit()
    session.refresh(s)
    _touch_sync(session, "summaries")
    return s.model_dump()


@router.get("/settings/{key}")
def get_setting(key: str, session: Session = Depends(get_db)) -> dict:
    row = session.get(AppSetting, key)
    if not row:
        return {"key": key, "value": {}}
    return {"key": key, "value": row.value}


@router.put("/settings/{key}")
def put_setting(key: str, body: dict[str, Any], session: Session = Depends(get_db)) -> dict:
    row = session.get(AppSetting, key)
    if row:
        row.value = body
        row.updated_at = datetime.utcnow()
    else:
        row = AppSetting(key=key, value=body)
    session.add(row)
    session.commit()
    _touch_sync(session, "settings")
    return {"key": key, "value": row.value}


@router.post("/import")
async def import_data(body: dict[str, Any], session: Session = Depends(get_db)) -> dict:
    """Import from TG-Summarizer ZIP export JSON structure."""
    counts: dict[str, int] = {}
    for store, model, mapper in [
        ("channels", Channel, lambda x: Channel(id=x["id"], name=x.get("name", x["id"]), **{
            k: x.get(k) for k in Channel.model_fields if k not in ("id", "name") and k in x
        })),
    ]:
        items = body.get(store, [])
        if items:
            for item in items:
                session.merge(mapper(item))
            counts[store] = len(items)
    if "posts" in body:
        bulk_upsert_posts(body["posts"], session)
        counts["posts"] = len(body["posts"])
    session.commit()
    return {"imported": counts}


@router.get("/export")
def export_data(session: Session = Depends(get_db)) -> dict:
    return {
        "channels": [c.model_dump() for c in session.exec(select(Channel)).all()],
        "posts": list_posts(session=session),
        "summaries": [s.model_dump() for s in session.exec(select(Summary)).all()],
        "bot_credentials": [],
        "exportedAt": datetime.utcnow().isoformat(),
    }
