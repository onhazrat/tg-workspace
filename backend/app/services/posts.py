"""Post bulk upsert (extracted from data routes)."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from app.models_tg import Post


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
            existing.updated_at = datetime.utcnow()
            session.add(existing)
        else:
            job_id = item.get("retrievalJobId") or item.get("retrieval_job_id") or retrieval_job_id
            pass_val = item.get("retrievalPass") or item.get("retrieval_pass") or retrieval_pass
            source = item.get("retrievalSource") or item.get("retrieval_source") or retrieval_source
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=item.get("text", ""),
                    date=item.get("date", ""),
                    timestamp=item.get("timestamp", 0),
                    forwarded_from=item.get("forwardedFrom") or item.get("forwarded_from"),
                    forwarded_from_name=item.get("forwardedFromName")
                    or item.get("forwarded_from_name"),
                    retrieved_at=now_ms,
                    retrieval_job_id=job_id,
                    retrieval_pass=pass_val,
                    retrieval_source=source,
                )
            )
        count += 1
    return count
