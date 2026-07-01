"""Channel CRUD, stats, and queries (extracted from data routes)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, col, func, select

from app.models_tg import Channel, Post
from app.jobs.settings import load_sync_settings
from app.services.channel_photos import delete_cached_photo
from app.services.serialization import channel_to_camel, normalize_body
from app.services.sync_schedule import compute_next_regular_sync_at
from app.services.sync_meta import touch_sync


def update_channel_coverage(
    session: Session,
    channel: Channel,
    scrape_cutoff_ms: int,
) -> None:
    """Recompute anchor post and history coverage flags after a sync pass."""
    for anchor in session.exec(
        select(Post).where(Post.channel_name == channel.name, Post.is_anchor == True)  # noqa: E712
    ).all():
        anchor.is_anchor = False
        anchor.updated_at = datetime.utcnow()
        session.add(anchor)

    channel.anchor_post_id = None

    oldest_ts_row = session.exec(
        select(func.min(Post.timestamp)).where(Post.channel_name == channel.name)
    ).one()
    oldest_ts = oldest_ts_row if oldest_ts_row else None
    channel.oldest_stored_post_timestamp = oldest_ts

    if scrape_cutoff_ms <= 0:
        channel.history_complete_to_cutoff = True
    elif oldest_ts is None:
        channel.history_complete_to_cutoff = False
    else:
        channel.history_complete_to_cutoff = oldest_ts < scrape_cutoff_ms

    anchor_post = session.exec(
        select(Post)
        .where(
            Post.channel_name == channel.name,
            Post.timestamp < scrape_cutoff_ms,
        )
        .order_by(col(Post.timestamp).desc(), col(Post.post_id).desc())
    ).first()

    if anchor_post and scrape_cutoff_ms > 0:
        anchor_post.is_anchor = True
        anchor_post.updated_at = datetime.utcnow()
        session.add(anchor_post)
        channel.anchor_post_id = anchor_post.post_id

    channel.updated_at = datetime.utcnow()
    session.add(channel)


def _velocity_from_timestamps(timestamps: list[int]) -> float:
    velocity = 0.0
    if len(timestamps) >= 2:
        recent = timestamps[-100:]
        ema_diff = (recent[1] - recent[0]) / (1000 * 60 * 60)
        alpha = 0.1
        for i in range(2, len(recent)):
            diff = (recent[i] - recent[i - 1]) / (1000 * 60 * 60)
            ema_diff = alpha * diff + (1 - alpha) * ema_diff
        time_since_last = (datetime.utcnow().timestamp() * 1000 - recent[-1]) / (
            1000 * 60 * 60
        )
        if time_since_last > ema_diff:
            ema_diff = alpha * time_since_last + (1 - alpha) * ema_diff
        if ema_diff > 0:
            velocity = 1 / ema_diff
    return velocity


def _fetch_channel_aggregates(
    session: Session, channel_names: list[str]
) -> dict[str, dict[str, int]]:
    rows = session.exec(
        select(
            Post.channel_name,
            func.count().label("count"),
            func.min(Post.post_id).label("min_id"),
            func.max(Post.post_id).label("max_id"),
        )
        .where(col(Post.channel_name).in_(channel_names))
        .group_by(Post.channel_name)
    ).all()
    return {
        name: {"count": count, "minId": min_id, "maxId": max_id}
        for name, count, min_id, max_id in rows
    }


def _fetch_recent_timestamps_by_channel(
    session: Session,
    channel_names: list[str],
    *,
    limit: int = 100,
) -> dict[str, list[int]]:
    rn = func.row_number().over(
        partition_by=Post.channel_name,
        order_by=col(Post.timestamp).desc(),
    ).label("rn")
    ranked = (
        select(Post.channel_name, Post.timestamp, rn).where(
            col(Post.channel_name).in_(channel_names),
            Post.timestamp > 0,
        )
    ).subquery()
    rows = session.exec(
        select(ranked.c.channel_name, ranked.c.timestamp).where(ranked.c.rn <= limit)
    ).all()
    by_channel: dict[str, list[int]] = {}
    for channel_name, timestamp in rows:
        by_channel.setdefault(channel_name, []).append(timestamp)
    for name in by_channel:
        by_channel[name].sort()
    return by_channel


def compute_channel_stats(session: Session, channel_name: str) -> dict[str, Any] | None:
    return compute_channel_stats_batch(session, [channel_name]).get(channel_name)


def compute_channel_stats_batch(
    session: Session, channel_names: list[str]
) -> dict[str, dict[str, Any]]:
    """Return stats keyed by channel name (one round-trip for the frontend)."""
    if not channel_names:
        return {}
    aggregates = _fetch_channel_aggregates(session, channel_names)
    timestamps_by_channel = _fetch_recent_timestamps_by_channel(session, channel_names)
    out: dict[str, dict[str, Any]] = {}
    for name, agg in aggregates.items():
        out[name] = {
            "count": agg["count"],
            "minId": agg["minId"],
            "maxId": agg["maxId"],
            "velocity": _velocity_from_timestamps(timestamps_by_channel.get(name, [])),
        }
    return out


def channel_names_for_operator(
    session: Session, operator_id: uuid.UUID | None
) -> set[str]:
    from app.services.operator import select_operator_channels

    return {
        ch.name for ch in select_operator_channels(session, operator_id=operator_id)
    }


def apply_channel_fields(ch: Channel, body: dict[str, Any]) -> None:
    normalized = normalize_body(body)
    for key, value in normalized.items():
        if key in Channel.model_fields and key not in ("id", "user_id"):
            setattr(ch, key, value)


def list_channels(
    session: Session, *, include_stats: bool = False
) -> list[dict[str, Any]]:
    channels = session.exec(select(Channel)).all()
    stats_map: dict[str, dict[str, Any]] = {}
    if include_stats and channels:
        stats_map = compute_channel_stats_batch(session, [c.name for c in channels])
    result: list[dict[str, Any]] = []
    for ch in channels:
        row = channel_to_camel(ch)
        if include_stats and ch.name in stats_map:
            row["stats"] = stats_map[ch.name]
        result.append(row)
    return result


def upsert_channel(
    session: Session,
    channel_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
    normalized = normalize_body(body)
    ch = session.get(Channel, channel_id)
    if ch:
        apply_channel_fields(ch, normalized)
        ch.updated_at = datetime.utcnow()
    else:
        name = normalized.get("name", channel_id)
        sync_defaults = load_sync_settings(session)
        regular_interval_minutes = int(
            sync_defaults.get("regularSyncIntervalMinutes") or 60
        )
        dynamic_enabled_default = bool(
            sync_defaults.get("dynamicSyncEnabledDefault", False)
        )
        dynamic_expected_posts_default = int(
            sync_defaults.get("dynamicSyncExpectedPostsDefault") or 15
        )
        now_ms = int(datetime.utcnow().timestamp() * 1000)
        extras = {
            k: v
            for k, v in normalized.items()
            if k in Channel.model_fields and k not in ("id", "name", "user_id")
        }
        extras.setdefault("regular_sync_enabled", True)
        extras.setdefault("dynamic_sync_enabled", dynamic_enabled_default)
        extras.setdefault(
            "auto_sync_interval_minutes",
            max(1, regular_interval_minutes),
        )
        extras.setdefault(
            "dynamic_sync_expected_posts",
            max(1, dynamic_expected_posts_default),
        )
        if extras.get("regular_sync_enabled"):
            extras.setdefault(
                "next_regular_sync_at",
                compute_next_regular_sync_at(
                    now_ms, int(extras["auto_sync_interval_minutes"])
                ),
            )
        extras.setdefault("next_dynamic_sync_at", None)
        ch = Channel(id=channel_id, name=name, user_id=user_id, **extras)
    session.add(ch)
    session.commit()
    session.refresh(ch)
    touch_sync(session, "channels")
    return channel_to_camel(ch)


def delete_channel(session: Session, channel_id: str) -> dict[str, str]:
    ch = session.get(Channel, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    posts = session.exec(select(Post).where(Post.channel_name == ch.name)).all()
    for post in posts:
        session.delete(post)
    session.delete(ch)
    session.commit()
    delete_cached_photo(channel_id)
    touch_sync(session, "channels")
    touch_sync(session, "posts")
    return {"status": "deleted"}


def get_channel_stats(session: Session, channel_id: str) -> dict[str, Any]:
    ch = session.get(Channel, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    stats = compute_channel_stats(session, ch.name)
    if not stats:
        raise HTTPException(status_code=404, detail="No posts for channel")
    return stats


def bulk_update_sync_settings(
    session: Session,
    *,
    channel_ids: list[str] | None,
    regular_sync_enabled: bool | None,
    dynamic_sync_enabled: bool | None,
    auto_sync_interval_minutes: int | None,
    dynamic_sync_expected_posts: int | None,
) -> dict[str, int]:
    if all(
        value is None
        for value in (
            regular_sync_enabled,
            dynamic_sync_enabled,
            auto_sync_interval_minutes,
            dynamic_sync_expected_posts,
        )
    ):
        raise HTTPException(status_code=400, detail="No sync settings fields provided")

    statement = select(Channel)
    if channel_ids is not None:
        statement = statement.where(col(Channel.id).in_(channel_ids))
    channels = session.exec(statement).all()

    for channel in channels:
        if regular_sync_enabled is not None:
            channel.regular_sync_enabled = regular_sync_enabled
        if dynamic_sync_enabled is not None:
            channel.dynamic_sync_enabled = dynamic_sync_enabled
        if auto_sync_interval_minutes is not None:
            channel.auto_sync_interval_minutes = max(1, auto_sync_interval_minutes)
        if dynamic_sync_expected_posts is not None:
            channel.dynamic_sync_expected_posts = max(1, dynamic_sync_expected_posts)
        channel.updated_at = datetime.utcnow()
        session.add(channel)

    session.commit()
    touch_sync(session, "channels")
    return {"updated": len(channels)}
