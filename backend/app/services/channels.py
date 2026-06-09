"""Channel stats and queries (extracted from data routes)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlmodel import Session, col, select

from app.models_tg import Channel, Post


def compute_channel_stats(session: Session, channel_name: str) -> dict[str, Any] | None:
    posts = session.exec(
        select(Post).where(Post.channel_name == channel_name).order_by(col(Post.post_id))
    ).all()
    if not posts:
        return None
    post_ids = [p.post_id for p in posts]
    timestamps = sorted(p.timestamp for p in posts if p.timestamp)
    velocity = 0.0
    if len(timestamps) >= 2:
        recent = timestamps[-100:]
        ema_diff = (recent[1] - recent[0]) / (1000 * 60 * 60)
        alpha = 0.1
        for i in range(2, len(recent)):
            diff = (recent[i] - recent[i - 1]) / (1000 * 60 * 60)
            ema_diff = alpha * diff + (1 - alpha) * ema_diff
        time_since_last = (datetime.utcnow().timestamp() * 1000 - recent[-1]) / (1000 * 60 * 60)
        if time_since_last > ema_diff:
            ema_diff = alpha * time_since_last + (1 - alpha) * ema_diff
        if ema_diff > 0:
            velocity = 1 / ema_diff
    return {
        "count": len(posts),
        "minId": min(post_ids),
        "maxId": max(post_ids),
        "velocity": velocity,
    }


def channel_names_for_operator(session: Session, operator_id) -> set[str]:
    from app.services.operator import select_operator_channels

    return {ch.name for ch in select_operator_channels(session, operator_id=operator_id)}


def compute_channel_stats_batch(
    session: Session, channel_names: list[str]
) -> dict[str, dict[str, Any]]:
    """Return stats keyed by channel name (one round-trip for the frontend)."""
    out: dict[str, dict[str, Any]] = {}
    for name in channel_names:
        stats = compute_channel_stats(session, name)
        if stats:
            out[name] = stats
    return out
