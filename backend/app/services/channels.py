"""Channel CRUD, stats, and queries (extracted from data routes)."""

from __future__ import annotations

import uuid
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import String, bindparam, true
from sqlalchemy import cast as sa_cast
from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Session, col, func, select

from app.core.db import engine
from app.models_tg import (
    Channel,
    Post,
    PostEmbedding,
    PostTranslation,
    utc_now,
)
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
from app.services.follows import (
    MIRRORED_CHANNEL_FIELDS,
    follows_for_user,
    remove_follow,
    sync_follow_settings,
)
from app.services.logs import collect_channel_sync_logs
from app.services.post_sync_state import clear_channel_sync_state
from app.services.serialization import channel_to_camel, normalize_body
from app.services.sync_meta import touch_sync
from app.services.sync_schedule import (
    compute_next_regular_sync_at_from_last_updated,
)
from app.services.tenancy import scoped_select

#: Columns the server owns outright. A request naming one is refused, and an
#: import silently strips it rather than trusting a document.
#:
#: The two claim columns are here because `apply_channel_fields` writes any key
#: that exists in `Channel.model_fields`, `ChannelUpsertRequest` is
#: `extra="allow"`, and `normalize_body` snake-cases whatever arrives. Without
#: them, `PUT /data/channels/{id}` with `{"syncClaimedBy": null}` clears a live
#: holder's claim mid-walk and the next request starts the second concurrent
#: backward walk that ticket 11 exists to prevent — and the other direction is
#: worse for being quiet: writing a fresh `syncClaimedAt` with a holder nobody
#: owns parks that Channel until the lease lapses, every few minutes, for ever,
#: with no log line saying why. A claim is only an invariant if the only thing
#: that can write it is the code that reasons about it.
SERVER_MANAGED_CHANNEL_FIELDS = frozenset(
    {"telegram_chat_id", "sync_claimed_at", "sync_claimed_by"}
)


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


def list_all_channel_stats(
    session: Session, *, user_id: uuid.UUID
) -> dict[str, dict[str, Any]]:
    """Post aggregates for every Channel `user_id` may see, keyed by name.

    Split out of `GET /channels?includeStats=true`, where the two queries behind
    it cost 2.36s of a 3.13s response while contributing 46 KB of a 536 KB
    payload. The grid was blocking its first paint on data that only two of its
    eleven sort options read — `activity_rate` and `total_posts` — and not the
    default one. As its own call it fills in after the grid is already up.

    Scoped the same way `list_channels` is (ticket 15): a no-op while
    enforcement is off.
    """
    names = cast(
        list[str],
        session.exec(scoped_select(select(Channel.name), Channel, user_id)).all(),
    )
    return compute_channel_stats_batch(session, names)


def channel_names_for_user(session: Session, user_id: uuid.UUID) -> set[str]:
    """The Channel names `user_id` follows.

    Was `channel_names_for_operator`, over `Channel.user_id == operator OR
    NULL` (ticket 21). Two callers, and both are answering "which channels may
    this account's search or backfill touch": RAG's `IN` predicate on
    `PostEmbedding.channel_name`, and the embedding backfill's post selection.

    Follows rather than `scoped_select`, and the distinction matters. The seam's
    `Channel` branch consults `tenancy_enforced()`, so while the flag is off it
    returns **every** Channel in the corpus — which for RAG would mean one
    account's semantic search reading another account's posts right up until PR
    4 flipped the flag. This is not a visibility question the flag may defer; it
    is which channels the caller actually has, so it reads the follow table
    directly and answers the same in both flag states.

    Ticket 16 deferred this conversion here on the reasoning that
    `select_operator_channels` was shared with the scheduler and sync paths.
    Those callers are gone now, which is what makes the narrowing safe.
    """
    from app.services.follows import followed_channels_for

    return {
        channel.name
        for channel, _follow in followed_channels_for(session, user_id=user_id)
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


def list_channel_bios(session: Session, *, user_id: uuid.UUID) -> dict[str, str]:
    """Every channel `user_id` may see's bio, keyed by name. Empty bios omitted.

    Split off the channel list for the same reason as the stats: it is 196 KB of
    a 494 KB gzipped payload — 40% — and the grid clamps it to two lines on the
    ~20 cards actually on screen. Truncating instead was measured and rejected:
    bios cap at 255 characters (mean 145), so cutting at 300 saves nothing and
    cutting at 120 would visibly clip text that fits today.

    A narrow two-column select, so this costs a fraction of what the full
    channel list does. `scoped_select` is a no-op while enforcement is off
    (ticket 15), so this changes nothing until ticket 21 flips it on.
    """
    rows = session.exec(
        scoped_select(select(Channel.name, Channel.bio), Channel, user_id)
    ).all()
    return {name: bio for name, bio in rows if bio}


def list_channels(
    session: Session, *, user_id: uuid.UUID, include_stats: bool = False
) -> list[dict[str, Any]]:
    """The channel list the grid paints from, **without `bio`**.

    `bio` is served by `list_channel_bios` instead — see there. `ChannelResponse`
    still declares it, because `PUT /channels/{id}` returns one channel in full;
    on this route the key is simply absent rather than an explicit `null`, which
    is why the payload is built as a dict here rather than serialised through the
    model.

    Scoped to the Channels `user_id` follows (ticket 15) — a no-op while
    enforcement is off. Each row's tags/startId/startTime/followedAt/
    discoveredVia come from `user_id`'s own Follow when one exists, not from
    the Channel — see `channel_to_camel`.
    """
    channels = session.exec(scoped_select(select(Channel), Channel, user_id)).all()
    groups_by_id = load_groups_by_id(session)
    follows_by_channel_id = follows_for_user(
        session, user_id=user_id, channel_ids=[c.id for c in channels]
    )
    stats_map: dict[str, dict[str, Any]] = {}
    if include_stats and channels:
        stats_map = compute_channel_stats_batch(session, [c.name for c in channels])
    result: list[dict[str, Any]] = []
    for ch in channels:
        group = groups_by_id.get(ch.setting_group_id)
        row = channel_to_camel(ch, group=group, follow=follows_by_channel_id.get(ch.id))
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
    user_id: uuid.UUID,
) -> dict[str, Any]:
    normalized = normalize_body(body)
    _reject_server_managed_channel_fields(normalized)
    ch = session.get(Channel, channel_id)
    if ch:
        reject_inherited_channel_fields(body)
        apply_channel_fields(ch, normalized, session=session)
        ch.updated_at = utc_now()
        group = get_group_for_channel(session, ch)
        # Only the fields this particular edit touched — see
        # `sync_follow_settings` for why mirroring the full set on every call
        # is wrong. `setting_group_id` can never be one of these:
        # `apply_channel_fields` above already rejected it with a 400 if the
        # body carried it.
        touched_follow_fields = [
            field for field in MIRRORED_CHANNEL_FIELDS if field in normalized
        ]
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
        # A brand-new Channel has no existing Follow to leave alone, so its
        # first Follow mirrors every field ticket 22 will drop from Channel —
        # matching what `ensure_follow_for_channel` would have written.
        touched_follow_fields = list(MIRRORED_CHANNEL_FIELDS)
    session.add(ch)
    # The follow is a Core INSERT that executes immediately, so the Channel has
    # to reach the database before it — but in the *same* transaction, or a
    # failure between the two leaves a Channel nobody follows, which is exactly
    # the drift `audit_tenancy_drift.py` reports.
    #
    # `sync_follow_settings` rather than `ensure_follow_for_channel`: this is
    # the endpoint an edit reaches through, so an existing Follow's tags/start
    # time/etc. are meant to move with the new values, not survive them. See
    # `channel_to_camel`, which is why this has to stay current: it reads
    # these fields off the Follow, not `ch`.
    session.flush()
    sync_follow_settings(session, ch, user_id=user_id, fields=touched_follow_fields)
    session.commit()
    session.refresh(ch)
    touch_sync(session, "channels")
    group = get_group_for_channel(session, ch)
    return channel_to_camel(ch, group=group)


def unfollow_channel(
    session: Session,
    channel_id: str,
    *,
    user_id: uuid.UUID,
) -> dict[str, str]:
    """Take a Channel off one account's list (ticket 05).

    This used to delete the Channel row and bulk-delete every Post under it,
    for everybody, with no ownership check. That was coherent while one
    operator owned the database and stops being coherent the moment a Channel
    is a shared corpus: the second follower of a handle would lose a scrape
    they had nothing to do with because the first follower tidied their list.

    So removal drops the Follow and touches nothing else. The Channel and its
    Posts survive for as long as anyone still follows them, and
    `collect_unfollowed_channels` reclaims them from the retention job once
    nobody does — the delete is deferred, not abandoned.

    A channel the caller does not follow answers **404, not 403**, per the
    seam's `assert_owner` convention: 403 confirms the row exists, which is the
    enumeration oracle signup was hardened against. The detail names the
    resource so the oracle does not simply move into the body.

    **The channel list does not filter on follows yet** (ticket 15), so while
    enforcement is still off a removed channel stays visible until retention
    collects it. That gap is deliberate and argued in ticket 05: closing it
    here would mean scoping a read path a batch early, and the seam's rule is
    that no batch changes a response while the flag is off.
    """
    ch = session.get(Channel, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    if not remove_follow(session, user_id=user_id, channel_id=channel_id):
        raise HTTPException(status_code=404, detail="Channel not found")
    # `commit=False` immediately before the commit, so the etag moves in the
    # same transaction as the change it announces: split across two, a crash in
    # between leaves the follow gone and the etag stale, and a stale etag tells
    # every client there is nothing to refetch.
    touch_sync(session, "channels", commit=False)
    session.commit()
    return {"status": "unfollowed"}


def collect_unfollowed_channel(session: Session, channel_id: str) -> int:
    """Delete a Channel nobody follows, with the corpus underneath it.

    The deferred half of what `delete_channel` used to do in one step, called
    from the retention job over `channel_ids_without_follows`. Deleting the
    Posts here is not a contradiction of unfollow leaving them alone: unfollow
    is one account acting on its own list, this runs only once *no* account
    holds the corpus.

    The dependent rows go too. None of `tg_posts`, `tg_post_embeddings`,
    `tg_post_translations`, `tg_post_sync_state`, `tg_sync_logs` or
    `tg_sync_log_payloads` has a foreign key to `tg_channels` — they are keyed
    by `channel_name` — so nothing cascades, and a collection that removed only
    the Channel would leave six tables pointing at a handle nothing can reach,
    reclaimable only by a retention window an operator is free to set to 0.

    The two sync-log tables joined that list in **ticket 19**, when they became
    channel telemetry keyed by name rather than rows owned by an account. They
    are the heaviest tables in the schema, and stranding them is worse than
    stranding posts: once the `tg_channels` row is gone there is no Follow for
    the seam's EXISTS to find, so the rows are invisible to every account *and*
    still on disk. Visible-nowhere and reclaimed-never is the state a collection
    exists to prevent.

    Bulk DELETE rather than loading every post to delete it one by one: a busy
    channel holds hundreds of thousands of rows, and materialising them to
    delete them is the same shape that OOM-killed the worker on staging. That
    is also why cached thumbnails are left to the thumb cache's own size cap —
    clearing them needs a post id each, which is exactly the fetch this avoids.

    **The corpus is keyed by name and the Channel by id, so a name shared with
    a surviving Channel keeps its corpus.** `Channel.name` carries no unique
    constraint and `apply_channel_fields` lets a caller rewrite it, so two rows
    can name the same handle; deleting posts by name would then destroy the
    still-followed row's entire corpus from a background job with nobody
    watching. Rare, silent, unrecoverable — the three properties that make a
    check worth its query.

    Returns the number of Posts deleted. Does **not** commit, and does not
    touch the avatar on disk: the caller commits, and only then is the row
    provably gone. See `_collect_unfollowed_channels`.
    """
    ch = session.get(Channel, channel_id)
    if not ch:
        return 0

    shares_name = session.exec(
        select(Channel.id).where(Channel.name == ch.name, Channel.id != ch.id).limit(1)
    ).first()
    if shares_name is None:
        session.execute(
            sa_delete(PostEmbedding).where(col(PostEmbedding.channel_name) == ch.name)
        )
        session.execute(
            sa_delete(PostTranslation).where(
                col(PostTranslation.channel_name) == ch.name
            )
        )
        clear_channel_sync_state(session, ch.name)
        # Through the aggregate that owns those two tables, the way the sync
        # state above goes through `post_sync_state`. This module owns
        # `tg_channels`; reaching into `tg_sync_logs` from here would put a
        # second writer on it.
        collect_channel_sync_logs(session, ch.name)
        result = session.execute(
            sa_delete(Post).where(col(Post.channel_name) == ch.name)
        )
        deleted = cast(Any, result).rowcount or 0
    else:
        deleted = 0

    session.delete(ch)
    return deleted


def get_channel_stats(
    session: Session, channel_id: str, *, user_id: uuid.UUID
) -> dict[str, Any]:
    """A channel not among those `user_id` follows answers 404 (ticket 15).

    Same `assert_owner` convention `unfollow_channel` uses: 404 rather than
    403, and the detail names the resource, so "you may not see this" and
    "there is nothing here" stay indistinguishable from the response.
    """
    ch = session.exec(
        scoped_select(select(Channel).where(Channel.id == channel_id), Channel, user_id)
    ).first()
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
    operator_id: uuid.UUID,
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
    # `operator_id or get_operator_user_id(session)` until ticket 21. The one
    # caller is a route holding an authenticated `current_user.id`, so the
    # fallback was unreachable — and the default was what made the parameter
    # look optional to anyone adding a second caller.
    result = update_default_group_sync_settings(
        session,
        user_id=operator_id,
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
    operator_id: uuid.UUID,
) -> dict[str, Any]:
    if not updates:
        raise HTTPException(status_code=400, detail="No tag updates provided")

    from app.services.follows import followed_channels_for

    deduped_updates: dict[str, list[Any]] = {}
    for update in updates:
        channel_id = update.get("channel_id")
        if not isinstance(channel_id, str) or not channel_id.strip():
            raise HTTPException(
                status_code=400, detail="Each update requires channelId"
            )
        deduped_updates[channel_id] = update.get("tags", [])

    by_id = {
        channel.id: channel
        for channel, _follow in followed_channels_for(session, user_id=operator_id)
    }

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
        # Tags are read from the Follow now (ticket 15) — see
        # `channel_to_camel` — so the edit has to reach the operator's Follow
        # row too, or `list_channels` would keep showing the old tags.
        # `fields=["tags"]`, not the full mirrored set: this endpoint only
        # ever changes tags, and mirroring the rest too would overwrite a
        # Follow's own start time/discovered-via with the Channel's, on a
        # request that never touched either.
        sync_follow_settings(session, channel, user_id=operator_id, fields=["tags"])
        updated_rows.append(
            channel_to_camel(channel, group=groups_by_id.get(channel.setting_group_id))
        )

    session.commit()
    touch_sync(session, "channels")
    return {"updated": len(updated_rows), "channels": updated_rows}


# --------------------------------------------------------------------------
# Per-Channel sync claim (ticket 11)
# --------------------------------------------------------------------------
#
# Mutual exclusion for one Channel's sync, held in the database rather than in
# process memory. `scraper_jobs._channel_locks` was an `asyncio.Lock` per
# channel name, which stopped being sufficient the moment the scheduler left
# the web process (ticket 10): a lock in the worker says nothing to the API,
# and after ticket 13 it will say nothing to the worker beside it either.
#
# These four functions are the only writers of `sync_claimed_at` /
# `sync_claimed_by`, and each is **its own transaction**. They deliberately do
# not take the caller's `Session`: a claim that has not committed is not a
# claim -- nobody else can see it -- so joining a caller's transaction would
# make mutual exclusion depend on when that caller happens to commit, which is
# a decision made for unrelated reasons. It is also what keeps them off the
# path `CLAUDE.md` warns about: a session held open across the awaited sync
# would sit `idle in transaction` for the length of a backfill and pin the xmin
# horizon while it did.
#
# None of the four touches `updated_at` or `touch_sync`. A claim is not a
# change to the Channel as the API describes it, and bumping the etag on every
# claim, heartbeat and release would invalidate the channel list for every
# connected browser several times per sync -- for a field the list does not
# render.

#: How long a claim stays valid without a heartbeat.
#:
#: This bounds one thing only: how long a **dead** holder blocks its Channel. A
#: live sync renews well inside it (`CHANNEL_CLAIM_HEARTBEAT_SECONDS`), so a
#: deep backfill running for an hour is never at risk of having its claim
#: stolen mid-walk -- which would put a second backward walk into the cursors
#: the first is still writing, the precise interleaving this exists to prevent.
#:
#: Five minutes rather than the visibility timeout's ~2.4 hours, and the
#: difference is the point. The VT decides when a crashed worker's *message*
#: comes back; the lease decides when its *Channel* does. Sizing the lease off
#: the VT would mean a Channel that crashed at 12:00 refusing every sync until
#: 14:24 -- including the ones a person is sitting in front of.
CHANNEL_CLAIM_LEASE_SECONDS = 300

#: How often a running sync renews its lease. A third of the lease, so two
#: consecutive missed heartbeats (a slow database, a GC pause) still leave the
#: claim standing: at one half the first miss is already fatal, and at one
#: tenth the renewals cost more than the protection is worth.
CHANNEL_CLAIM_HEARTBEAT_SECONDS = CHANNEL_CLAIM_LEASE_SECONDS // 3


#: "Now", in epoch milliseconds, **as the database sees it**.
#:
#: Every one of these statements times the lease against `now()` rather than
#: against the calling process's `time.time()`. With one worker the two agree
#: and it looks like a distinction without a difference; ticket 13 puts a second
#: worker beside the first, and then a host clock five minutes fast steals a live
#: claim on its first attempt and starts the concurrent walk this whole file
#: exists to prevent — while a slow one refuses to reclaim a genuinely dead
#: holder. The comparison already runs inside Postgres, so taking both sides of
#: it from the same clock costs nothing and removes the assumption entirely.
#:
#: `now()` is transaction start time, so it is stable across the statement.
_DB_NOW_MS = "(EXTRACT(EPOCH FROM now()) * 1000)::bigint"

#: The instant before which a claim is stale and may be taken, in SQL.
_CLAIM_CUTOFF_MS = f"({_DB_NOW_MS} - :lease_ms)"


def try_claim_channel_sync(channel_id: str, *, holder: str) -> bool:
    """Take this Channel's sync claim for `holder`. True if it is now ours.

    One conditional `UPDATE ... RETURNING`, which is what makes it atomic
    against every other worker: PostgreSQL takes a row lock for the duration,
    so of two callers racing on an unclaimed Channel exactly one matches the
    predicate and the other finds it already set.

    The answer comes from `RETURNING` rather than from `rowcount`. On this
    statement the two agree -- a plain conditional `UPDATE` through
    `session.execute` does report an accurate `rowcount`, and a mutation
    swapping them was run and caught nothing. `RETURNING` is here as the
    spelling that survives the statement becoming an upsert, which is where
    `rowcount` has already lied in this repo: through `session.exec`, and on
    `ON CONFLICT DO NOTHING`, where it reports a write for a conflict that
    wrote nothing.

    An expired claim is taken rather than waited on, which is the whole of
    "a crashed worker's Channel is picked up again without intervention": there
    is no reaper to run and nothing for an operator to clear.
    """
    with Session(engine) as session:
        row = session.execute(
            sa_text(
                f"""
                UPDATE tg_channels
                   SET sync_claimed_at = {_DB_NOW_MS},
                       sync_claimed_by = :holder
                 WHERE id = :channel_id
                   AND (
                        sync_claimed_at IS NULL
                     OR sync_claimed_at < {_CLAIM_CUTOFF_MS}
                   )
             RETURNING id
                """  # noqa: S608
            ),
            {
                "holder": holder,
                "channel_id": channel_id,
                "lease_ms": CHANNEL_CLAIM_LEASE_SECONDS * 1000,
            },
        ).first()
        session.commit()
        return row is not None


def renew_channel_sync_claim(channel_id: str, *, holder: str) -> bool:
    """Push this claim's expiry out. False if we no longer hold it.

    Conditional on `sync_claimed_by`, so a runner whose lease lapsed and was
    stolen cannot renew its way back on top of the new holder. A False here
    means the sync is running without protection and its caller must stop --
    see `_heartbeat_channel_claim`.
    """
    with Session(engine) as session:
        row = session.execute(
            sa_text(
                f"""
                UPDATE tg_channels
                   SET sync_claimed_at = {_DB_NOW_MS}
                 WHERE id = :channel_id
                   AND sync_claimed_by = :holder
             RETURNING id
                """  # noqa: S608
            ),
            {"holder": holder, "channel_id": channel_id},
        ).first()
        session.commit()
        return row is not None


def release_channel_sync_claim(channel_id: str, *, holder: str) -> bool:
    """Give the claim up. False if it was not ours to give.

    Conditional on the holder for the same reason `renew` is, and it matters
    more here: an unconditional release runs at the end of every sync, so a
    runner that overran its lease and had the Channel taken from it would clear
    the *new* holder's claim on its way out and hand a third walk into cursors
    the second is mid-write.
    """
    with Session(engine) as session:
        row = session.execute(
            sa_text(
                """
                UPDATE tg_channels
                   SET sync_claimed_at = NULL,
                       sync_claimed_by = NULL
                 WHERE id = :channel_id
                   AND sync_claimed_by = :holder
             RETURNING id
                """
            ),
            {"channel_id": channel_id, "holder": holder},
        ).first()
        session.commit()
        return row is not None


def channel_sync_claim_holder(channel_id: str) -> str | None:
    """Who holds a *live* claim on this Channel, if anyone.

    Expiry is applied here rather than left to the caller, so "is this Channel
    being synced" has one answer. A caller comparing `sync_claimed_at` itself
    is a second copy of the lease rule, and the two would disagree about a
    stale claim first -- reporting a crashed worker's Channel as busy for ever.
    """
    with Session(engine) as session:
        row = session.execute(
            sa_text(
                f"""
                SELECT sync_claimed_by
                  FROM tg_channels
                 WHERE id = :channel_id
                   AND sync_claimed_by IS NOT NULL
                   AND sync_claimed_at IS NOT NULL
                   AND sync_claimed_at >= {_CLAIM_CUTOFF_MS}
                """  # noqa: S608
            ),
            {
                "channel_id": channel_id,
                "lease_ms": CHANNEL_CLAIM_LEASE_SECONDS * 1000,
            },
        ).first()
        return str(row[0]) if row else None
