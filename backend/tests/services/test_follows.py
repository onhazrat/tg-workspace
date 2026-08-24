"""The Follow aggregate (ticket 04).

A Follow is the relation between a User and a Channel: the part of "I watch
this channel" that is *not* shared, unlike the Channel row and its Posts.

## Watched to fail

Per `CLAUDE.md`, each assertion here was mutation-tested:

* drop `on_conflict_do_nothing` for a plain insert → the idempotence test fails
  with an IntegrityError
* let `ensure_follow` overwrite the existing row's columns → the
  "re-creating does not reset" test fails
* return the passed `user_id` from `resolve_follow_owner` without the operator
  fallback → the ownerless-channel test fails
* drop `ondelete="CASCADE"` from either foreign key → the cascade tests fail
* seed `next_sync_at=None` in `ensure_follow_for_channel` → the copied-schedule
  test fails
* drop the account-exists check from `resolve_follow_owner` → the orphaned-owner
  test fails with an IntegrityError
* return the operator unconditionally from `resolve_follow_owner` → the
  live-owner test fails
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models import User
from app.models_tg import Channel, ChannelFollow, Post
from app.services.follows import (
    channel_ids_without_follows,
    count_follows,
    ensure_follow,
    ensure_follow_for_channel,
    follow_exists,
    follows_for_channels,
    orphan_follow_channel_ids,
    resolve_follow_owner,
)
from app.services.operator import get_operator_user_id
from app.services.tenancy import scoped_select
from tests.utils.user import create_random_user


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> User:
    """A real account, because `ChannelFollow.user_id` is a real foreign key.

    Tests elsewhere in this suite fabricate `uuid.uuid4()` owners freely, which
    the nullable `Channel.user_id` column tolerates. This table does not, and
    that is the point of it.
    """
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _channel(session: Session, channel_id: str, **kwargs) -> Channel:
    channel = Channel(
        id=channel_id,
        name=kwargs.pop("name", channel_id),
        setting_group_id=kwargs.pop("setting_group_id", "default-global"),
        **kwargs,
    )
    session.add(channel)
    session.commit()
    return channel


def test_ensure_follow_creates_one_row(session: Session, user: User) -> None:
    _channel(session, "ch_create")

    created = ensure_follow(session, channel_id="ch_create", user_id=user.id)
    session.commit()

    assert created is True
    assert follow_exists(session, user_id=user.id, channel_id="ch_create")


def test_ensure_follow_is_idempotent(session: Session, user: User) -> None:
    """Following twice is a no-op, not an IntegrityError.

    The composite key already forbids the duplicate; `ON CONFLICT DO NOTHING`
    is what turns that from an exception into the answer the caller wanted.
    A read-then-write would be a race between two concurrent auto-follows of
    the same channel, which is a real shape here — Discover and auto-follow
    share one creation path.
    """
    _channel(session, "ch_twice")

    first = ensure_follow(session, channel_id="ch_twice", user_id=user.id)
    second = ensure_follow(session, channel_id="ch_twice", user_id=user.id)
    session.commit()

    assert (first, second) == (True, False)
    assert count_follows(session) == 1


def test_ensure_follow_does_not_reset_an_existing_row(
    session: Session, user: User
) -> None:
    """Re-creating a Channel must not wipe the follower's own values.

    This is why the write is DO NOTHING rather than an upsert: `tags` and
    `start_time` are the follower's, and a second pass through the creation
    path — an import, a re-follow, a Discover hit on a channel already
    followed — has no business overwriting them with its own defaults.
    """
    _channel(session, "ch_keep")
    ensure_follow(
        session,
        channel_id="ch_keep",
        user_id=user.id,
        tags=["mine"],
        start_time=1234,
    )
    session.commit()

    ensure_follow(
        session, channel_id="ch_keep", user_id=user.id, tags=[], start_time=None
    )
    session.commit()

    follow = session.get(ChannelFollow, (user.id, "ch_keep"))
    assert follow is not None
    assert (follow.tags, follow.start_time) == (["mine"], 1234)


def test_ownerless_channel_falls_back_to_the_operator(session: Session) -> None:
    """`Channel.user_id` is nullable; `ChannelFollow.user_id` is not.

    A creation path handed `user_id=None` has two honest options, and writing
    no follow is the one that manufactures exactly the drift the audit hunts
    for. So the dual-write uses the backfill's rule.
    """
    operator_id = get_operator_user_id(session)
    assert operator_id is not None, "init_db seeds the first superuser"
    _channel(session, "ch_ownerless")

    created = ensure_follow(session, channel_id="ch_ownerless", user_id=None)
    session.commit()

    assert created is True
    assert follow_exists(session, user_id=operator_id, channel_id="ch_ownerless")
    assert resolve_follow_owner(session, None) == operator_id


def test_an_orphaned_owner_is_treated_like_no_owner(session: Session) -> None:
    """A `user_id` naming a deleted account must not reach the foreign key.

    The TG tables have no FK to `user.id`, so deleting an account leaves its
    Channels pointing at nothing — `audit_tenancy_drift.py` counts exactly this
    as orphan-owner drift. `sync_orchestrator.py`'s auto-follow passes
    `user_id or channel.user_id` straight through, so before this check a
    forwarded channel picked up from an orphaned row would raise
    `IntegrityError` and abort the whole sync job, on a path that worked fine
    before follows existed.
    """
    operator_id = get_operator_user_id(session)
    ghost = create_random_user(session)
    ghost_id = ghost.id
    session.exec(delete(User).where(col(User.id) == ghost_id))
    session.commit()
    _channel(session, "ch_orphan", user_id=ghost_id)

    created = ensure_follow(session, channel_id="ch_orphan", user_id=ghost_id)
    session.commit()

    assert created is True
    assert resolve_follow_owner(session, ghost_id) == operator_id
    assert follow_exists(session, user_id=operator_id, channel_id="ch_orphan")


def test_a_live_owner_is_not_reassigned(session: Session, user: User) -> None:
    """The other direction, so the orphan check cannot become "always operator"."""
    assert resolve_follow_owner(session, user.id) == user.id


def test_ensure_follow_for_channel_copies_the_per_user_columns(
    session: Session, user: User
) -> None:
    """The follow carries what the Channel carries, including its schedule.

    `next_sync_at` seeded from the Channel's regular deadline rather than left
    NULL: a backfilled follow with no deadline reads as "due now" to the
    scheduler that adopts this column later, which would stampede every channel
    on the first tick after the flip.
    """
    channel = _channel(
        session,
        "ch_copy",
        user_id=user.id,
        setting_group_id="default-global",
        followed_at=111,
        tags=["a", "b"],
        start_id=7,
        start_time=222,
        discovered_via={"source": "discover"},
        next_regular_sync_at=999,
    )

    assert ensure_follow_for_channel(session, channel) is True
    session.commit()

    follow = session.get(ChannelFollow, (user.id, "ch_copy"))
    assert follow is not None
    assert follow.setting_group_id == "default-global"
    assert follow.followed_at == 111
    assert follow.tags == ["a", "b"]
    assert follow.start_id == 7
    assert follow.start_time == 222
    assert follow.discovered_via == {"source": "discover"}
    assert follow.next_sync_at == 999


def test_deleting_the_channel_takes_its_follows(session: Session, user: User) -> None:
    channel = _channel(session, "ch_cascade")
    ensure_follow(session, channel_id="ch_cascade", user_id=user.id)
    session.commit()

    session.delete(channel)
    session.commit()

    assert count_follows(session) == 0


def test_deleting_the_account_takes_its_follows(session: Session) -> None:
    """An account's follows are its own; nothing survives it.

    Separate from the channel cascade because the two foreign keys are declared
    separately and only one of them was ever going to be forgotten.
    """
    account = create_random_user(session)
    _channel(session, "ch_user_cascade")
    ensure_follow(session, channel_id="ch_user_cascade", user_id=account.id)
    session.commit()

    session.exec(delete(User).where(col(User.id) == account.id))
    session.commit()

    assert count_follows(session) == 0


def test_a_second_account_can_follow_the_same_channel(session: Session) -> None:
    """The whole point of the table: one Channel row, many followers.

    Today the per-user values live on `tg_channels`, so the second follower
    would have to overwrite the first one's to have any of their own.
    """
    first = create_random_user(session)
    second = create_random_user(session)
    _channel(session, "ch_shared")

    ensure_follow(session, channel_id="ch_shared", user_id=first.id, tags=["x"])
    ensure_follow(session, channel_id="ch_shared", user_id=second.id, tags=["y"])
    session.commit()

    follows = {f.user_id: f.tags for f in follows_for_channels(session, ["ch_shared"])}
    assert follows == {first.id: ["x"], second.id: ["y"]}

    session.exec(delete(User).where(col(User.id).in_([first.id, second.id])))
    session.commit()


def test_a_follow_needs_a_real_account(session: Session, user: User) -> None:
    """The foreign key is the reason this table can be trusted as an owner.

    `Channel.user_id` has no constraint, so a stale or fabricated id sits there
    unnoticed — which is why `audit_tenancy_drift.py` has to go looking for
    orphans on the old columns and does not on this one.
    """
    _channel(session, "ch_ghost")

    session.add(
        ChannelFollow(user_id=uuid.uuid4(), channel_id="ch_ghost"),
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_audit_reads_find_channels_with_no_follow(session: Session, user: User) -> None:
    _channel(session, "ch_followed")
    _channel(session, "ch_lonely")
    ensure_follow(session, channel_id="ch_followed", user_id=user.id)
    session.commit()

    assert channel_ids_without_follows(session) == ["ch_lonely"]
    assert orphan_follow_channel_ids(session) == []


def test_follows_for_channels_with_no_ids_queries_nothing(session: Session) -> None:
    assert follows_for_channels(session, []) == []


def test_the_follow_table_is_classified_by_the_tenancy_seam() -> None:
    """A new TG table has to answer "whose rows are these?" the day it lands.

    `test_tenancy_seam.py` fails on an unclassified model, so this is belt and
    braces — but it is worth stating here that the answer for follows is
    user-owned rather than follow-scoped. Scoping the follow table *by* follows
    is circular; which channels you watch is private, which is user story 9.
    """
    from app.services.tenancy import SCOPES, Scope

    assert SCOPES[ChannelFollow] is Scope.USER_OWNED


def test_no_stray_rows_after_the_suite(session: Session) -> None:
    """Sanity: the fixtures clean up after themselves."""
    assert session.exec(select(ChannelFollow)).all() == []


# --------------------------------------------------------------------------
# The scoped read, against real rows
# --------------------------------------------------------------------------


@pytest.fixture
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam on for one test. See `test_tenancy_seam.py`."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


@pytest.mark.usefixtures("enforced")
def test_scoped_posts_survive_a_renamed_channel(session: Session, user: User) -> None:
    """The one thing a compiled-SQL assertion cannot check.

    `ChannelFollow.channel_id` is a foreign key to `Channel.id`; `Post.channel_name`
    holds `Channel.name`. Nothing keeps those equal — `name` is writable through
    `PUT /data/channels/{id}`, and an import sets id and name from separate
    fields. Correlating the foreign key straight against `channel_name`
    compiles, runs, and returns nothing at all for a renamed channel, so every
    guard that asserts on generated SQL passes while the query is wrong.

    Only real rows catch it, which is why this test lives here rather than in
    `test_tenancy_seam.py` — that file is deliberately database-free.
    """
    channel = _channel(session, "ch_handle_v1", name="ch_renamed")
    session.add(Post(channel_name="ch_renamed", post_id=1, text="hello", timestamp=1))
    ensure_follow(session, channel_id=channel.id, user_id=user.id)
    session.commit()

    rows = session.exec(scoped_select(select(Post), Post, user.id)).all()

    assert [p.post_id for p in rows] == [1]


@pytest.mark.usefixtures("enforced")
def test_scoped_posts_exclude_a_channel_you_do_not_follow(
    session: Session, user: User
) -> None:
    """The other direction, so the join cannot degrade into "return everything"."""
    _channel(session, "ch_mine", name="ch_mine")
    _channel(session, "ch_theirs", name="ch_theirs")
    session.add(Post(channel_name="ch_mine", post_id=1, text="mine", timestamp=1))
    session.add(Post(channel_name="ch_theirs", post_id=2, text="theirs", timestamp=2))
    ensure_follow(session, channel_id="ch_mine", user_id=user.id)
    session.commit()

    rows = session.exec(scoped_select(select(Post), Post, user.id)).all()

    assert [p.post_id for p in rows] == [1]


@pytest.mark.usefixtures("enforced")
def test_scoped_channels_are_the_ones_you_follow(session: Session, user: User) -> None:
    _channel(session, "ch_followed_by_me")
    _channel(session, "ch_not_followed")
    ensure_follow(session, channel_id="ch_followed_by_me", user_id=user.id)
    session.commit()

    rows = session.exec(scoped_select(select(Channel), Channel, user.id)).all()

    assert [c.id for c in rows] == ["ch_followed_by_me"]


def test_following_a_channel_someone_else_scraped_writes_a_follow(
    session: Session,
) -> None:
    """The shared-corpus case, and the one the AST guard cannot see.

    `create_followed_channel` returns early when the handle already exists, so
    the follow used to be written only on the branch that creates the Channel.
    The guard passed anyway — the module does call a follow writer, just on the
    other branch. A second account bulk-following a channel already scraped got
    no row and would have seen nothing under enforcement, which is the exact
    thing the shared corpus is supposed to make instant.
    """
    from app.services.followed_channels import create_followed_channel

    first = create_random_user(session)
    second = create_random_user(session)
    _channel(session, "ch_popular", user_id=first.id)
    ensure_follow(session, channel_id="ch_popular", user_id=first.id)
    session.commit()

    created = create_followed_channel(
        "ch_popular",
        display_name="Popular",
        photo_url=None,
        is_unavailable=False,
        discovered_via=None,
        user_id=second.id,
        effective_start_time=0,
    )

    assert created is False, "the Channel already existed"
    assert follow_exists(session, user_id=second.id, channel_id="ch_popular")
    assert follow_exists(session, user_id=first.id, channel_id="ch_popular")

    session.exec(delete(User).where(col(User.id).in_([first.id, second.id])))
    session.commit()
