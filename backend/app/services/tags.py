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
