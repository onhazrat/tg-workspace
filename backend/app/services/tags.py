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
from typing import Any, cast

from sqlalchemy import BigInteger, Float, Select, Uuid, func, literal
from sqlalchemy import cast as cast_
from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select
from sqlalchemy import update as sa_update
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, select
from sqlmodel.sql.expression import SelectOfScalar

from app.models_tg import Tag, TagUse
from app.services.analysis_window import server_now_ms
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
    removed = session.execute(
        sa_delete(Tag)
        .where(col(Tag.user_id) == user_id, col(Tag.handle) == key)
        .returning(col(Tag.tag_key))
    )
    old_keys = set(removed.scalars().all())
    add_tags(
        session,
        user_id=user_id,
        rows=[{"handle": key, **tag} for tag in normalize_channel_tags(tags)],
    )
    _end_uses(session, user_id=user_id, keys=old_keys)


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
    assigned_at = server_now_ms()
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
    _end_uses(session, user_id=user_id, keys={tag_key(name)})
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
    if old != new:
        _move_uses(session, user_id=user_id, old=old, new=new)
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
    _end_uses(session, user_id=user_id, keys={tag_key(name)})
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


# ---- Tag uses (TGU-02, ADR-042) ---------------------------------------------
#
# `tg_tag_uses` is this aggregate's companion table: each row is one use of a
# Tag on a tab. A rename moves them and the Tag's end deletes them, both in the
# same write as the Tag rows, so a later Tag of the same name starts with none.

#: A use counts 1 now, 0.5 after 14 days, 0.25 after 28.
HALF_LIFE_MS = 14 * 86_400_000
#: The newest uses kept per Account, tab and Tag. Bounds the table without a
#: retention job; older uses weigh under 0.1% by then.
MAX_USES = 50


def record_use(session: Session, *, user_id: uuid.UUID, tab: str, name: str) -> int:
    """Record one use of `name` on `tab`; 0 for a Tag the Account lacks.

    Keeps the `MAX_USES` newest per Account, tab and Tag. A `group:` name is
    never a stored Tag, so it records nothing.
    """
    key = tag_key(name)
    owned = _mine(user_id).where(col(Tag.tag_key) == key).exists()
    inserted = session.execute(
        pg_insert(TagUse)
        .from_select(
            ["user_id", "tab", "tag_key", "used_at"],
            sa_select(
                literal(user_id, Uuid()),
                literal(tab),
                literal(key),
                literal(server_now_ms(), BigInteger()),
            ).where(owned),
        )
        .on_conflict_do_nothing()
        .returning(col(TagUse.used_at))
    ).all()
    mine = (
        col(TagUse.user_id) == user_id,
        col(TagUse.tab) == tab,
        col(TagUse.tag_key) == key,
    )
    oldest_kept = (
        sa_select(col(TagUse.used_at))
        .where(*mine)
        .order_by(col(TagUse.used_at).desc())
        .offset(MAX_USES - 1)
        .limit(1)
        .scalar_subquery()
    )
    session.execute(sa_delete(TagUse).where(*mine, col(TagUse.used_at) < oldest_kept))
    return len(inserted)


def _move_uses(session: Session, *, user_id: uuid.UUID, old: str, new: str) -> None:
    """A rename's uses, on every tab, become `new`'s; a merge adds them."""
    moved = sa_select(
        col(TagUse.user_id), col(TagUse.tab), literal(new), col(TagUse.used_at)
    ).where(col(TagUse.user_id) == user_id, col(TagUse.tag_key) == old)
    session.execute(
        pg_insert(TagUse)
        .from_select(["user_id", "tab", "tag_key", "used_at"], moved)
        .on_conflict_do_nothing()
    )
    _end_uses(session, user_id=user_id, keys={old})


def _end_uses(session: Session, *, user_id: uuid.UUID, keys: set[str]) -> None:
    """Delete the uses of each of `keys` no Channel carries any more."""
    if not keys:
        return
    carried = _mine(user_id).where(col(Tag.tag_key) == col(TagUse.tag_key)).exists()
    session.execute(
        sa_delete(TagUse).where(
            col(TagUse.user_id) == user_id,
            col(TagUse.tag_key).in_(keys),
            ~carried,
        )
    )


TagOrderRow = tuple[str, int, int, float, int | None]


def tag_order(
    session: Session,
    *,
    user_id: uuid.UUID,
    tab: str,
    scope: list[str] | None,
    selected: list[str],
) -> list[TagOrderRow]:
    """Each of `user_id`'s Tags, by name: its channels in `scope` (`None` is
    every Channel), how many of those are in `selected`, its Tag use score on
    `tab` and its last use there. One statement; Setting groups are not Tags.
    """
    in_scope = (
        literal(True)
        if scope is None
        else col(Tag.handle).in_({normalize_handle(h) for h in scope})
    )
    picked = col(Tag.handle).in_({normalize_handle(h) for h in selected})
    age = cast_(literal(server_now_ms(), BigInteger()) - col(TagUse.used_at), Float)
    uses = (
        subject_select(
            sa_select(
                col(TagUse.tag_key),
                func.sum(func.power(0.5, age / HALF_LIFE_MS)).label("score"),
                func.max(col(TagUse.used_at)).label("last"),
            ).where(col(TagUse.tab) == tab),
            TagUse,
            user_id,
        )
        .group_by(col(TagUse.tag_key))
        .subquery()
    )
    first_name = func.array_agg(
        aggregate_order_by(col(Tag.name), col(Tag.assigned_at), col(Tag.handle))
    )[1]
    statement = (
        subject_select(
            sa_select(
                first_name,
                func.count().filter(in_scope),
                func.count().filter(in_scope & picked),
                func.coalesce(func.max(uses.c.score), 0.0),
                func.max(uses.c.last),
            )
            .select_from(Tag)
            .outerjoin(uses, uses.c.tag_key == col(Tag.tag_key)),
            Tag,
            user_id,
        )
        .group_by(col(Tag.tag_key))
        .order_by(func.lower(first_name))
    )
    return [
        (name, int(count), int(chosen), float(score), last)
        for name, count, chosen, score, last in session.execute(statement).all()
    ]
