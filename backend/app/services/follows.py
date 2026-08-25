"""The Follow aggregate: sole writer of `tg_channel_follows` (ticket 04).

A Follow is the relation between a User and a Channel. The Channel and its
Posts are a shared corpus; the relation is not, which is why the per-User
columns living on `tg_channels` today move here.

**Nothing reads this table on a request path yet.** Ticket 04 creates it,
backfills it, and dual-writes it from every path that creates a Channel. The
read paths adopt the seam's `EXISTS` in tickets 15-16, and `Channel`'s copies
of these columns are dropped in ticket 22. Until then the write is additive:
`ensure_follow` never overwrites an existing row, so a channel created a second
time cannot silently reset the follower's tags or start time.

## Why the owner falls back to the operator

`Channel.user_id` is nullable, unconstrained, and therefore sometimes names an
account that no longer exists; `ChannelFollow.user_id` is a real foreign key to
`user.id`, which is the point of the table. So a creation path handed a
`user_id` nobody can be found for has to mean *something*, and there are only
two honest answers: write no follow, or write one owned by the single operator
this install has always had. The first leaves a Channel nobody follows, which is
precisely the state `audit_tenancy_drift.py` is built to report as drift — the
dual-write would be manufacturing the thing the audit looks for. So the rule is
the backfill's rule, in one place: `user_id or the first superuser`.

If there is no superuser either, no follow is written and the caller is told
so. That is a database with no accounts in it, and inventing an owner there
would put a fabricated uuid behind a foreign key.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import delete as sa_delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, func, select

from app.models import User
from app.models_tg import Channel, ChannelFollow, utc_now
from app.services.operator import get_operator_user_id
from app.services.settings_store import get_global_setting
from app.services.tenancy import scoped_select

#: Global `AppSetting` key recording that the follow backfill ran to completion.
#:
#: Lives here rather than in `scripts/backfill_channel_follows.py` because two
#: unrelated callers need the same answer and `app/` cannot import from
#: `scripts/`: the script sets it, and ticket 05's retention collection refuses
#: to run until it is set. The script's own comment argues why the marker is a
#: one-shot record rather than the obvious "are there channels with no follow?"
#: test — that question is correct until unfollow exists and a data-loss bug
#: immediately after.
FOLLOWS_BACKFILL_KEY = "follows_backfill"


def follows_backfilled(session: Session) -> bool:
    """Whether `tg_channel_follows` is authoritative yet. One PK lookup.

    Until the backfill has recorded completion, an empty or partial follow
    table means "nobody has written these rows yet", not "nobody follows these
    channels". Those two readings are indistinguishable from the table alone
    and have opposite consequences: the first is a database mid-upgrade, the
    second is retention's queue. Anything that *deletes* on the strength of a
    missing follow has to check this first.
    """
    return bool(get_global_setting(session, FOLLOWS_BACKFILL_KEY).get("completedAt"))


def resolve_follow_owner(
    session: Session,
    user_id: uuid.UUID | None,
) -> uuid.UUID | None:
    """Who owns a follow created for `user_id`, falling back to the operator.

    A `user_id` that names no account is treated exactly like `None`, and the
    membership check is the reason this costs a query. The TG tables have no
    foreign key to `user.id`, so a deleted account leaves its `Channel` rows
    behind pointing at nothing — `audit_tenancy_drift.py` counts those as
    orphan owners because they are a real state, not a hypothetical one. This
    table *does* have the foreign key, so passing such an id straight through
    would raise `IntegrityError` from inside whatever transaction was creating
    the Channel. The live path for that is `sync_orchestrator.py`'s auto-follow,
    which passes `user_id or channel.user_id`: a forwarded channel picked up
    from an orphaned row would abort the whole sync job.

    Orphan and NULL are the same situation — nobody who exists owns this — so
    they get the same answer rather than one being a fallback and the other a
    crash.

    Returns `None` only when there is no first superuser to fall back to, which
    means no account exists at all. See the module docstring for why this is one
    function rather than a conditional at each call site.
    """
    if user_id is not None and session.get(User, user_id) is not None:
        return user_id
    return get_operator_user_id(session)


def ensure_follow(
    session: Session,
    *,
    channel_id: str,
    user_id: uuid.UUID | None,
    setting_group_id: str | None = None,
    followed_at: int | None = None,
    tags: list[Any] | None = None,
    start_id: int | None = None,
    start_time: int | None = None,
    discovered_via: dict[str, Any] | None = None,
    next_sync_at: int | None = None,
) -> bool:
    """Create the follow if it is not already there. Returns True if it created one.

    `ON CONFLICT DO NOTHING` rather than a read-then-write: the composite key
    already makes a duplicate impossible, and checking first would turn that
    guarantee into a race between two concurrent auto-follows of the same
    channel. Existing rows are left exactly as they are — re-creating a channel
    is not a reason to reset somebody's tags.

    Does **not** commit. The caller owns the transaction, so the follow lands
    with the Channel that necessitated it rather than in a separate one that
    can fail on its own and leave a Channel nobody follows.
    """
    owner_id = resolve_follow_owner(session, user_id)
    if owner_id is None:
        return False

    now = utc_now()
    statement = (
        pg_insert(ChannelFollow)
        .values(
            user_id=owner_id,
            channel_id=channel_id,
            setting_group_id=setting_group_id,
            followed_at=followed_at,
            tags=tags if tags is not None else [],
            start_id=start_id,
            start_time=start_time,
            discovered_via=discovered_via,
            next_sync_at=next_sync_at,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "channel_id"])
        # RETURNING rather than `rowcount`, which is the obvious version and is
        # wrong twice over here: SQLModel's `session.exec` wraps the result so
        # `rowcount` stops meaning rows affected, and even through
        # `session.execute` it does not reliably distinguish "inserted" from
        # "conflicted" for DO NOTHING. A row comes back only when one was
        # written, which is exactly the question.
        .returning(col(ChannelFollow.channel_id))
    )
    return session.execute(statement).first() is not None


def ensure_follow_for_channel(
    session: Session,
    channel: Channel,
    *,
    user_id: uuid.UUID | None = None,
) -> bool:
    """Create the follow implied by an existing Channel row.

    The per-User values are copied off the Channel, which is still the
    authoritative copy until ticket 22 drops those columns. `next_sync_at`
    starts from the Channel's regular schedule: it is the follower's own
    deadline from here on, but seeding it to `None` would make every backfilled
    follow look due immediately to the scheduler that reads it later.

    Used by both the dual-write and the backfill, so the two cannot disagree
    about what a follow copied from a Channel contains.
    """
    return ensure_follow(
        session,
        channel_id=channel.id,
        user_id=user_id if user_id is not None else channel.user_id,
        next_sync_at=channel.next_regular_sync_at,
        **_channel_field_values(channel, MIRRORED_CHANNEL_FIELDS),
    )


def remove_follow(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_id: str,
) -> bool:
    """Drop one User's follow. Returns True if a row was removed (ticket 05).

    The counterpart to `ensure_follow`, and the reason this module rather than
    `channels.py` is still the only writer of the table: removal is one row
    keyed on `(user_id, channel_id)`, and a delete that dropped the channel's
    follows instead would unfollow every account that shares the handle.

    `RETURNING` again, for the reason argued on `ensure_follow`: SQLModel's
    `session.exec` wraps the result so `rowcount` stops meaning rows affected,
    and the caller needs the difference between "your follow is gone" and "you
    never had one" to answer 404.

    Does **not** commit, matching `ensure_follow` — the caller owns the
    transaction.
    """
    statement = (
        sa_delete(ChannelFollow)
        .where(
            col(ChannelFollow.user_id) == user_id,
            col(ChannelFollow.channel_id) == channel_id,
        )
        .returning(col(ChannelFollow.channel_id))
    )
    return session.execute(statement).first() is not None


def follow_exists(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_id: str,
) -> bool:
    """Whether `user_id` follows `channel_id`. A primary-key hit."""
    return session.get(ChannelFollow, (user_id, channel_id)) is not None


def count_follows(session: Session) -> int:
    """Total follows, for the audit."""
    return session.exec(select(func.count()).select_from(ChannelFollow)).one()


def channel_ids_without_follows(session: Session) -> list[str]:
    """Channels nobody follows — retention's input, and the audit's.

    Ticket 04 read this as pure drift: with no unfollow, a Channel at zero
    followers could only mean a creation path that forgot to write one. Ticket
    05 makes it a legitimate state — the one an unfollow leaves behind — so the
    same query now feeds `collect_unfollowed_channels`, which reclaims the
    corpus nobody is holding. `audit_tenancy_drift.py` still reports the count,
    which is now a queue depth rather than an alarm.
    """
    followed = select(col(ChannelFollow.channel_id)).distinct()
    rows = session.exec(
        select(col(Channel.id)).where(col(Channel.id).notin_(followed))
    ).all()
    return list(rows)


def orphan_follow_channel_ids(session: Session) -> list[str]:
    """Follows pointing at a Channel that is gone.

    The foreign key makes this impossible, so a non-empty result means the
    constraint is missing on that database — which is worth finding out from an
    audit rather than from a query that returns rows for a channel nobody can
    open.
    """
    channels = select(col(Channel.id))
    rows = session.exec(
        select(col(ChannelFollow.channel_id))
        .where(col(ChannelFollow.channel_id).notin_(channels))
        .distinct()
    ).all()
    return list(rows)


def follows_for_channels(
    session: Session,
    channel_ids: Iterable[str],
) -> Sequence[ChannelFollow]:
    """Every follow of the given channels, in one query."""
    ids = list(channel_ids)
    if not ids:
        return []
    return session.exec(
        select(ChannelFollow).where(col(ChannelFollow.channel_id).in_(ids))
    ).all()


def follows_for_user(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_ids: Iterable[str],
) -> dict[str, ChannelFollow]:
    """One User's follows of the given channels, keyed by channel id.

    The read-side counterpart to `follows_for_channels`, which answers "who
    follows this channel" (retention's question, and the audit's); this
    answers "what does *this* user's follow of this channel say" — the
    question the channel list (ticket 15) asks once it stops reading the
    per-User fields off `Channel` itself.
    """
    ids = list(channel_ids)
    if not ids:
        return {}
    rows = session.exec(
        select(ChannelFollow).where(
            ChannelFollow.user_id == user_id,
            col(ChannelFollow.channel_id).in_(ids),
        )
    ).all()
    return {f.channel_id: f for f in rows}


def visible_channel_names(session: Session, *, user_id: uuid.UUID) -> set[str]:
    """The Channel *names* `user_id` may see, lowercased for handle comparison.

    Three call sites ask the same question of `tg_channels` and all three
    compare the answer against a handle scraped out of a post: the feed's and
    the counts' `unfollowed_forwarded` filter ("is this forward's source one of
    mine?") and Discover's `isFollowed` flag. They were three copies of
    `select(Channel.name)`, which is the shape a fourth copy gets added to
    without anyone noticing that one of them was never scoped.

    **The name says "visible", not "followed", because the two differ while the
    flag is off.** Unenforced, `scoped_select` is a no-op and this is every
    Channel in the corpus — today's behaviour, preserved exactly. Enforced, it
    is the Channels the caller Follows. Calling it `followed_channel_names`
    would make it a lie in the state it actually ships in.

    Lowercased here rather than at each call site: `discover.normalize_handle`
    lowercases every handle it extracts, so an un-lowercased name silently
    fails to match and the only symptom is a candidate the caller already
    follows being offered again.
    """
    names = session.exec(scoped_select(select(Channel.name), Channel, user_id)).all()
    return {str(name).lower() for name in names}


#: The per-User columns `ensure_follow_for_channel` copies off a Channel at
#: creation time, and the ones `sync_follow_settings` below mirrors after an
#: edit. The one place both read from, so a seventh mirrored column is a diff
#: to this tuple rather than to two call sites that would otherwise have to be
#: kept in step by memory.
MIRRORED_CHANNEL_FIELDS = (
    "setting_group_id",
    "followed_at",
    "tags",
    "start_id",
    "start_time",
    "discovered_via",
)


def _channel_field_values(channel: Channel, fields: Iterable[str]) -> dict[str, Any]:
    """`fields`' current values on `channel`.

    `tags` is copied to a fresh list rather than referenced: `Channel.tags` is
    a JSON column backed by a mutable list, and writing the same list object
    into a `ChannelFollow` row would let a later mutation of one show up on
    the other through the shared reference.
    """
    values = {field: getattr(channel, field) for field in fields}
    if "tags" in values:
        values["tags"] = list(channel.tags or [])
    return values


def sync_follow_settings(
    session: Session,
    channel: Channel,
    *,
    user_id: uuid.UUID | None,
    fields: Iterable[str] = MIRRORED_CHANNEL_FIELDS,
) -> None:
    """Mirror a just-edited Channel's per-User fields onto its owner's Follow.

    `ensure_follow`/`ensure_follow_for_channel` are additive on purpose — a
    second follower of an already-scraped channel must not have their tags
    reset by somebody else re-creating it. An explicit edit through
    `PUT /data/channels/{id}`, the bulk-tags endpoint, or an import overwriting
    an existing channel is the opposite case: the caller means for the value
    to change, `Channel` stays authoritative until ticket 22 drops these
    columns from it, so its Follow has to move with it — otherwise the channel
    list (ticket 15), which reads these fields off the Follow, would keep
    showing the value from before the edit.

    `fields` is the subset of `MIRRORED_CHANNEL_FIELDS` this particular edit
    actually touched, and only that subset is written to an *existing* Follow.
    Mirroring the full set unconditionally was the first cut here, and it was
    wrong: an edit to one field (say `bio`, which is not even mirrored) would
    still overwrite every other follower field with the Channel's current
    values, clobbering a Follow that had legitimately diverged from the
    Channel — exactly the per-User state ticket 15 exists to preserve. A
    brand-new Follow still needs the complete row, so the *insert* side always
    uses every mirrored field regardless of `fields`; only the conflict
    *update* is narrowed.

    Resolves the owner the same way `ensure_follow` does, so the two writers
    can never disagree about whose row an edit lands on. A no-op when there is
    no superuser to fall back to, matching `ensure_follow`.

    `ON CONFLICT DO UPDATE` rather than `ensure_follow`'s `DO NOTHING` — this
    is the one write path that means to overwrite an existing Follow's values.
    `next_sync_at` is seeded on insert (a fresh Follow needs a schedule) but
    never part of `fields`: it is the follower's own next-sync deadline, not
    something a Channel edit should reset.
    """
    owner_id = resolve_follow_owner(session, user_id)
    if owner_id is None:
        return

    now = utc_now()
    insert_values = _channel_field_values(channel, MIRRORED_CHANNEL_FIELDS)
    update_values = _channel_field_values(channel, fields)

    statement = (
        pg_insert(ChannelFollow)
        .values(
            user_id=owner_id,
            channel_id=channel.id,
            next_sync_at=channel.next_regular_sync_at,
            created_at=now,
            updated_at=now,
            **insert_values,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "channel_id"],
            set_={**update_values, "updated_at": now},
        )
    )
    session.execute(statement)
