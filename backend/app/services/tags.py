"""The Tag aggregate: sole writer of `tg_tags` (ADR-029, DFP-03).

A Tag belongs to the Account and sits on a Channel's normalized handle, so it
outlives the Follow: `follows.remove_follow` never reaches this table, and a
refollow finds the rows where it left them. The wire shape is the one the JSON
column on the Follow had (`{name, source, assignedAt}` per Tag), built by
`channel_tags.normalize_channel_tags`, so every reader keeps its contract.

Names keep today's rules: trimmed, compared case-insensitively, shown as first
written, no length cap. `group:` names are reserved and derived from Setting
groups, never stored; `channel_tags.reject_reserved_virtual_group_tags` refuses
them before anything here runs.

No function commits. The caller owns the transaction, matching `follows.py`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete as sa_delete
from sqlalchemy import update as sa_update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, select

from app.models_tg import Tag
from app.services.channel_tags import ChannelTag, TagSource, normalize_channel_tags
from app.services.telegram_web import normalize_handle


def tag_to_camel(row: Tag) -> dict[str, Any]:
    """One Tag row as the export carries it."""
    return {
        "handle": row.handle,
        "name": row.name,
        "source": row.source,
        "assignedAt": row.assigned_at,
    }


def _as_channel_tag(row: Tag) -> ChannelTag:
    source: TagSource = "ai" if row.source == "ai" else "manual"
    return {"name": row.name, "source": source, "assignedAt": row.assigned_at}


def tags_by_handle(
    session: Session, *, user_id: uuid.UUID, handles: Iterable[str] | None = None
) -> dict[str, list[ChannelTag]]:
    """`user_id`'s Tags, keyed by normalized handle, oldest first.

    `handles=None` is every handle the Account has tagged. Filtering on the
    owner directly rather than through `scoped_select`: these are the caller's
    own rows by key, and a flag may gate visibility, never identity.
    """
    statement = select(Tag).where(col(Tag.user_id) == user_id)
    if handles is not None:
        keys = {normalize_handle(handle) for handle in handles}
        if not keys:
            return {}
        statement = statement.where(col(Tag.handle).in_(keys))
    rows = session.exec(
        statement.order_by(col(Tag.assigned_at), col(Tag.tag_key))
    ).all()
    result: dict[str, list[ChannelTag]] = {}
    for row in rows:
        result.setdefault(row.handle, []).append(_as_channel_tag(row))
    return result


def tags_for_channel(
    session: Session, *, user_id: uuid.UUID, handle: str
) -> list[ChannelTag]:
    return tags_by_handle(session, user_id=user_id, handles=[handle]).get(
        normalize_handle(handle), []
    )


def replace_channel_tags(
    session: Session, *, user_id: uuid.UUID, handle: str, tags: Any
) -> None:
    """Make `tags` the whole of `user_id`'s Tags on `handle`.

    What `PUT /data/channels/{id}` and the bulk Tag route mean by a Tag list,
    exactly as the JSON column did: the list replaces the set. Duplicates by
    case collapse to the first, which is "the name as first written".
    """
    key = normalize_handle(handle)
    session.execute(
        sa_delete(Tag).where(col(Tag.user_id) == user_id, col(Tag.handle) == key)
    )
    add_tags(
        session,
        user_id=user_id,
        rows=[{"handle": key, **tag} for tag in normalize_channel_tags(tags)],
    )


def add_tags(
    session: Session, *, user_id: uuid.UUID, rows: Iterable[dict[str, Any]]
) -> int:
    """Insert Tags for `user_id`; a Tag the Channel already has keeps its row.

    `rows` carry `handle` plus a Tag in any shape `normalize_channel_tags`
    accepts. The owner is always `user_id`, never a value from the rows, so an
    import stamps the subject rather than the document.
    """
    values: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        handle = normalize_handle(str(row.get("handle") or ""))
        if not handle:
            continue
        for tag in normalize_channel_tags([row]):
            values.setdefault(
                (handle, tag["name"].lower()),
                {
                    "user_id": user_id,
                    "handle": handle,
                    "tag_key": tag["name"].lower(),
                    "name": tag["name"],
                    "source": tag["source"],
                    "assigned_at": tag["assignedAt"],
                },
            )
    if not values:
        return 0
    session.execute(
        pg_insert(Tag).values(list(values.values())).on_conflict_do_nothing()
    )
    return len(values)


# ---- The Account's Tags as a whole (DFP-04) -------------------------------------
#
# What the Directory's Tag routes do: a Tag is named, never addressed by id, and
# every statement is keyed by `user_id`, so another Account's rows are out of
# reach in both flag states by construction rather than by a check.


def tag_key(name: str) -> str:
    """The case-folded key `name` is stored under; "" for a blank name."""
    return name.strip().lower()


def is_group_tag(name: str) -> bool:
    return tag_key(name).startswith("group:")


def tag_counts(session: Session, *, user_id: uuid.UUID) -> list[tuple[str, int]]:
    """Each of `user_id`'s Tags with how many Channels carry it, by name.

    A Tag is shown as first written: the spelling on its oldest row.
    """
    rows = session.exec(
        select(Tag)
        .where(col(Tag.user_id) == user_id)
        .order_by(col(Tag.assigned_at), col(Tag.handle))
    ).all()
    names: dict[str, str] = {}
    counts: dict[str, int] = {}
    for row in rows:
        names.setdefault(row.tag_key, row.name)
        counts[row.tag_key] = counts.get(row.tag_key, 0) + 1
    return sorted(
        ((names[key], counts[key]) for key in names), key=lambda t: t[0].lower()
    )


def handles_for_tag(session: Session, *, user_id: uuid.UUID, name: str) -> list[str]:
    """The handles `user_id` put `name` on, sorted; none for a Tag they lack.

    A `group:` name is derived, never stored: the Account's followed Channels
    in the Setting group of that name, as the Channels tab shows it.
    """
    if is_group_tag(name):
        return _group_tag_handles(session, user_id=user_id, name=name)
    return [
        str(handle)
        for handle in session.exec(
            select(Tag.handle)
            .where(col(Tag.user_id) == user_id, col(Tag.tag_key) == tag_key(name))
            .order_by(col(Tag.handle))
        ).all()
    ]


def _group_tag_handles(session: Session, *, user_id: uuid.UUID, name: str) -> list[str]:
    from app.services.channel_setting_groups import load_groups_by_id
    from app.services.follows import followed_channels_for

    group = tag_key(name).removeprefix("group:").strip()
    groups = load_groups_by_id(session)
    return sorted(
        normalize_handle(channel.name)
        for channel, follow in followed_channels_for(session, user_id=user_id)
        if follow.setting_group_id in groups
        and groups[follow.setting_group_id].name.strip().lower() == group
    )


def assign_tag(
    session: Session,
    *,
    user_id: uuid.UUID,
    name: str,
    handles: Iterable[str],
    assigned_at: int,
) -> int:
    """Put `name` on every handle, followed or not; returns how many it was new on.

    A handle already carrying the Tag keeps its row, spelling and time.
    """
    keys = {normalize_handle(h) for h in handles} - {""}
    before = _carrying(session, user_id=user_id, key=tag_key(name), handles=keys)
    add_tags(
        session,
        user_id=user_id,
        rows=[
            {"handle": h, "name": name, "source": "manual", "assignedAt": assigned_at}
            for h in keys
        ],
    )
    return len(keys) - before


def unassign_tag(
    session: Session, *, user_id: uuid.UUID, name: str, handles: Iterable[str]
) -> int:
    """Take `name` off every handle; returns how many carried it."""
    keys = {normalize_handle(h) for h in handles} - {""}
    if not keys:
        return 0
    removed = _carrying(session, user_id=user_id, key=tag_key(name), handles=keys)
    session.execute(
        sa_delete(Tag).where(
            col(Tag.user_id) == user_id,
            col(Tag.tag_key) == tag_key(name),
            col(Tag.handle).in_(keys),
        )
    )
    return removed


def rename_tag(session: Session, *, user_id: uuid.UUID, name: str, to: str) -> int:
    """Rename `name` to `to` on every Channel; returns how many carry `to` after.

    Renaming onto a Tag the Account already has merges the two: a Channel
    carrying both keeps one row, the target's. A change of case only respells.
    """
    old, new = tag_key(name), tag_key(to)
    if old != new:
        target = select(Tag.handle).where(
            col(Tag.user_id) == user_id, col(Tag.tag_key) == new
        )
        session.execute(
            sa_delete(Tag).where(
                col(Tag.user_id) == user_id,
                col(Tag.tag_key) == old,
                col(Tag.handle).in_(target),
            )
        )
    session.execute(
        sa_update(Tag)
        .where(col(Tag.user_id) == user_id, col(Tag.tag_key) == old)
        .values(tag_key=new, name=to.strip())
    )
    return len(handles_for_tag(session, user_id=user_id, name=to))


def delete_tag(session: Session, *, user_id: uuid.UUID, name: str) -> int:
    """Take `name` off every Channel; returns how many carried it."""
    removed = len(handles_for_tag(session, user_id=user_id, name=name))
    session.execute(
        sa_delete(Tag).where(
            col(Tag.user_id) == user_id, col(Tag.tag_key) == tag_key(name)
        )
    )
    return removed


def _carrying(
    session: Session, *, user_id: uuid.UUID, key: str, handles: set[str]
) -> int:
    if not handles:
        return 0
    return len(
        session.exec(
            select(Tag.handle).where(
                col(Tag.user_id) == user_id,
                col(Tag.tag_key) == key,
                col(Tag.handle).in_(handles),
            )
        ).all()
    )
