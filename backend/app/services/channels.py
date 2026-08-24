"""Channel CRUD, stats, and queries (extracted from data routes)."""

from __future__ import annotations

import uuid
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import String, bindparam, true
from sqlalchemy import cast as sa_cast
from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Session, col, func, select

from app.models_tg import Channel, Post, utc_now
from app.services.channel_photos import delete_cached_photo
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_group_for_channel,
    get_or_create_restricted_group,
    load_groups_by_id,
    reject_inherited_channel_fields,
    update_default_group_sync_settings,
)
from app.services.channel_tags import (
    normalize_channel_tags,
    reject_reserved_virtual_group_tags,
)
from app.services.follows import ensure_follow_for_channel
from app.services.serialization import channel_to_camel, normalize_body
from app.services.sync_meta import touch_sync
from app.services.sync_schedule import (
    compute_next_regular_sync_at_from_last_updated,
)

SERVER_MANAGED_CHANNEL_FIELDS = frozenset({"telegram_chat_id"})


def update_channel_coverage(
    session: Session,
    channel: Channel,
    scrape_cutoff_ms: int,
    *,
    reached_channel_start: bool = False,
) -> None:
    """Recompute anchor post and history coverage flags after a sync pass.

    `reached_channel_start` means the backward walk paginated off the beginning
    of the channel during this sync. It is latched onto the channel because a
    later head-only (incremental) sync never revisits the beginning and would
    otherwise clear it.
    """
    for anchor in session.exec(
        select(Post).where(Post.channel_name == channel.name, Post.is_anchor == True)  # noqa: E712
    ).all():
        anchor.is_anchor = False
        anchor.updated_at = utc_now()
        session.add(anchor)

    channel.anchor_post_id = None

    oldest_ts_row = session.exec(
        select(func.min(Post.timestamp)).where(Post.channel_name == channel.name)
    ).one()
    oldest_ts = oldest_ts_row if oldest_ts_row else None
    channel.oldest_stored_post_timestamp = oldest_ts

    if reached_channel_start:
        channel.history_reached_channel_start = True

    if scrape_cutoff_ms <= 0:
        channel.history_complete_to_cutoff = True
    elif oldest_ts is None:
        channel.history_complete_to_cutoff = False
    else:
        # A post older than the cutoff proves the walk crossed the boundary.
        # Failing that, having walked back to the channel's first post proves
        # there is nothing older to fetch -- the channel is simply younger than
        # the retention window, which is complete coverage, not partial.
        channel.history_complete_to_cutoff = (
            oldest_ts < scrape_cutoff_ms or channel.history_reached_channel_start
        )

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
        anchor_post.updated_at = utc_now()
        session.add(anchor_post)
        channel.anchor_post_id = anchor_post.post_id

    channel.updated_at = utc_now()
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
        time_since_last = (utc_now().timestamp() * 1000 - recent[-1]) / (1000 * 60 * 60)
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
    return {  # ty: ignore[invalid-return-type]
        name: {"count": count, "minId": min_id, "maxId": max_id}
        for name, count, min_id, max_id in rows
    }


def _fetch_recent_timestamps_by_channel(
    session: Session,
    channel_names: list[str],
    *,
    limit: int = 100,
) -> dict[str, list[int]]:
    """The newest `limit` timestamps per channel, oldest first.

    Top-N per group, done as a LATERAL rather than a window function. A
    `row_number() OVER (PARTITION BY channel_name)` has to read every row of
    every channel before discarding all but `limit` of each: on staging that
    walked 4.52M index rows to return 130k, 1.56s of a 2.7s channel list.
    LATERAL lets `ix_tg_posts_channel_name_timestamp` stop after `limit`
    entries per channel — identical rows out, 106ms.

    The names arrive as one array parameter rather than a 2,068-row VALUES
    clause: the SQL text stays constant, so SQLAlchemy's compiled-statement
    cache hits instead of recompiling per call. Measured on staging, that is
    0.39s against VALUES' 0.55s for the same rows.

    Names are de-duplicated because joining against the name list multiplies
    rows where the `IN (...)` this replaced collapsed them, and `Channel.name`
    carries no unique constraint.
    """
    if not channel_names:
        return {}

    wanted = sa_select(
        func.unnest(
            sa_cast(
                bindparam("names", value=list(dict.fromkeys(channel_names))),
                ARRAY(String),
            )
        ).label("name")
    ).subquery("wanted")
    newest = (
        sa_select(col(Post.timestamp).label("timestamp"))
        .where(
            col(Post.channel_name) == wanted.c.name,
            col(Post.timestamp) > 0,
        )
        .order_by(col(Post.timestamp).desc())
        .limit(limit)
        .lateral("newest")
    )
    rows = session.execute(
        sa_select(wanted.c.name, newest.c.timestamp).select_from(
            wanted.join(newest, true())
        )
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


def list_all_channel_stats(session: Session) -> dict[str, dict[str, Any]]:
    """Post aggregates for every channel, keyed by channel name.

    Split out of `GET /channels?includeStats=true`, where the two queries behind
    it cost 2.36s of a 3.13s response while contributing 46 KB of a 536 KB
    payload. The grid was blocking its first paint on data that only two of its
    eleven sort options read — `activity_rate` and `total_posts` — and not the
    default one. As its own call it fills in after the grid is already up.
    """
    names = cast(list[str], session.exec(select(Channel.name)).all())
    return compute_channel_stats_batch(session, names)


def channel_names_for_operator(
    session: Session, operator_id: uuid.UUID | None
) -> set[str]:
    from app.services.operator import select_operator_channels

    return {
        ch.name for ch in select_operator_channels(session, operator_id=operator_id)
    }


def _reject_server_managed_channel_fields(normalized: dict[str, Any]) -> None:
    blocked_server_managed = sorted(
        key for key in normalized if key in SERVER_MANAGED_CHANNEL_FIELDS
    )
    if blocked_server_managed:
        blocked = ", ".join(blocked_server_managed)
        raise HTTPException(
            status_code=400,
            detail=f"Server-managed channel fields cannot be updated: {blocked}",
        )


def apply_channel_fields(
    ch: Channel,
    body: dict[str, Any],
    *,
    session: Session | None = None,  # noqa: ARG001
) -> None:
    reject_inherited_channel_fields(body)
    normalized = normalize_body(body)
    _reject_server_managed_channel_fields(normalized)
    if "setting_group_id" in normalized:
        raise HTTPException(
            status_code=400,
            detail=(
                "Use PATCH /data/channels/bulk-setting-group to reassign channels "
                "to a setting group"
            ),
        )
    for key, value in normalized.items():
        if key in Channel.model_fields and key not in (
            "id",
            "user_id",
            "setting_group_id",
        ):
            if key == "tags":
                reject_reserved_virtual_group_tags(value)
                value = normalize_channel_tags(value)
            setattr(ch, key, value)


def list_channel_bios(session: Session) -> dict[str, str]:
    """Every channel's bio, keyed by channel name. Empty bios are omitted.

    Split off the channel list for the same reason as the stats: it is 196 KB of
    a 494 KB gzipped payload — 40% — and the grid clamps it to two lines on the
    ~20 cards actually on screen. Truncating instead was measured and rejected:
    bios cap at 255 characters (mean 145), so cutting at 300 saves nothing and
    cutting at 120 would visibly clip text that fits today.

    A narrow two-column select, so this costs a fraction of what the full
    channel list does.
    """
    rows = session.exec(select(Channel.name, Channel.bio)).all()
    return {name: bio for name, bio in rows if bio}


def list_channels(
    session: Session, *, include_stats: bool = False
) -> list[dict[str, Any]]:
    """The channel list the grid paints from, **without `bio`**.

    `bio` is served by `list_channel_bios` instead — see there. `ChannelResponse`
    still declares it, because `PUT /channels/{id}` returns one channel in full;
    on this route the key is simply absent rather than an explicit `null`, which
    is why the payload is built as a dict here rather than serialised through the
    model.
    """
    channels = session.exec(select(Channel)).all()
    groups_by_id = load_groups_by_id(session)
    stats_map: dict[str, dict[str, Any]] = {}
    if include_stats and channels:
        stats_map = compute_channel_stats_batch(session, [c.name for c in channels])
    result: list[dict[str, Any]] = []
    for ch in channels:
        group = groups_by_id.get(ch.setting_group_id)
        row = channel_to_camel(ch, group=group)
        row.pop("bio", None)
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
    _reject_server_managed_channel_fields(normalized)
    ch = session.get(Channel, channel_id)
    if ch:
        reject_inherited_channel_fields(body)
        apply_channel_fields(ch, normalized, session=session)
        ch.updated_at = utc_now()
        group = get_group_for_channel(session, ch)
    else:
        name = normalized.get("name", channel_id)
        is_restricted = bool(
            normalized.get("is_unavailable_on_web_view") or normalized.get("is_frozen")
        )
        if is_restricted:
            group = get_or_create_restricted_group(session, user_id=user_id)
        else:
            group = ensure_default_group(session, user_id=user_id)
        now_ms = int(utc_now().timestamp() * 1000)
        extras = {
            k: v
            for k, v in normalized.items()
            if k in Channel.model_fields
            and k not in ("id", "name", "user_id", "setting_group_id")
            and k not in SERVER_MANAGED_CHANNEL_FIELDS
        }
        if "tags" in extras:
            reject_reserved_virtual_group_tags(extras["tags"])
            extras["tags"] = normalize_channel_tags(extras["tags"])
        if group.regular_sync_enabled:
            extras.setdefault(
                "next_regular_sync_at",
                compute_next_regular_sync_at_from_last_updated(
                    extras.get("last_updated"),
                    group.auto_sync_interval_minutes,
                    now_ms,
                ),
            )
        else:
            extras.setdefault("next_regular_sync_at", None)
        extras.setdefault("next_dynamic_sync_at", None)
        ch = Channel(
            id=channel_id,
            name=name,
            user_id=user_id,
            setting_group_id=group.id,
            **extras,
        )
    session.add(ch)
    # The follow is a Core INSERT that executes immediately, so the Channel has
    # to reach the database before it — but in the *same* transaction, or a
    # failure between the two leaves a Channel nobody follows, which is exactly
    # the drift `audit_tenancy_drift.py` reports.
    session.flush()
    ensure_follow_for_channel(session, ch, user_id=user_id)
    session.commit()
    session.refresh(ch)
    touch_sync(session, "channels")
    group = get_group_for_channel(session, ch)
    return channel_to_camel(ch, group=group)


def delete_channel(session: Session, channel_id: str) -> dict[str, str]:
    ch = session.get(Channel, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    # Bulk DELETE rather than loading every post to delete it one by one: a
    # busy channel holds hundreds of thousands of rows, and materialising them
    # to delete them is the same shape that OOM-killed the worker on staging.
    session.execute(sa_delete(Post).where(col(Post.channel_name) == ch.name))
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
    operator_id: uuid.UUID | None = None,
) -> dict[str, int]:
    if channel_ids is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Sync settings apply per setting group, not per channel. "
                "Use PATCH /data/channels/bulk-setting-group to reassign channels, "
                "or PATCH /data/setting-groups/{id} to update a group."
            ),
        )
    from app.services.operator import get_operator_user_id

    owner_id = operator_id or get_operator_user_id(session)
    result = update_default_group_sync_settings(
        session,
        user_id=owner_id,
        regular_sync_enabled=regular_sync_enabled,
        dynamic_sync_enabled=dynamic_sync_enabled,
        auto_sync_interval_minutes=auto_sync_interval_minutes,
        dynamic_sync_expected_posts=dynamic_sync_expected_posts,
    )
    touch_sync(session, "channels")
    return result


def bulk_update_channel_tags(
    session: Session,
    *,
    updates: list[dict[str, Any]],
    operator_id: uuid.UUID | None,
) -> dict[str, Any]:
    if not updates:
        raise HTTPException(status_code=400, detail="No tag updates provided")

    from app.services.operator import select_operator_channels

    deduped_updates: dict[str, list[Any]] = {}
    for update in updates:
        channel_id = update.get("channel_id")
        if not isinstance(channel_id, str) or not channel_id.strip():
            raise HTTPException(
                status_code=400, detail="Each update requires channelId"
            )
        deduped_updates[channel_id] = update.get("tags", [])

    operator_channels = select_operator_channels(session, operator_id=operator_id)
    by_id = {channel.id: channel for channel in operator_channels}

    missing = sorted(
        channel_id for channel_id in deduped_updates if channel_id not in by_id
    )
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Channels not found: {', '.join(missing)}",
        )

    updated_rows: list[dict[str, Any]] = []
    groups_by_id = load_groups_by_id(session)
    for channel_id, raw_tags in deduped_updates.items():
        channel = by_id[channel_id]
        reject_reserved_virtual_group_tags(raw_tags)
        channel.tags = normalize_channel_tags(raw_tags)
        channel.updated_at = utc_now()
        session.add(channel)
        updated_rows.append(
            channel_to_camel(channel, group=groups_by_id.get(channel.setting_group_id))
        )

    session.commit()
    touch_sync(session, "channels")
    return {"updated": len(updated_rows), "channels": updated_rows}
