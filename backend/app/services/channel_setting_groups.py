"""Channel setting groups — strict inheritance for sync/operational fields."""

from __future__ import annotations

import time
import uuid
from typing import TYPE_CHECKING, Any, Literal, cast

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, col, select

from app.models_tg import Channel, ChannelSettingGroup, utc_now
from app.services.serialization import normalize_body, to_camel, to_snake
from app.services.sync_schedule import (
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at_from_last_updated,
)
from app.services.tenancy import (
    assert_owner_on_write,
    scoped_select,
    unscoped_select,
)

if TYPE_CHECKING:
    # Type-only: this module reaches the follow table through `follows.py`'s
    # helpers at runtime, and the aggregate is its only writer.
    from app.services.follows import FollowedChannel

SyncOperationMode = Literal[
    "sync_all", "bulk", "individual", "recheck_restricted", "auto"
]

SyncPermissionCheckMode = Literal[
    "sync_all", "bulk", "individual", "recheck_restricted"
]


def _velocity_from_timestamps(timestamps: list[int]) -> float:
    from app.services.channels import _velocity_from_timestamps as velocity_fn

    return velocity_fn(timestamps)


def _fetch_recent_timestamps_by_channel(
    session: Session, channel_names: list[str]
) -> dict[str, list[int]]:
    from app.services.channels import _fetch_recent_timestamps_by_channel as fetch_fn

    return fetch_fn(session, channel_names)


def recompute_next_regular_sync_at_on_interval_change(
    channel: Channel,
    *,
    previous_interval_minutes: int,
    now_ms: int | None = None,
    regular_sync_enabled: bool,
    auto_sync_interval_minutes: int,
) -> None:
    if auto_sync_interval_minutes == previous_interval_minutes:
        return
    if not regular_sync_enabled:
        return
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    channel.next_regular_sync_at = compute_next_regular_sync_at_from_last_updated(
        channel.last_updated,
        auto_sync_interval_minutes,
        now_ms,
    )


def recompute_next_dynamic_sync_at_on_expected_posts_change(
    session: Session,
    channel: Channel,
    *,
    previous_expected_posts: int,
    now_ms: int | None = None,
    dynamic_sync_enabled: bool,
    dynamic_sync_expected_posts: int,
) -> None:
    if dynamic_sync_expected_posts == previous_expected_posts:
        return
    if not dynamic_sync_enabled:
        return
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    recent_timestamps = _fetch_recent_timestamps_by_channel(
        session, [channel.name]
    ).get(channel.name, [])
    has_posts = bool(recent_timestamps)
    velocity = _velocity_from_timestamps(recent_timestamps)
    if not has_posts:
        channel.next_dynamic_sync_at = None
    elif velocity > 0:
        channel.next_dynamic_sync_at = compute_next_dynamic_sync_at_from_last_updated(
            channel.last_updated,
            dynamic_sync_expected_posts,
            velocity,
            now_ms,
        )


INHERITED_SNAKE_FIELDS = frozenset(
    {
        "regular_sync_enabled",
        "dynamic_sync_enabled",
        "auto_sync_interval_minutes",
        "dynamic_sync_expected_posts",
        "auto_follow_forwarded",
        "is_frozen",
        "is_unavailable_on_web_view",
        "include_in_sync_all",
        "include_in_bulk_sync",
        "allow_individual_sync",
        "reset_sync_enabled",
    }
)

RESTRICTED_GROUP_NAME = "Restricted"
FROZEN_GROUP_NAME = "Frozen"
DEFAULT_GROUP_NAME = "default"
SLOW_FEED_GROUP_NAME = "Slow feed"
HIGH_VELOCITY_GROUP_NAME = "High velocity"
RESERVED_GROUP_NAMES = frozenset(
    {
        DEFAULT_GROUP_NAME,
        RESTRICTED_GROUP_NAME,
        FROZEN_GROUP_NAME,
        SLOW_FEED_GROUP_NAME,
        HIGH_VELOCITY_GROUP_NAME,
    }
)

DEFAULT_GROUP_REGULAR_SYNC_ENABLED = True
DEFAULT_GROUP_DYNAMIC_SYNC_ENABLED = False
DEFAULT_GROUP_AUTO_SYNC_INTERVAL_MINUTES = 60
DEFAULT_GROUP_DYNAMIC_SYNC_EXPECTED_POSTS = 15
DEFAULT_GROUP_AUTO_FOLLOW_FORWARDED = False

SLOW_FEED_AUTO_SYNC_INTERVAL_MINUTES = 1440
SLOW_FEED_DYNAMIC_SYNC_EXPECTED_POSTS = 1
HIGH_VELOCITY_AUTO_SYNC_INTERVAL_MINUTES = 60
HIGH_VELOCITY_DYNAMIC_SYNC_EXPECTED_POSTS = 10

BUILTIN_GROUP_SORT_ORDER: dict[str, int] = {
    DEFAULT_GROUP_NAME.lower(): 0,
    SLOW_FEED_GROUP_NAME.lower(): 1,
    HIGH_VELOCITY_GROUP_NAME.lower(): 2,
    FROZEN_GROUP_NAME.lower(): 3,
    RESTRICTED_GROUP_NAME.lower(): 4,
}


def channel_is_frozen(
    pair: FollowedChannel, groups_by_id: dict[str, ChannelSettingGroup]
) -> bool:
    """Whether this follower has parked this Channel in a frozen group.

    Takes the `(Channel, follow)` pair rather than the Channel since ticket 22:
    freezing is one account's judgement about its own list, and reading it off
    the Channel reported every follower as frozen because one of them was. The
    pair rather than the bare follow so this module never names `ChannelFollow`
    — see `bulk_channels.is_auto_followed_channel` for why that matters.

    A follow naming no group is **not** frozen. That matches the old behaviour
    for an unresolvable group id and is the safe direction: treating it as
    frozen would silently stop summarising a channel over missing data.
    """
    group_id = pair[1].setting_group_id
    if group_id is None:
        return False
    group = groups_by_id.get(group_id)
    return bool(group and group.is_frozen)


def scope_key(user_id: uuid.UUID | None) -> str:
    return str(user_id) if user_id is not None else "global"


def default_group_id_for_user(user_id: uuid.UUID | None) -> str:
    return f"default-{scope_key(user_id)}"


def restricted_group_id_for_user(user_id: uuid.UUID | None) -> str:
    return f"restricted-{scope_key(user_id)}"


def frozen_group_id_for_user(user_id: uuid.UUID | None) -> str:
    return f"frozen-{scope_key(user_id)}"


def slow_feed_group_id_for_user(user_id: uuid.UUID | None) -> str:
    return f"slow-feed-{scope_key(user_id)}"


def high_velocity_group_id_for_user(user_id: uuid.UUID | None) -> str:
    return f"high-velocity-{scope_key(user_id)}"


def is_reserved_group_id(group_id: str) -> bool:
    return (
        group_id.startswith("default-")
        or group_id.startswith("restricted-")
        or group_id.startswith("frozen-")
        or group_id.startswith("slow-feed-")
        or group_id.startswith("high-velocity-")
    )


def _name_collision_scope_filter(
    user_id: uuid.UUID | None,
) -> ColumnElement[bool]:
    """The rows a *name* can collide with — identity, not visibility.

    This helper used to be named for the operator and did two jobs. Ticket 35
    took the visibility one away: `list_setting_groups` goes through
    `scoped_select` now, and two owner filters with different NULL handling is
    the drift `tenancy.py` exists to prevent. The old name is deliberately not
    written out anywhere in this module — the guard for its removal is a
    substring scan, and prose naming it would keep the scan red.

    What is left answers "is this name already taken", which mirrors the unique
    index `(COALESCE(user_id::text, 'global'), lower(name))`. Ticket 30's rule
    applies: the owner in a key answers *which row is yours*, and a flag cannot
    gate identity — so this deliberately does not consult `tenancy_enforced()`
    and deliberately is not `scoped_select`. Adopting the seam here would make a
    duplicate name stop being rejected while enforcement is off and start
    arriving as a Postgres `UniqueViolation` instead of the route's 409.

    It stays *wider* than the index — `me OR NULL` rather than exactly my
    scope — because that is what it has always been, and narrowing it to match
    the index would start allowing names the operator has been prevented from
    using since the presets were seeded. Ticket 22 can reconcile the two once
    the global rows are gone.
    """
    if user_id is None:
        return col(ChannelSettingGroup.user_id).is_(None)
    return or_(
        cast(ColumnElement[bool], ChannelSettingGroup.user_id == user_id),
        col(ChannelSettingGroup.user_id).is_(None),
    )


def _legacy_duplicate_reserved_groups(
    session: Session,
    *,
    user_id: uuid.UUID | None,
    reserved_name: str,
    canonical_id: str,
) -> list[ChannelSettingGroup]:
    return list(
        session.exec(
            select(ChannelSettingGroup).where(
                ChannelSettingGroup.name == reserved_name,
                ChannelSettingGroup.id != canonical_id,
                ~col(ChannelSettingGroup.id).like("default-%"),
                ~col(ChannelSettingGroup.id).like("restricted-%"),
                ~col(ChannelSettingGroup.id).like("frozen-%"),
                _name_collision_scope_filter(user_id),
            )
        ).all()
    )


def consolidate_legacy_duplicate_reserved_groups(
    session: Session, *, user_id: uuid.UUID
) -> int:
    """Merge legacy user-created reserved-name groups into canonical reserved ids."""
    merged = 0
    for reserved_name, canonical_creator in (
        (FROZEN_GROUP_NAME, get_or_create_frozen_group),
        (RESTRICTED_GROUP_NAME, get_or_create_restricted_group),
    ):
        canonical = canonical_creator(session, user_id=user_id)
        for legacy in _legacy_duplicate_reserved_groups(
            session,
            user_id=user_id,
            reserved_name=reserved_name,
            canonical_id=canonical.id,
        ):
            # Ticket 22: the follows name the group, not the Channels.
            # Delegated because `follows.py` is the table's only writer, which
            # `test_channel_creation_paths.py` enforces by refusing any mention
            # of `ChannelFollow` outside it.
            from app.services.follows import repoint_follows_between_groups

            repoint_follows_between_groups(
                session,
                user_id=user_id,
                from_group_id=legacy.id,
                to_group_id=canonical.id,
            )
            session.delete(legacy)
            merged += 1
    if merged:
        session.flush()
    return merged


def reject_inherited_channel_fields(body: dict[str, Any]) -> None:
    normalized = normalize_body(body)
    blocked = sorted(
        to_camel(key)
        for key in normalized
        if key in INHERITED_SNAKE_FIELDS or to_snake(key) in INHERITED_SNAKE_FIELDS
    )
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=(
                "Sync and operational settings are managed per setting group. "
                f"Cannot update inherited fields on a channel: {', '.join(blocked)}. "
                "Update the channel's setting group or reassign it via "
                "PATCH /data/channels/bulk-setting-group."
            ),
        )


def default_group_field_values(_session: Session | None = None) -> dict[str, Any]:
    return {
        "regular_sync_enabled": DEFAULT_GROUP_REGULAR_SYNC_ENABLED,
        "dynamic_sync_enabled": DEFAULT_GROUP_DYNAMIC_SYNC_ENABLED,
        "auto_sync_interval_minutes": DEFAULT_GROUP_AUTO_SYNC_INTERVAL_MINUTES,
        "dynamic_sync_expected_posts": DEFAULT_GROUP_DYNAMIC_SYNC_EXPECTED_POSTS,
        "auto_follow_forwarded": DEFAULT_GROUP_AUTO_FOLLOW_FORWARDED,
        "is_frozen": False,
        "is_unavailable_on_web_view": False,
        "include_in_sync_all": True,
        "include_in_bulk_sync": True,
        "allow_individual_sync": True,
        "reset_sync_enabled": True,
    }


def is_restricted_group(group: ChannelSettingGroup) -> bool:
    return group.id.startswith("restricted-") or group.is_unavailable_on_web_view


def channel_allows_sync_operation(
    group: ChannelSettingGroup,
    operation: SyncPermissionCheckMode,
) -> bool:
    if operation == "sync_all":
        return group.include_in_sync_all
    if operation in ("bulk", "recheck_restricted"):
        return group.include_in_bulk_sync
    return group.allow_individual_sync


def channel_allows_reset(
    group: ChannelSettingGroup,
    *,
    bulk: bool,
) -> bool:
    if not group.reset_sync_enabled:
        return False
    if bulk:
        return group.include_in_bulk_sync
    return True


def move_channel_from_restricted_to_default(
    session: Session,
    channel: Channel,
    *,
    user_id: uuid.UUID,
) -> ChannelSettingGroup | None:
    # Ticket 22: which group this channel is in is a fact about the *caller's*
    # follow now, not about the Channel. An account with no follow has no group
    # to move off, which is not the same as "not restricted" — but it reaches
    # the same answer here, and inventing one would move a stranger's channel.
    from app.services.follows import get_follow

    follow = get_follow(session, user_id=user_id, channel_id=channel.id)
    if follow is None:
        return None
    group = session.get(ChannelSettingGroup, follow.setting_group_id)
    if not group or not is_restricted_group(group):
        return None
    # `user_id or channel.user_id` until ticket 21, and the `or` could only
    # ever reach `channel.user_id` when `user_id` was None — which is how a
    # channel with no owner got its caller a `-global` setting group nobody
    # owns. `user_id` is now required, and a UUID is always truthy, so the
    # second operand was unreachable the moment the signature narrowed.
    default_group = ensure_default_group(session, user_id=user_id)
    follow.setting_group_id = default_group.id
    follow.updated_at = utc_now()
    session.add(follow)
    channel.updated_at = utc_now()
    now_ms = int(time.time() * 1000)
    if not default_group.regular_sync_enabled:
        channel.next_regular_sync_at = None
    else:
        recompute_next_regular_sync_at_on_interval_change(
            channel,
            previous_interval_minutes=default_group.auto_sync_interval_minutes,
            now_ms=now_ms,
            regular_sync_enabled=default_group.regular_sync_enabled,
            auto_sync_interval_minutes=default_group.auto_sync_interval_minutes,
        )
    if not default_group.dynamic_sync_enabled:
        channel.next_dynamic_sync_at = None
    else:
        recompute_next_dynamic_sync_at_on_expected_posts_change(
            session,
            channel,
            previous_expected_posts=default_group.dynamic_sync_expected_posts,
            now_ms=now_ms,
            dynamic_sync_enabled=default_group.dynamic_sync_enabled,
            dynamic_sync_expected_posts=default_group.dynamic_sync_expected_posts,
        )
    session.add(channel)
    return default_group


def ensure_default_group(
    session: Session, *, user_id: uuid.UUID
) -> ChannelSettingGroup:
    group_id = default_group_id_for_user(user_id)
    existing = session.get(ChannelSettingGroup, group_id)
    if existing:
        return existing
    values = default_group_field_values()
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=DEFAULT_GROUP_NAME,
        is_default=True,
        **values,
    )
    session.add(group)
    session.flush()
    return group


def get_or_create_restricted_group(
    session: Session, *, user_id: uuid.UUID
) -> ChannelSettingGroup:
    group_id = restricted_group_id_for_user(user_id)
    existing = session.get(ChannelSettingGroup, group_id)
    if existing:
        return existing
    values = default_group_field_values()
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=RESTRICTED_GROUP_NAME,
        is_default=False,
        regular_sync_enabled=False,
        dynamic_sync_enabled=False,
        is_frozen=True,
        is_unavailable_on_web_view=True,
        include_in_sync_all=False,
        include_in_bulk_sync=True,
        allow_individual_sync=True,
        reset_sync_enabled=False,
        auto_sync_interval_minutes=values["auto_sync_interval_minutes"],
        dynamic_sync_expected_posts=values["dynamic_sync_expected_posts"],
        auto_follow_forwarded=False,
    )
    session.add(group)
    session.flush()
    return group


def get_or_create_frozen_group(
    session: Session, *, user_id: uuid.UUID
) -> ChannelSettingGroup:
    group_id = frozen_group_id_for_user(user_id)
    existing = session.get(ChannelSettingGroup, group_id)
    if existing:
        return existing
    values = default_group_field_values()
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=FROZEN_GROUP_NAME,
        is_default=False,
        regular_sync_enabled=False,
        dynamic_sync_enabled=False,
        is_frozen=True,
        is_unavailable_on_web_view=False,
        include_in_sync_all=False,
        include_in_bulk_sync=False,
        allow_individual_sync=True,
        reset_sync_enabled=True,
        auto_sync_interval_minutes=values["auto_sync_interval_minutes"],
        dynamic_sync_expected_posts=values["dynamic_sync_expected_posts"],
        auto_follow_forwarded=False,
    )
    session.add(group)
    session.flush()
    return group


def get_or_create_slow_feed_group(
    session: Session, *, user_id: uuid.UUID
) -> ChannelSettingGroup:
    group_id = slow_feed_group_id_for_user(user_id)
    existing = session.get(ChannelSettingGroup, group_id)
    if existing:
        return existing
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=SLOW_FEED_GROUP_NAME,
        is_default=False,
        regular_sync_enabled=True,
        dynamic_sync_enabled=True,
        auto_sync_interval_minutes=SLOW_FEED_AUTO_SYNC_INTERVAL_MINUTES,
        dynamic_sync_expected_posts=SLOW_FEED_DYNAMIC_SYNC_EXPECTED_POSTS,
        auto_follow_forwarded=False,
        is_frozen=False,
        is_unavailable_on_web_view=False,
    )
    session.add(group)
    session.flush()
    return group


def get_or_create_high_velocity_group(
    session: Session, *, user_id: uuid.UUID
) -> ChannelSettingGroup:
    group_id = high_velocity_group_id_for_user(user_id)
    existing = session.get(ChannelSettingGroup, group_id)
    if existing:
        return existing
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=HIGH_VELOCITY_GROUP_NAME,
        is_default=False,
        regular_sync_enabled=True,
        dynamic_sync_enabled=True,
        auto_sync_interval_minutes=HIGH_VELOCITY_AUTO_SYNC_INTERVAL_MINUTES,
        dynamic_sync_expected_posts=HIGH_VELOCITY_DYNAMIC_SYNC_EXPECTED_POSTS,
        auto_follow_forwarded=False,
        is_frozen=False,
        is_unavailable_on_web_view=False,
    )
    session.add(group)
    session.flush()
    return group


def ensure_builtin_groups(
    session: Session, *, user_id: uuid.UUID
) -> tuple[
    ChannelSettingGroup,
    ChannelSettingGroup,
    ChannelSettingGroup,
    ChannelSettingGroup,
    ChannelSettingGroup,
]:
    default_group = ensure_default_group(session, user_id=user_id)
    slow_feed_group = get_or_create_slow_feed_group(session, user_id=user_id)
    high_velocity_group = get_or_create_high_velocity_group(session, user_id=user_id)
    frozen_group = get_or_create_frozen_group(session, user_id=user_id)
    restricted_group = get_or_create_restricted_group(session, user_id=user_id)
    return (
        default_group,
        slow_feed_group,
        high_velocity_group,
        frozen_group,
        restricted_group,
    )


def ensure_reserved_groups(
    session: Session, *, user_id: uuid.UUID
) -> tuple[ChannelSettingGroup, ChannelSettingGroup, ChannelSettingGroup]:
    default_group, _, _, frozen_group, restricted_group = ensure_builtin_groups(
        session, user_id=user_id
    )
    return default_group, restricted_group, frozen_group


def find_group_for_channel(
    session: Session, channel: Channel, *, user_id: uuid.UUID
) -> ChannelSettingGroup | None:
    """The group governing `user_id`'s follow of `channel`, or None.

    The non-raising half of `get_group_for_channel`, split out in ticket 22 for
    the background callers. A follow with no group is what `ChannelFollow`'s
    docstring calls "skip this channel", and the schedulers act on exactly that
    — so a caller with no HTTP response to put a status code in needs the answer
    as a value, not as an `HTTPException` escaping into a queue consumer.
    """
    from app.services.follows import get_follow

    follow = get_follow(session, user_id=user_id, channel_id=channel.id)
    if follow is None or follow.setting_group_id is None:
        return None
    return session.get(ChannelSettingGroup, follow.setting_group_id)


def get_group_for_channel(
    session: Session, channel: Channel, *, user_id: uuid.UUID
) -> ChannelSettingGroup:
    """The group governing `user_id`'s follow of `channel`.

    `user_id` became required in ticket 22. The group id used to sit on the
    Channel, so this took no account at all and every follower of a handle got
    whichever group the first follower picked; it lives on `ChannelFollow` now,
    so the answer depends on who is asking.

    Still a 500 rather than a 404 when it does not resolve, and for both the
    missing-follow and missing-group cases. The callers have already established
    that this account may see the channel, so either state is a broken invariant
    rather than a request for something that is not there — which is what a 500
    says and a 404 would not.

    **Only for callers that have a response to put the 500 in.** Ticket 22 made
    a NULL group reachable — it used to fall back to the Channel's copy — and
    the scraper called this before its own `try`, so an unschedulable follow
    aborted the message instead of skipping the channel. Those callers take
    `find_group_for_channel` instead.
    """
    group = find_group_for_channel(session, channel, user_id=user_id)
    if not group:
        raise HTTPException(
            status_code=500,
            detail=f"Setting group not found for channel {channel.id}",
        )
    return group


def load_groups_by_id(session: Session) -> dict[str, ChannelSettingGroup]:
    """Every group, keyed by id — a resolution map, deliberately unscoped.

    Ticket 35 audited this and left it reading across accounts, which is a
    decision rather than an omission, so it says so through the seam's own
    escape hatch instead of a bare `select`.

    Every one of the seven call sites does `groups_by_id.get(
    channel.setting_group_id)` for a channel it has *already* been allowed to
    see. The id therefore comes from a scoped row, and a second filter here
    cannot hide anything from anybody — it can only blank the policy attached to
    a channel the caller legitimately follows. That matters because three call
    sites read a missing group as "skip this channel": `auto_sync` continues past
    it, `bulk_channels` refuses the reset, and `get_group_for_channel` raises a
    500. Auto-follow files a Channel under whoever scraped it first, so under
    enforcement a scoped map would quietly stop syncing channels the second
    follower watches.
    """
    statement = unscoped_select(
        select(ChannelSettingGroup),
        reason=(
            "A resolution map for setting-group ids the caller already holds "
            "from rows it may see. Scoping it hides no row from anyone and "
            "instead drops the sync policy of a followed channel, which "
            "auto_sync and bulk reset both read as 'skip this channel'."
        ),
    )
    return {group.id: group for group in session.exec(statement).all()}


def channel_counts_by_group(session: Session) -> dict[str, int]:
    """How many channels sit in each group, counted over follows (ticket 22).

    `Channel` no longer names a group, so this counts `tg_channel_follows`
    instead. The number it returns is the same one the UI has always shown on a
    single-account deployment, and the right one as soon as there are two: a
    group belongs to one account, so only that account's follows can be in it.
    Counting Channels would have meant counting a shared row once per group it
    appeared in, which stopped being expressible when the column moved.
    """
    from app.services.follows import follow_counts_by_group

    return follow_counts_by_group(session)


def _group_sort_key(group: ChannelSettingGroup) -> tuple[int, str]:
    if group.is_default:
        return (0, group.name.lower())
    order = BUILTIN_GROUP_SORT_ORDER.get(group.name.lower(), 100)
    return (order, group.name.lower())


def _find_group_by_name_ci(
    session: Session,
    *,
    name: str,
    user_id: uuid.UUID | None,
    exclude_id: str | None = None,
) -> ChannelSettingGroup | None:
    normalized = name.strip().lower()
    if not normalized:
        return None
    groups = session.exec(
        select(ChannelSettingGroup).where(_name_collision_scope_filter(user_id))
    ).all()
    for group in groups:
        if exclude_id and group.id == exclude_id:
            continue
        if group.name.lower() == normalized:
            return group
    return None


def _reject_duplicate_group_name(
    session: Session,
    *,
    name: str,
    user_id: uuid.UUID | None,
    exclude_id: str | None = None,
) -> None:
    duplicate = _find_group_by_name_ci(
        session, name=name, user_id=user_id, exclude_id=exclude_id
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"A setting group named '{duplicate.name}' already exists",
        )


def setting_group_to_camel(
    group: ChannelSettingGroup,
    *,
    channel_count: int | None = None,
) -> dict[str, Any]:
    row = {
        "id": group.id,
        "name": group.name,
        "isDefault": group.is_default,
        "isReserved": is_reserved_group_id(group.id),
        "regularSyncEnabled": group.regular_sync_enabled,
        "dynamicSyncEnabled": group.dynamic_sync_enabled,
        "autoSyncIntervalMinutes": group.auto_sync_interval_minutes,
        "dynamicSyncExpectedPosts": group.dynamic_sync_expected_posts,
        "autoFollowForwarded": group.auto_follow_forwarded,
        "isFrozen": group.is_frozen,
        "isUnavailableOnWebView": group.is_unavailable_on_web_view,
        "includeInSyncAll": group.include_in_sync_all,
        "includeInBulkSync": group.include_in_bulk_sync,
        "allowIndividualSync": group.allow_individual_sync,
        "resetSyncEnabled": group.reset_sync_enabled,
        "createdAt": int(group.created_at.timestamp() * 1000),
        "updatedAt": int(group.updated_at.timestamp() * 1000),
    }
    if channel_count is not None:
        row["channelCount"] = channel_count
    return row


def effective_channel_fields(group: ChannelSettingGroup) -> dict[str, Any]:
    return {
        "settingGroupId": group.id,
        "settingGroupName": group.name,
        "regularSyncEnabled": group.regular_sync_enabled,
        "dynamicSyncEnabled": group.dynamic_sync_enabled,
        "autoSyncIntervalMinutes": group.auto_sync_interval_minutes,
        "dynamicSyncExpectedPosts": group.dynamic_sync_expected_posts,
        "autoFollowForwarded": group.auto_follow_forwarded,
        "isFrozen": group.is_frozen,
        "isUnavailableOnWebView": group.is_unavailable_on_web_view,
        "includeInSyncAll": group.include_in_sync_all,
        "includeInBulkSync": group.include_in_bulk_sync,
        "allowIndividualSync": group.allow_individual_sync,
        "resetSyncEnabled": group.reset_sync_enabled,
    }


def apply_group_fields(group: ChannelSettingGroup, body: dict[str, Any]) -> None:
    normalized = normalize_body(body)
    if "name" in normalized and (group.is_default or is_reserved_group_id(group.id)):
        normalized.pop("name", None)
    if "name" in normalized:
        name = str(normalized["name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Group name is required")
        if name.lower() in {reserved.lower() for reserved in RESERVED_GROUP_NAMES}:
            raise HTTPException(
                status_code=400,
                detail=f"Reserved group name; built-in group '{name}' already exists",
            )
        group.name = name
    for key in INHERITED_SNAKE_FIELDS:
        if key not in normalized:
            continue
        value = normalized[key]
        if key in ("auto_sync_interval_minutes", "dynamic_sync_expected_posts"):
            value = max(1, int(value))
        setattr(group, key, value)
    group.updated_at = utc_now()


def recompute_channels_for_group(
    session: Session,
    group_id: str,
    *,
    previous_interval_minutes: int | None = None,
    previous_expected_posts: int | None = None,
) -> int:
    # Reached through the follows since ticket 22, which is where the group id
    # lives now. The Channels are still what gets recomputed — the two sync
    # deadlines are columns on `tg_channels`, shared by every follower.
    from app.services.follows import channels_in_group

    channels = channels_in_group(session, group_id)
    if not channels:
        return 0
    group = session.get(ChannelSettingGroup, group_id)
    if not group:
        return 0

    if previous_interval_minutes is None:
        previous_interval_minutes = group.auto_sync_interval_minutes
    if previous_expected_posts is None:
        previous_expected_posts = group.dynamic_sync_expected_posts

    now_ms = int(time.time() * 1000)
    for channel in channels:
        if not group.regular_sync_enabled:
            channel.next_regular_sync_at = None
        else:
            recompute_next_regular_sync_at_on_interval_change(
                channel,
                previous_interval_minutes=previous_interval_minutes,
                now_ms=now_ms,
                regular_sync_enabled=group.regular_sync_enabled,
                auto_sync_interval_minutes=group.auto_sync_interval_minutes,
            )
        if not group.dynamic_sync_enabled:
            channel.next_dynamic_sync_at = None
        else:
            recompute_next_dynamic_sync_at_on_expected_posts_change(
                session,
                channel,
                previous_expected_posts=previous_expected_posts,
                now_ms=now_ms,
                dynamic_sync_enabled=group.dynamic_sync_enabled,
                dynamic_sync_expected_posts=group.dynamic_sync_expected_posts,
            )
        channel.updated_at = utc_now()
        session.add(channel)
    return len(channels)


def _legacy_reserved_duplicates_exist(session: Session, *, user_id: uuid.UUID) -> bool:
    canonical_frozen = frozen_group_id_for_user(user_id)
    canonical_restricted = restricted_group_id_for_user(user_id)
    duplicate = session.exec(
        select(ChannelSettingGroup.id)
        .where(
            _name_collision_scope_filter(user_id),
            or_(
                cast(
                    ColumnElement[bool],
                    (ChannelSettingGroup.name == FROZEN_GROUP_NAME)
                    & (ChannelSettingGroup.id != canonical_frozen),
                ),
                cast(
                    ColumnElement[bool],
                    (ChannelSettingGroup.name == RESTRICTED_GROUP_NAME)
                    & (ChannelSettingGroup.id != canonical_restricted),
                ),
            ),
        )
        .limit(1)
    ).first()
    return duplicate is not None


def _referenced_group_ids(session: Session, *, user_id: uuid.UUID) -> set[str]:
    """Group ids named by `user_id`'s own follows.

    The orphan rescue behind `list_setting_groups`: a follow can name a group
    the caller does not own, because before ticket 22 the follow copied its
    group id off a Channel filed under whoever scraped the handle first.
    Dropping that group from the list leaves the channel showing a policy the
    settings screen cannot explain, so it is added back.

    This replaces `operator.distinct_operator_setting_group_ids`, which
    hand-rolled `Channel.user_id == me OR IS NULL`, and then a `scoped_select`
    over `Channel.setting_group_id` — a column ticket 22 dropped. The follow
    table is where the id lives now, and reading it directly needs no seam:
    `(user_id, channel_id)` is the primary key, so filtering on the owner is
    identity rather than visibility, which is ticket 30's rule.
    """
    from app.services.follows import group_ids_for_user

    return group_ids_for_user(session, user_id=user_id)


def list_setting_groups(
    session: Session, *, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """The groups `user_id` may see (ticket 35).

    This is the one adoption in the programme that **changes a response while
    the flag is off**, and it does so deliberately. The filter it replaces was
    `user_id == me OR user_id IS NULL`, which narrowed in *both* states — the
    thing the seam's batches are forbidden to do, and the reason every other
    read path could adopt the seam without moving a response. Keeping it would
    have left a fifth NULL rule for ticket 21 to reconcile against four that
    already disagree with it. Ticket 17 made the same call on `/data/artifacts`
    for the same reason: a single-operator deployment has one account, so the
    widening is invisible where it ships and the rule gets simpler where it does
    not.

    `user_id` is required and not nullable. `None` used to mean "the global
    scope", which is precisely the meaning the seam refuses to invent.
    """
    ensure_builtin_groups(session, user_id=user_id)
    if _legacy_reserved_duplicates_exist(session, user_id=user_id):
        consolidate_legacy_duplicate_reserved_groups(session, user_id=user_id)
    # ensure_builtin_groups uses flush(); session.new is empty afterward, so always
    # commit so built-in rows survive when the request-scoped session closes.
    session.commit()

    groups = list(
        session.exec(
            scoped_select(select(ChannelSettingGroup), ChannelSettingGroup, user_id)
        ).all()
    )
    known_ids = {group.id for group in groups}
    orphan_ids = _referenced_group_ids(session, user_id=user_id) - known_ids
    if orphan_ids:
        extra_groups = session.exec(
            select(ChannelSettingGroup).where(
                col(ChannelSettingGroup.id).in_(orphan_ids)
            )
        ).all()
        groups.extend(extra_groups)

    counts = channel_counts_by_group(session)
    groups.sort(key=_group_sort_key)
    return [
        setting_group_to_camel(group, channel_count=counts.get(group.id, 0))
        for group in groups
    ]


def create_setting_group(
    session: Session,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Create a custom group owned by `user_id`.

    The owner is non-optional for the reason the five constructors above are:
    ticket 21 makes `tg_channel_setting_groups.user_id` `NOT NULL`, so `None`
    stopped being "the global scope" and started being an `IntegrityError`. Its
    one caller is a route with a `CurrentUser` in hand and always passed one —
    this narrows the signature to the only value it ever receives, so a second
    caller that has no account fails at the call rather than at the insert.
    """
    normalized = normalize_body(body)
    name = str(normalized.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    if name.lower() in {reserved.lower() for reserved in RESERVED_GROUP_NAMES}:
        raise HTTPException(
            status_code=400,
            detail=f"Reserved group name; built-in group '{name}' already exists",
        )
    _reject_duplicate_group_name(session, name=name, user_id=user_id)

    group_id = str(uuid.uuid4())
    values = default_group_field_values()
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=name,
        is_default=False,
        **values,
    )
    apply_group_fields(group, normalized)
    session.add(group)
    session.commit()
    session.refresh(group)
    return setting_group_to_camel(group, channel_count=0)


def update_setting_group(
    session: Session,
    group_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Rewrite one group. Refuses a group that is already somebody else's.

    Found by ticket 35 while auditing the reads on this table: the route is a
    plain `CurrentUser` with no permission gate, `group_id` is client-visible,
    and there was no owner check at all — so any signed-in account could rename
    another account's group and, through `recompute_channels_for_group`, move
    `next_regular_sync_at` on every channel in it.

    `assert_owner_on_write` rather than `assert_owner`: this is a write, so it
    is not gated on the flag. Ticket 31 found nine by-id writes sitting on the
    gated guard and still clobbering foreign rows on the shipping config.
    """
    group = session.get(ChannelSettingGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Setting group not found")
    assert_owner_on_write(group.user_id, user_id, detail="Setting group not found")

    previous_interval_minutes = group.auto_sync_interval_minutes
    previous_expected_posts = group.dynamic_sync_expected_posts
    normalized = normalize_body(body)
    if "name" in normalized:
        proposed_name = str(normalized["name"]).strip()
        if proposed_name and proposed_name.lower() != group.name.lower():
            _reject_duplicate_group_name(
                session,
                name=proposed_name,
                user_id=group.user_id,
                exclude_id=group.id,
            )
    apply_group_fields(group, body)
    session.add(group)
    session.commit()
    recompute_channels_for_group(
        session,
        group_id,
        previous_interval_minutes=previous_interval_minutes,
        previous_expected_posts=previous_expected_posts,
    )
    session.commit()
    counts = channel_counts_by_group(session)
    session.refresh(group)
    return setting_group_to_camel(group, channel_count=counts.get(group.id, 0))


def delete_setting_group(
    session: Session, group_id: str, *, user_id: uuid.UUID
) -> dict[str, str]:
    """Delete one group. Refuses one that is already somebody else's.

    The owner check goes **before** the built-in and channel-count refusals, so
    a foreign group answers the same 404 whether or not it is deletable —
    otherwise the 400s would confirm its existence and the oracle the 404 closes
    would move into the payload.
    """
    group = session.get(ChannelSettingGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Setting group not found")
    assert_owner_on_write(group.user_id, user_id, detail="Setting group not found")
    if group.is_default:
        raise HTTPException(
            status_code=400,
            detail="The default setting group cannot be deleted",
        )
    if is_reserved_group_id(group_id):
        raise HTTPException(
            status_code=400,
            detail=f"The built-in '{group.name}' setting group cannot be deleted",
        )

    # Counted over follows since ticket 22: "is anything still in this group"
    # is a question about the rows that name it, and Channels stopped doing so.
    from app.services.follows import count_follows_in_group

    channel_count = count_follows_in_group(session, group_id)
    if channel_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete setting group with {channel_count} channel(s). "
                "Reassign those channels to another group via "
                "PATCH /data/channels/bulk-setting-group, then retry deletion."
            ),
        )

    session.delete(group)
    session.commit()
    return {"status": "deleted"}


def bulk_assign_setting_group(
    session: Session,
    *,
    channel_ids: list[str],
    setting_group_id: str,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Move channels onto a group. Refuses a group that is somebody else's.

    The leak here was the *read*: the target group was resolved by
    client-visible id with no owner check, and its
    `auto_sync_interval_minutes` and `dynamic_sync_expected_posts` were then
    copied onto the caller's channels — so a stranger's policy row governed your
    syncs, and the 404-for-missing made the id space walkable besides.
    """
    if not channel_ids:
        raise HTTPException(status_code=400, detail="channelIds is required")

    from app.services.follows import followed_channels_for

    group = session.get(ChannelSettingGroup, setting_group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Setting group not found")
    assert_owner_on_write(group.user_id, user_id, detail="Setting group not found")

    operator_channels = {
        channel.id: channel
        for channel, _follow in followed_channels_for(session, user_id=user_id)
    }
    missing = sorted(
        channel_id for channel_id in channel_ids if channel_id not in operator_channels
    )
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Channels not found: {', '.join(missing)}",
        )

    now_ms = int(time.time() * 1000)
    for channel_id in channel_ids:
        apply_group_to_channel(
            session, operator_channels[channel_id], group, now_ms, user_id=user_id
        )

    session.commit()
    return {"updated": len(channel_ids), "settingGroupId": setting_group_id}


def apply_group_to_channel(
    session: Session,
    channel: Channel,
    group: ChannelSettingGroup,
    now_ms: int,
    *,
    user_id: uuid.UUID,
) -> None:
    """Move one account's follow of a Channel onto `group`, and settle the
    Channel's two sync deadlines.

    **The move lands on the Follow, the deadlines on the Channel**, and ticket
    22 is what separated them. `setting_group_id` was a Channel column, so
    reassigning a group moved it for every follower of the handle; it now lives
    only on `ChannelFollow`. The two `next_*_sync_at` cursors stayed on the
    Channel, because they describe the shared backward walk rather than one
    account's preference, so this function writes to both rows.

    `user_id` is required and names whose follow moves. A caller with no follow
    for this Channel moves nothing — the deadlines are still settled, because
    they belong to the Channel and the group that decides them was resolved by
    the caller either way.

    Extracted from `bulk_assign_setting_group` in ticket 35 so the system paths
    can reach it without going through that function's owner check. **That is
    not a hole in the check**: the check exists because `bulk_assign` takes a
    *client-chosen* group id, and the callers here resolve the group from the
    follows already on the row, so there is no id for a stranger to name.
    `move_channel_to_restricted_group` is the same shape and predates this.

    Clearing the deadlines is the part worth keeping together with the move:
    a channel parked in Frozen with `next_regular_sync_at` still set stays in
    the scheduler's due list and syncs anyway.
    """
    from app.services.follows import get_follow

    follow = get_follow(session, user_id=user_id, channel_id=channel.id)
    if follow is not None:
        follow.setting_group_id = group.id
        follow.updated_at = utc_now()
        session.add(follow)
    if not group.regular_sync_enabled:
        channel.next_regular_sync_at = None
    else:
        recompute_next_regular_sync_at_on_interval_change(
            channel,
            previous_interval_minutes=group.auto_sync_interval_minutes,
            now_ms=now_ms,
            regular_sync_enabled=group.regular_sync_enabled,
            auto_sync_interval_minutes=group.auto_sync_interval_minutes,
        )
    if not group.dynamic_sync_enabled:
        channel.next_dynamic_sync_at = None
    else:
        recompute_next_dynamic_sync_at_on_expected_posts_change(
            session,
            channel,
            previous_expected_posts=group.dynamic_sync_expected_posts,
            now_ms=now_ms,
            dynamic_sync_enabled=group.dynamic_sync_enabled,
            dynamic_sync_expected_posts=group.dynamic_sync_expected_posts,
        )
    channel.updated_at = utc_now()
    session.add(channel)


def move_channel_to_restricted_group(
    session: Session,
    channel: Channel,
    *,
    user_id: uuid.UUID,
) -> ChannelSettingGroup:
    # See `move_channel_from_restricted_to_default`: the `or channel.user_id`
    # this replaces was reachable only through a None `user_id`, which is the
    # thing ticket 21 removed.
    #
    # Ticket 22: the group lands on the follow, not the Channel. Freezing a
    # handle is one account's judgement about its own list, and on the Channel
    # it froze the handle for every follower.
    group = get_or_create_restricted_group(session, user_id=user_id)
    from app.services.follows import get_follow

    follow = get_follow(session, user_id=user_id, channel_id=channel.id)
    if follow is not None:
        follow.setting_group_id = group.id
        follow.updated_at = utc_now()
        session.add(follow)
    channel.updated_at = utc_now()
    session.add(channel)
    return group


def update_default_group_sync_settings(
    session: Session,
    *,
    user_id: uuid.UUID,
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

    group = ensure_default_group(session, user_id=user_id)
    previous_interval_minutes = group.auto_sync_interval_minutes
    previous_expected_posts = group.dynamic_sync_expected_posts
    patch: dict[str, Any] = {}
    if regular_sync_enabled is not None:
        patch["regular_sync_enabled"] = regular_sync_enabled
    if dynamic_sync_enabled is not None:
        patch["dynamic_sync_enabled"] = dynamic_sync_enabled
    if auto_sync_interval_minutes is not None:
        patch["auto_sync_interval_minutes"] = max(1, auto_sync_interval_minutes)
    if dynamic_sync_expected_posts is not None:
        patch["dynamic_sync_expected_posts"] = max(1, dynamic_sync_expected_posts)
    apply_group_fields(group, patch)
    session.add(group)
    session.commit()
    updated = recompute_channels_for_group(
        session,
        group.id,
        previous_interval_minutes=previous_interval_minutes,
        previous_expected_posts=previous_expected_posts,
    )
    session.commit()
    return {"updated": updated}


def release_groups_of_deleted_account(session: Session, user_id: uuid.UUID) -> int:
    """Repoint everything naming `user_id`'s groups, before the account goes.

    **Call this before `session.delete(user)`, not after.** Ticket 21 gave
    `tg_channel_setting_groups.user_id` a real `ON DELETE CASCADE` key, so
    deleting an account now takes its setting groups with it — and
    `tg_channel_follows.setting_group_id` is a plain string with no foreign key
    of its own. Nothing repoints it, so it is left naming a row that is gone.

    That is reachable without an Admin. Auto-follow files a Channel under
    whoever scraped the handle first, and before ticket 22 the follow copied
    that Channel's group id — so account A's group could be named by account B's
    own follow row. When A deletes itself through `DELETE /users/me`, B's
    channel starts answering **500** from `get_group_for_channel`, is silently
    skipped by `auto_sync`, and has its reset refused by `bulk_channels` — the
    three consequences `load_groups_by_id`'s docstring already enumerates for a
    group that will not resolve.

    The migration knew: `_GROUP_REFERENCES` repoints these columns before it
    deletes a merged group. This is that rule at runtime, which is where it was
    missing.

    **A follow goes to its own owner's default**, because a follow's group is
    that account's policy and naming somebody else's was drift from the copy
    above.

    **There is no Channel half any more.** Ticket 22 dropped
    `tg_channels.setting_group_id`, so a Channel names no group and cannot be
    left pointing at a deleted one. The loop that repointed Channels to a
    surviving follower's default went with the column: every remaining follower
    already carries their own group id, which is the answer that loop was
    approximating.

    Returns the number of rows repointed, so a caller can log it.
    """
    doomed = {
        group.id
        for group in session.exec(
            select(ChannelSettingGroup).where(ChannelSettingGroup.user_id == user_id)
        ).all()
    }
    if not doomed:
        return 0

    from app.services.follows import repoint_follows_off_groups

    def _default_group_id(owner: uuid.UUID) -> str:
        return ensure_default_group(session, user_id=owner).id

    # Delegated rather than written here: `follows.py` is the only writer of
    # `tg_channel_follows`, which `test_channel_creation_paths.py` enforces.
    repointed = repoint_follows_off_groups(
        session,
        doomed,
        except_user_id=user_id,
        group_for=_default_group_id,
    )
    session.flush()
    return repointed
