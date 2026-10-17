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

import time
import uuid
from collections.abc import Iterable
from typing import Any, cast

from sqlalchemy import Select, Uuid, literal
from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select
from sqlalchemy import update as sa_update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, select
from sqlmodel.sql.expression import SelectOfScalar

from app.models_tg import Tag
from app.services.channel_tags import (
    ChannelTag,
    TagSource,
    group_tag_name,
    is_group_tag,
    normalize_channel_tags,
    tag_key,
)
from app.services.follows import followed_handles_by_group
from app.services.telegram_web import normalize_handle
from app.services.tenancy import subject_select


def _mine(user_id: uuid.UUID) -> SelectOfScalar[Tag]:
    """`user_id`'s Tag rows, in either flag state.

    Through `subject_select`, the seam's ungated twin of `scoped_select`: these
    are the caller's own rows by key, and a flag may gate visibility, never
    identity. Every read here starts from this.
    """
    return subject_select(select(Tag), Tag, user_id)


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

    `handles=None` is every handle the Account has tagged.
    """
    statement = _mine(user_id)
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
# every statement is keyed by `user_id` (each read through `subject_select`), so
# another Account's rows are out of reach in both flag states by construction
# rather than by a check.


def tag_counts(session: Session, *, user_id: uuid.UUID) -> list[tuple[str, int]]:
    """Each of `user_id`'s Tags with how many Channels carry it, by name.

    A Tag is shown as first written: the spelling on its oldest row. Each
    Setting group the Account follows Channels in is a `group:` Tag here too.
    """
    rows = session.exec(
        _mine(user_id).order_by(col(Tag.assigned_at), col(Tag.handle))
    ).all()
    names: dict[str, str] = {}
    counts: dict[str, int] = {}
    pairs = [(row.tag_key, row.name) for row in rows] + [
        (tag_key(name), name) for name, _ in _group_tags(session, user_id=user_id)
    ]
    for key, name in pairs:
        names.setdefault(key, name)
        counts[key] = counts.get(key, 0) + 1
    return sorted(
        ((names[key], counts[key]) for key in names), key=lambda t: t[0].lower()
    )


def handles_for_tag(session: Session, *, user_id: uuid.UUID, name: str) -> list[str]:
    """The handles `user_id` put `name` on, sorted; none for a Tag they lack.

    A `group:` name is derived, never stored: the Account's followed Channels
    in the Setting group of that name, as the Channels tab shows it.
    """
    key = tag_key(name)
    if is_group_tag(name):
        return sorted(
            {
                handle
                for group, handle in _group_tags(session, user_id=user_id)
                if tag_key(group) == key
            }
        )
    return [
        row.handle
        for row in session.exec(
            _mine(user_id).where(col(Tag.tag_key) == key).order_by(col(Tag.handle))
        ).all()
    ]


def tag_names_by_handle(
    session: Session, *, user_id: uuid.UUID, handles: Iterable[str]
) -> dict[str, list[str]]:
    """The Tag names a Directory row shows, keyed by normalized handle.

    `user_id`'s stored Tags, oldest first, then the `group:` Tag of the Setting
    group a followed Channel is filed under (story 23).
    """
    keys = {normalize_handle(handle) for handle in handles}
    found = tags_by_handle(session, user_id=user_id, handles=keys)
    names = {handle: [t["name"] for t in tags] for handle, tags in found.items()}
    for group, handle in _group_tags(session, user_id=user_id):
        if handle in keys:
            names.setdefault(handle, []).append(group)
    return names


def _group_tags(session: Session, *, user_id: uuid.UUID) -> list[tuple[str, str]]:
    """`(group: Tag name, handle)` for each Channel `user_id` follows."""
    return [
        (group_tag_name(group), handle)
        for group, handle in followed_handles_by_group(session, user_id=user_id)
    ]


def assign_tag(
    session: Session,
    *,
    user_id: uuid.UUID,
    name: str,
    handles: Iterable[str] | Select[tuple[str]],
) -> int:
    """Put `name` on every handle, followed or not; returns how many it was new on.

    A handle already carrying the Tag keeps its row, spelling and time; a new
    row is stamped now. `handles` may be a statement of handles (a Directory
    view's matches, ADR-031), written in one `INSERT … SELECT`.
    """
    assigned_at = int(time.time() * 1000)
    if isinstance(handles, Select):
        found = handles.subquery()
        rows = sa_select(
            literal(user_id, Uuid()),
            found.c.handle,
            literal(tag_key(name)),
            literal(name),
            literal("manual"),
            literal(assigned_at),
        )
        columns = ["user_id", "handle", "tag_key", "name", "source", "assigned_at"]
        inserted = session.execute(
            pg_insert(Tag)
            .from_select(columns, rows)
            .on_conflict_do_nothing()
            .returning(col(Tag.handle))
        )
        return len(inserted.all())
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
    session: Session,
    *,
    user_id: uuid.UUID,
    name: str,
    handles: Iterable[str] | Select[tuple[str]],
) -> int:
    """Take `name` off every handle; returns how many carried it. `handles` may
    be a statement of handles, as `assign_tag` takes."""
    keys = (
        handles
        if isinstance(handles, Select)
        else {normalize_handle(h) for h in handles} - {""}
    )
    if not isinstance(keys, Select) and not keys:
        return 0
    removed = session.execute(
        sa_delete(Tag).where(
            col(Tag.user_id) == user_id,
            col(Tag.tag_key) == tag_key(name),
            col(Tag.handle).in_(keys),
        )
    )
    return int(cast(Any, removed).rowcount)


def rename_tag(
    session: Session, *, user_id: uuid.UUID, name: str, to: str
) -> tuple[str, int] | None:
    """Rename `name` to `to` on every Channel; the surviving name and how many
    carry it after, or `None` for a Tag the Account lacks (a `group:` one too).

    Renaming onto a Tag the Account already has merges the two: a Channel
    carrying both keeps one row, the target's, and every row ends with the
    target's first-written spelling. With no target, `to` as typed. A change
    of case only respells.
    """
    if is_group_tag(name) or not handles_for_tag(session, user_id=user_id, name=name):
        return None
    old, new = tag_key(name), tag_key(to)
    spelling = to.strip()
    if old != new:
        target = _mine(user_id).where(col(Tag.tag_key) == new)
        first = session.exec(
            target.order_by(col(Tag.assigned_at), col(Tag.handle)).limit(1)
        ).first()
        if first is not None:
            spelling = first.name
        session.execute(
            sa_delete(Tag).where(
                col(Tag.user_id) == user_id,
                col(Tag.tag_key) == old,
                col(Tag.handle).in_(target.with_only_columns(col(Tag.handle))),
            )
        )
    session.execute(
        sa_update(Tag)
        .where(col(Tag.user_id) == user_id, col(Tag.tag_key).in_({old, new}))
        .values(tag_key=new, name=spelling)
    )
    return spelling, len(handles_for_tag(session, user_id=user_id, name=spelling))


def delete_tag(session: Session, *, user_id: uuid.UUID, name: str) -> int | None:
    """Take `name` off every Channel; how many carried it, or `None` for a Tag
    the Account lacks (a `group:` one too)."""
    if is_group_tag(name):
        return None
    removed = len(handles_for_tag(session, user_id=user_id, name=name))
    if not removed:
        return None
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
            _mine(user_id).where(col(Tag.tag_key) == key, col(Tag.handle).in_(handles))
        ).all()
    )
