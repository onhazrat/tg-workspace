"""Post list and bulk upsert (extracted from data routes)."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from sqlmodel import Session, col, select

from app.models_tg import Post
from app.services.serialization import post_to_camel
from app.services.sync_meta import touch_sync


def _post_media_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    media = item.get("media")
    return media if isinstance(media, dict) else None


def _post_links_from_item(item: dict[str, Any]) -> list[Any] | None:
    links = item.get("links")
    return links if isinstance(links, list) else None


def bulk_upsert_posts_impl(
    body: list[dict[str, Any]],
    session: Session,
    *,
    retrieval_job_id: str | None = None,
    retrieval_pass: str | None = None,
    retrieval_source: str | None = None,
) -> int:
    count = 0
    now_ms = int(time.time() * 1000)
    for item in body:
        channel = item.get("channelName") or item.get("channel_name", "")
        post_id = int(item.get("id") or item.get("post_id", 0))
        existing = session.exec(
            select(Post).where(Post.channel_name == channel, Post.post_id == post_id)
        ).first()
        if existing:
            existing.text = item.get("text", existing.text)
            existing.date = item.get("date", existing.date)
            existing.timestamp = item.get("timestamp", existing.timestamp)
            existing.forwarded_from = item.get("forwardedFrom") or item.get(
                "forwarded_from"
            )
            existing.forwarded_from_name = item.get("forwardedFromName") or item.get(
                "forwarded_from_name"
            )
            if "media" in item:
                existing.media = _post_media_from_item(item)
            if "links" in item:
                existing.links = _post_links_from_item(item)
            existing.updated_at = datetime.utcnow()
            session.add(existing)
        else:
            job_id = (
                item.get("retrievalJobId")
                or item.get("retrieval_job_id")
                or retrieval_job_id
            )
            pass_val = (
                item.get("retrievalPass")
                or item.get("retrieval_pass")
                or retrieval_pass
            )
            source = (
                item.get("retrievalSource")
                or item.get("retrieval_source")
                or retrieval_source
            )
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=item.get("text", ""),
                    date=item.get("date", ""),
                    timestamp=item.get("timestamp", 0),
                    forwarded_from=item.get("forwardedFrom")
                    or item.get("forwarded_from"),
                    forwarded_from_name=item.get("forwardedFromName")
                    or item.get("forwarded_from_name"),
                    media=_post_media_from_item(item),
                    links=_post_links_from_item(item),
                    retrieved_at=now_ms,
                    retrieval_job_id=job_id,
                    retrieval_pass=pass_val,
                    retrieval_source=source,
                )
            )
        count += 1
    return count


def list_posts(
    session: Session,
    *,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
) -> list[dict[str, Any]]:
    stmt = select(Post)
    if channel_names:
        stmt = stmt.where(col(Post.channel_name).in_(channel_names))
    if start_date is not None:
        stmt = stmt.where(Post.timestamp >= start_date)
    if end_date is not None:
        stmt = stmt.where(Post.timestamp <= end_date)
    return [post_to_camel(p) for p in session.exec(stmt).all()]


def bulk_upsert_posts(session: Session, body: list[dict[str, Any]]) -> dict[str, int]:
    count = bulk_upsert_posts_impl(body, session)
    session.commit()
    touch_sync(session, "posts")
    return {"upserted": count}
