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
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from sqlalchemy import delete as sa_delete
from sqlalchemy import distinct
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, func, select

from app.core.config import settings
from app.models import User
from app.models_tg import Channel, ChannelFollow, utc_now
from app.services.channel_tags import (
    normalize_channel_tags,
    reject_reserved_virtual_group_tags,
)
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


def get_operator_user_id(session: Session) -> uuid.UUID | None:
    """The bootstrap superuser's id, or None when no such account exists.

    Moved here from `services/operator.py` when ticket 21 deleted that module.
    It is not the Mode-A helper that went with it: `select_operator_channels`
    answered "what may this account see" with a `Channel.user_id == operator OR
    NULL` filter, which is a read-scoping question the tenancy seam now owns.
    This answers "which account do I stamp on a row whose caller named nobody",
    which is a write-time question that survives enforcement — and it lives
    beside `resolve_follow_owner`, its only real consumer, so the rule and its
    fallback cannot drift apart.

    Four migrations state that they resolve a missing owner "matching
    `services/operator.get_operator_user_id`" — `c0d1e2f3a4b5` (ticket 34),
    `d7e8f9a0b1c2` (06), `f7a8b9c0d1e2` (30) and `e6f7a8b9c0d1` (20). They
    hardcode the rule rather than importing it, deliberately, so this move does
    not break them; the name is kept so those references still find something.
    """
    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    return user.id if user else None


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
    user_id: uuid.UUID | None,
    values: Mapping[str, Any] | None = None,
) -> bool:
    """Create the follow implied by an existing Channel row.

    `values` carries this follower's own per-User fields; anything it does not
    name gets the empty default. Ticket 04 copied them off the Channel instead,
    and ticket 22 dropped the Channel's copies, so there is nothing left to copy
    — the caller is now the only one who knows what this follower chose.

    **That is a fix, not only a mechanical change.** `setting_group_id` has to
    come from the *following* account's own groups, and copying it off the
    Channel handed the second follower of a handle whichever group the first
    follower happened to pick, including a group belonging to another account.
    A caller with nothing to say gets a follow with unset fields, which is the
    honest row: `schedule_group_id` reports "no resolvable group" and the
    scheduler skips the channel, rather than scheduling it off a stranger's
    settings.

    `user_id` is a required keyword with no default. It used to fall back to
    `channel.user_id`, a column this ticket drops, and an optional owner would
    have left every existing call site passing nothing and still passing its
    tests.

    `next_sync_at` starts from the Channel's regular schedule: it is the
    follower's own deadline from here on, but seeding it to `None` would make
    every backfilled follow look due immediately to the scheduler that reads it
    later.

    Used by both the dual-write and the backfill, so the two cannot disagree
    about what a follow for a Channel contains.
    """
    return ensure_follow(
        session,
        channel_id=channel.id,
        user_id=user_id,
        next_sync_at=channel.next_regular_sync_at,
        **follow_field_values(values),
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


def repoint_follows_off_groups(
    session: Session,
    group_ids: set[str],
    *,
    except_user_id: uuid.UUID,
    group_for: Callable[[uuid.UUID], str],
) -> int:
    """Move every follow naming one of `group_ids` onto its own owner's group.

    Ticket 21 gave `tg_channel_setting_groups` a cascading key, so deleting an
    account takes its setting groups with it — and `ChannelFollow.setting_group_id`
    is a plain string with no key of its own. `ensure_follow_for_channel` copies
    the Channel's group id onto each follow, and auto-follow files a Channel under
    whoever scraped the handle first, so a second follower's row routinely names
    the first follower's group. Left alone it names a row that is gone, and
    `schedule_group_id` then resolves to nothing.

    **The repointing lives here because this module is the table's only writer**
    — `test_channel_creation_paths.py::test_the_follow_table_has_one_writer`. The
    caller is `channel_setting_groups.release_groups_of_deleted_account`, which
    owns the group half and passes `group_for` rather than being imported from
    here, so the two aggregates stay one-directional.

    A follow that belongs to the departing account is skipped: it cascades with
    the account, and repointing it would write a row the delete is about to
    remove. Does not commit — the delete route owns the transaction.
    """
    if not group_ids:
        return 0
    moved = 0
    rows = session.exec(
        select(ChannelFollow).where(col(ChannelFollow.setting_group_id).in_(group_ids))
    ).all()
    for follow in rows:
        if follow.user_id == except_user_id:
            continue
        follow.setting_group_id = group_for(follow.user_id)
        session.add(follow)
        moved += 1
    return moved


def follow_exists(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_id: str,
) -> bool:
    """Whether `user_id` follows `channel_id`. A primary-key hit."""
    return session.get(ChannelFollow, (user_id, channel_id)) is not None


def get_follow(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_id: str,
) -> ChannelFollow | None:
    """One account's follow row for one Channel, or None. A primary-key hit.

    Ticket 22 needs this where `follow_exists` used to be enough: the setting
    group moved off `Channel`, so a caller that reassigns a channel's group now
    has to reach the row that holds it rather than a boolean about whether it
    exists.
    """
    return session.get(ChannelFollow, (user_id, channel_id))


def count_follows(session: Session) -> int:
    """Total follows, for the audit."""
    return session.exec(select(func.count()).select_from(ChannelFollow)).one()


# --- Setting-group membership -------------------------------------------------
#
# Ticket 22 dropped `Channel.setting_group_id`, so "which channels are in this
# group" became a question about `tg_channel_follows`. These four live here
# rather than in `channel_setting_groups.py` because that module may not name
# `ChannelFollow` at all — `test_channel_creation_paths.py` fails any module
# outside this aggregate that mentions the identifier, reads included. That is
# the one-writer rule doing its job: the consolidation helper below is a real
# write, and it would have landed in the group module without it.


def follow_counts_by_group(session: Session) -> dict[str, int]:
    """How many follows name each setting group."""
    rows = session.exec(
        select(ChannelFollow.setting_group_id, func.count())
        .where(col(ChannelFollow.setting_group_id).is_not(None))
        .group_by(col(ChannelFollow.setting_group_id))
    ).all()
    return {group_id: count for group_id, count in rows if group_id is not None}


def count_follows_in_group(session: Session, group_id: str) -> int:
    """How many follows name `group_id`. Answers "is this group still in use"."""
    return session.exec(
        select(func.count())
        .select_from(ChannelFollow)
        .where(col(ChannelFollow.setting_group_id) == group_id)
    ).one()


def group_ids_for_user(session: Session, *, user_id: uuid.UUID) -> set[str]:
    """The distinct setting-group ids `user_id`'s own follows name.

    No `scoped_select`: `(user_id, channel_id)` is the primary key here, so
    filtering on the owner answers *which rows are mine* rather than what this
    account may see. Ticket 30's rule — a flag cannot gate identity.
    """
    rows = session.exec(
        select(ChannelFollow.setting_group_id)
        .where(col(ChannelFollow.user_id) == user_id)
        .distinct()
    ).all()
    return {group_id for group_id in rows if group_id}


def channels_in_group(session: Session, group_id: str) -> Sequence[Channel]:
    """The Channels followed under `group_id`, deduplicated.

    Joins rather than switching tables: the two sync deadlines this feeds are
    columns on `tg_channels`, shared by every follower, so the Channel is still
    what gets recomputed. `distinct` because two accounts can follow one handle
    under the same group id only when it is theirs — but the join would repeat
    the row per follow regardless, and recomputing one Channel twice is wasted
    work rather than a wrong answer.
    """
    return session.exec(
        select(Channel)
        .join(ChannelFollow, col(ChannelFollow.channel_id) == col(Channel.id))
        .where(col(ChannelFollow.setting_group_id) == group_id)
        .distinct()
    ).all()


def repoint_follows_between_groups(
    session: Session,
    *,
    user_id: uuid.UUID,
    from_group_id: str,
    to_group_id: str,
) -> int:
    """Move one account's follows from one of its groups onto another.

    The duplicate-reserved-group merge in `channel_setting_groups.py`, which
    used to repoint Channels. Scoped to `user_id` because only that account's
    duplicate groups are being merged: a second follower of the same handle
    keeps whatever group they chose, which is the whole reason the column moved.

    Does not commit — the caller owns the transaction, matching `ensure_follow`.
    """
    rows = session.exec(
        select(ChannelFollow).where(
            col(ChannelFollow.user_id) == user_id,
            col(ChannelFollow.setting_group_id) == from_group_id,
        )
    ).all()
    for follow in rows:
        follow.setting_group_id = to_group_id
        follow.updated_at = utc_now()
        session.add(follow)
    return len(rows)


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
    channel_ids: Iterable[str] | None = None,
) -> dict[str, ChannelFollow]:
    """One User's follows of the given channels, keyed by channel id.

    The read-side counterpart to `follows_for_channels`, which answers "who
    follows this channel" (retention's question, and the audit's); this
    answers "what does *this* user's follow of this channel say" — the
    question the channel list (ticket 15) asks once it stops reading the
    per-User fields off `Channel` itself.

    `channel_ids=None` means every follow this account holds, which the export
    needs (ticket 22) because it walks the whole Channel table and cannot build
    the id list first without a second pass. An **empty** iterable still means
    "none of them" and returns nothing — the two are deliberately different, and
    collapsing them would make a caller that legitimately narrowed to zero
    channels export every one instead.
    """
    statement = select(ChannelFollow).where(ChannelFollow.user_id == user_id)
    if channel_ids is not None:
        ids = list(channel_ids)
        if not ids:
            return {}
        statement = statement.where(col(ChannelFollow.channel_id).in_(ids))
    rows = session.exec(statement).all()
    return {f.channel_id: f for f in rows}


#: One Channel and the caller's own follow of it.
#:
#: Named here so a caller can hold the pair without importing `ChannelFollow`.
#: That is not cosmetic: `test_channel_creation_paths.py` enforces "one writer
#: for this table" by matching the *identifier* anywhere in a module — its own
#: comment accepts a false positive on a type annotation as the price of
#: catching `delete(ChannelFollow)` and `update(ChannelFollow)`, which are not
#: constructor calls. Exempting the scheduler would have said it writes follows,
#: which is false; this keeps the guard strict and the claim true.
FollowedChannel = tuple[Channel, ChannelFollow]


def schedule_group_id(follow: ChannelFollow) -> str | None:
    """Which setting group decides this follower's schedule for this Channel.

    **The follow's, and now only the follow's.** `Channel.setting_group_id` was
    a single value shared by every follower; `ChannelFollow.setting_group_id` is
    the per-account one ticket 04 moved off the Channel precisely so the second
    follower would not have to overwrite the first's settings to have any of
    their own. Reading the Channel's copy decided "is this due" from whichever
    account edited it last, which is the bug the follow table exists to prevent.

    Ticket 22 dropped that column and with it this function's fallback, so the
    return type is now honestly `str | None`. A follow written before the
    mirroring existed can still hold NULL, and the callers skip a channel with
    no resolvable group rather than silently treating it as unfrozen — which is
    what a fallback to a stranger's group amounted to.

    Kept as a named function rather than inlined to `follow.setting_group_id`
    because the reason the follow's copy wins is the whole point, and it is the
    kind of thing a later reader "simplifies" back into a Channel read.
    """
    return follow.setting_group_id


def accounts_with_follows(session: Session) -> list[uuid.UUID]:
    """Every account that follows at least one Channel, oldest id order.

    The scheduler's replacement for "who is the operator" (ticket 21). Auto-sync
    used to pick one owner — the network-settings row's, else the first
    superuser — and sync every Channel under `Channel.user_id == owner OR NULL`.
    That question has no answer once two accounts follow the same handle, and
    the stamp it read is one ticket 22 drops.

    **Deliberately not gated on the enforcement flag.** It decides what an
    account may *see*; which Channels it follows is a fact about the follow
    table, and the scheduler is not serving a response to anybody. Ticket 30
    made the same call from the other side: a flag cannot gate identity.

    Sorted so a tick's work is dealt in a stable order rather than whatever
    order the planner returns — two ticks that find the same due set enqueue it
    the same way, which is what makes a duplicate diagnosable.
    """
    rows = session.exec(
        select(ChannelFollow.user_id).distinct().order_by(col(ChannelFollow.user_id))
    ).all()
    return [row for row in rows if row is not None]


def followed_channels_for(
    session: Session, *, user_id: uuid.UUID
) -> list[FollowedChannel]:
    """The Channels `user_id` follows, each paired with *their own* follow row.

    The pair is the point. `Channel.setting_group_id` is one value shared by
    every follower, and `ChannelFollow.setting_group_id` is the per-account one
    ticket 04 moved off the Channel precisely so a second follower would not
    have to overwrite the first's settings to have any of their own. A
    scheduler reading the Channel's copy decides "is this due" from whichever
    account last edited it, which is the bug the follow table exists to prevent
    — so the caller gets both and takes the follow's when it is set.

    An inner join, so a follow pointing at a Channel that no longer exists
    simply drops out; `orphan_follow_channel_ids` is what reports those, and it
    is the audit's job rather than the scheduler's.
    """
    rows = session.exec(
        select(Channel, ChannelFollow)
        .join(ChannelFollow, col(Channel.id) == col(ChannelFollow.channel_id))
        .where(ChannelFollow.user_id == user_id)
        .order_by(col(Channel.id))
    ).all()
    return [(channel, follow) for channel, follow in rows]


def followed_channel_names(session: Session) -> set[str]:
    """The names of every Channel *somebody* follows, across all accounts.

    The corpus-wide counterpart to `visible_channel_names`, for the work that is
    genuinely deployment-level rather than per account: translation (ticket 21).
    A `PostTranslation` is `FOLLOW_SCOPED` — produced once, served to every
    follower — so translating per account would pay a provider twice to store
    two identical rows.

    The union is not the same as "every Channel": one nobody follows is
    retention's queue (ticket 05), and spending provider quota on posts about to
    be collected is the case worth excluding.
    """
    rows = session.exec(
        select(Channel.name)
        .join(ChannelFollow, col(Channel.id) == col(ChannelFollow.channel_id))
        .distinct()
    ).all()
    return {str(name) for name in rows}


def count_followed_channels(session: Session) -> int:
    """How many distinct Channels anybody follows.

    One `count(*)`, never `len(followed_channels_for(...))`. That spelling
    hydrates every Channel — ~2,077 ORM rows on this deployment — to produce one
    integer, which is the "compute it for everything, read one field" shape
    `needs_dynamic_stats` exists to have removed.
    """
    return int(
        session.exec(select(func.count(distinct(col(ChannelFollow.channel_id))))).one()
    )


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


#: The per-User fields that live on the Follow and nowhere else.
#:
#: Ticket 04 copied these off `Channel`, where a second follower of a handle
#: would have had to overwrite the first one's values to have any of their own;
#: ticket 22 dropped `Channel`'s copies, so this table is now the only home.
#: The one place every writer reads from, so a seventh field is a diff to this
#: tuple rather than to the call sites that would otherwise be kept in step by
#: memory.
FOLLOW_OWNED_FIELDS = (
    "setting_group_id",
    "followed_at",
    "tags",
    "start_id",
    "start_time",
    "discovered_via",
)


def follow_field_values(values: Mapping[str, Any] | None) -> dict[str, Any]:
    """`values` filled out to the complete set of follow-owned fields.

    Every field the caller does not name gets its empty default, so an insert
    always writes the whole row and a caller cannot leave a column silently
    absent. Keys that are not follow-owned are dropped rather than passed
    through: callers hand this a normalised request body, which carries plenty
    of Channel fields too, and forwarding one would raise on a column
    `ChannelFollow` does not have.

    `tags` defaults to a fresh list per call and is copied rather than
    referenced. It is a JSON column backed by a mutable list, and writing one
    shared list object into two rows lets a later mutation of either show up on
    the other.
    """
    filled: dict[str, Any] = dict.fromkeys(FOLLOW_OWNED_FIELDS)
    filled["tags"] = []
    for field in FOLLOW_OWNED_FIELDS:
        if values is not None and field in values:
            filled[field] = values[field]
    filled["tags"] = list(filled["tags"] or [])
    return filled


def follow_values_from_body(body: Mapping[str, Any]) -> dict[str, Any]:
    """The follow-owned fields a normalised request body actually names.

    The counterpart to `channels.apply_channel_fields`, which writes a body's
    *Channel* fields onto the Channel. Ticket 22 dropped these from `Channel`,
    so `key in Channel.model_fields` is simply false for them now and that path
    would **silently discard** an edit to `tags` or `startTime` rather than fail
    it. This is where they land instead.

    Tag validation moved here with the write, for the same reason: it sat next
    to the `setattr` in `apply_channel_fields`, and moving the write without the
    check would have let a reserved virtual-group tag through into a Follow.

    `setting_group_id` is deliberately **not** taken from a body. It is resolved
    from the caller's own setting groups — `PUT /data/channels/{id}` answers 400
    for a body that names it and points at the bulk endpoint — so accepting it
    here would reopen by the back door the reassignment that route refuses.

    Returns only the keys present, so the result can go straight to
    `sync_follow_settings`, whose contract is "the fields this edit touched".
    """
    values: dict[str, Any] = {}
    for field in FOLLOW_OWNED_FIELDS:
        if field == "setting_group_id" or field not in body:
            continue
        value = body[field]
        if field == "tags":
            reject_reserved_virtual_group_tags(value)
            value = normalize_channel_tags(value)
        values[field] = value
    return values


def sync_follow_settings(
    session: Session,
    channel: Channel,
    *,
    user_id: uuid.UUID | None,
    values: Mapping[str, Any],
) -> None:
    """Write an explicit edit's per-User fields onto the caller's Follow.

    `ensure_follow`/`ensure_follow_for_channel` are additive on purpose — a
    second follower of an already-scraped channel must not have their tags
    reset by somebody else re-creating it. An explicit edit through
    `PUT /data/channels/{id}`, the bulk-tags endpoint, or an import overwriting
    an existing channel is the opposite case: the caller means for the value to
    change, and since ticket 22 dropped these columns from `Channel` this row is
    the only place the new value can land.

    `values` is the subset of `FOLLOW_OWNED_FIELDS` this particular edit
    actually touched, carrying the new values, and only that subset is written
    to an *existing* Follow. Writing the full set unconditionally was the first
    cut here, and it was wrong: an edit to one field (say `bio`, which is not
    follow-owned at all) would still overwrite every other follower field,
    clobbering a Follow that had legitimately diverged — exactly the per-User
    state ticket 15 exists to preserve. A brand-new Follow still needs the
    complete row, so the *insert* side fills the untouched fields with their
    empty defaults; only the conflict *update* is narrowed.

    Ticket 22 changed where the values come from, not the rule. They used to be
    read back off the just-written Channel, which worked only because `Channel`
    was still authoritative; the caller now passes what it means to write.

    Resolves the owner the same way `ensure_follow` does, so the two writers
    can never disagree about whose row an edit lands on. A no-op when there is
    no superuser to fall back to, matching `ensure_follow`.

    `ON CONFLICT DO UPDATE` rather than `ensure_follow`'s `DO NOTHING` — this
    is the one write path that means to overwrite an existing Follow's values.
    `next_sync_at` is seeded on insert (a fresh Follow needs a schedule) but
    never part of `values`: it is the follower's own next-sync deadline, not
    something a Channel edit should reset.
    """
    owner_id = resolve_follow_owner(session, user_id)
    if owner_id is None:
        return

    now = utc_now()
    update_values = {k: v for k, v in values.items() if k in FOLLOW_OWNED_FIELDS}
    insert_values = follow_field_values(update_values)

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
