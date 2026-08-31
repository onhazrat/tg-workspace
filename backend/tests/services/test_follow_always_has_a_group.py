"""A follow is never left without a setting group (ticket 22, review round).

Ticket 22 moved `setting_group_id` off `tg_channels` and onto
`tg_channel_follows`. That closed a real bug — the second follower of a handle
used to inherit whichever group the first one picked, including one belonging to
another account — and opened a quieter one in its place.

**A group-less follow is silently unschedulable.** `run_auto_sync` reads the
group to decide whether a channel is due; with none it `continue`s, for ever,
with nothing in the log. `get_group_for_channel` answers 500 for the same row.
Neither state was reachable before this ticket, because every Channel-creation
path set `Channel.setting_group_id` and `schedule_group_id` fell back to it.
Removing that fallback without closing the paths that can now write NULL is the
half-fix `/code-review` found in four places at once:

* the **migration**, which dropped the source with follows still holding NULL;
* `scripts/backfill_channel_follows.py`, whose bare `ensure_follow_for_channel`
  used to copy the group off the Channel and now copies nothing — on the one
  database that still reaches it, a restored pre-ticket-04 backup, that is every
  channel it walks;
* the **import door**, whose existing-Channel branch resolves no group at all,
  so a restore into a deployment where another account scraped the handle first
  creates the importer's first follow group-less; and
* `_prepare_channel_sync`, which called the *raising* lookup before its own
  `try`, so such a follow aborted the queue message rather than failing one
  channel.

`channels.upsert_channel` had the same shape and was fixed during the ticket,
caught by `test_account_isolation.py`. These are the other four doors.

The last two tests are different consequences of the same move. A chat-id
collision used to freeze the handle for everybody, because it wrote a Channel
column; writing one follow instead freezes at most one account, and none at all
when the resolved owner does not follow the channel. And `run_db` was typed
`Callable[..., T]`, which type-checks any call whatsoever — which is how two
call sites survived this ticket's signature changes and would have raised
`TypeError` in production.

## Watched to fail

* remove `rescue_null_follow_fields` from `upgrade` → the migration test fails
* make the rescue copy every field rather than only the NULL ones → the same
  test fails on the start time
* drop `values=` from the backfill's `ensure_follow_for_channel` → its test fails
* remove the group resolution from `_import_channels`' `if ch:` branch → the
  import test fails
* put `get_group_for_channel` back in `_prepare_channel_sync` → the scraper test
  fails with `HTTPException` rather than returning `"missing"`
* freeze only `freeze_owner_id` → the collision test fails on the second account
* freeze both accounts into the *resolved owner's* group → it fails on ownership
* restore `Callable[..., T]` on `run_db` → the typing test fails
"""

from __future__ import annotations

import inspect

import pytest
import sqlalchemy as sa
from sqlmodel import Session, col, delete, select

from app.alembic.versions import f7f6948f2c5d_drop_superseded_columns_ticket_22 as mig
from app.core.db import engine
from app.models import User
from app.models_tg import Channel, ChannelFollow, ChannelSettingGroup
from app.services.async_db import run_db
from app.services.channel_setting_groups import (
    ensure_default_group,
    frozen_group_id_for_user,
)
from app.services.follows import ensure_follow, get_follow
from tests.utils.user import create_random_user


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _seed_channel(session: Session, channel_id: str) -> Channel:
    channel = session.get(Channel, channel_id)
    if channel is None:
        channel = Channel(id=channel_id, name=channel_id)
        session.add(channel)
        session.flush()
    return channel


def test_run_db_checks_its_arguments_against_the_callee() -> None:
    """`run_db` is `ParamSpec`-typed, so a stale call site is a type error.

    It was `Callable[..., T]` with `*args: Any`. Ticket 22 dropped `user_id`
    from `_finalize_channel_error` and from `_load_sync_job_concurrency` and
    left both call sites passing one; the suite stayed green, and both would
    have raised `TypeError` at runtime — the first from inside the handler for
    an unexpected sync exception, taking the failed sync log and the auto-sync
    failure backoff down with it, on a path nothing exercises.

    Asserted here rather than left to `scripts/lint.sh` because the regression
    is one word wide: putting `Callable[..., T]` back reopens the hole while
    every existing call still type-checks, so nothing else would go red.
    """
    assert [str(param) for param in run_db.__type_params__] == ["T", "P"], (
        "`run_db` lost its ParamSpec. With `Callable[..., T]` every argument to "
        "every `run_db` call is unchecked, which is how two call sites survived "
        "a signature change in this ticket."
    )
    signature = str(inspect.signature(run_db))
    assert "P.args" in signature and "P.kwargs" in signature, signature


def test_the_migration_rescues_a_follow_that_never_got_a_copy(
    legacy_channel_per_user_columns: None,
    session: Session,
    user: User,
) -> None:
    """A NULL follow field takes the Channel's value before the column is dropped.

    Per column, not per row. The seeded follow has a start time of its own and
    no group, and only the group may move: a rescue written as "copy every field
    when the group is NULL" passes against a wholly empty follow and hands back
    a start time the account had deliberately set for itself.
    """
    group = ensure_default_group(session, user_id=user.id)
    channel = _seed_channel(session, "rescue-ch")
    session.commit()

    session.execute(
        sa.text(
            "UPDATE tg_channels SET setting_group_id = :gid, start_time = 111 "
            "WHERE id = :cid"
        ),
        {"gid": group.id, "cid": channel.id},
    )
    ensure_follow(session, channel_id=channel.id, user_id=user.id, next_sync_at=None)
    session.execute(
        sa.text(
            "UPDATE tg_channel_follows SET setting_group_id = NULL, "
            "start_time = 999 WHERE channel_id = :cid AND user_id = :uid"
        ),
        {"cid": channel.id, "uid": user.id},
    )
    session.commit()

    with engine.begin() as bind:
        mig.rescue_null_follow_fields(bind)

    session.expire_all()
    follow = get_follow(session, user_id=user.id, channel_id=channel.id)
    assert follow is not None
    assert follow.setting_group_id == group.id, (
        "the follow kept its NULL group through the one transaction that still "
        "held the Channel's copy. After the `drop_column` loop there is no "
        "source left, and the row is unschedulable for good."
    )
    assert follow.start_time == 999, (
        "the rescue overwrote a value the follow already had. It fills NULLs "
        "only — an account that set its own start time must keep it."
    )


def test_the_migration_actually_calls_the_rescue() -> None:
    """`upgrade` runs the rescue, before the columns it reads are dropped.

    The test above calls `rescue_null_follow_fields` directly, which is what
    makes it able to assert the SQL — and it therefore passes with the call
    deleted from `upgrade` entirely. That mutation was watched passing. Wiring
    and behaviour are separate assertions because the function has exactly one
    caller and losing it is silent.

    Order matters as much as presence: reading a column after `drop_column` is
    an error, so the rescue has to come first.
    """
    source = inspect.getsource(mig.upgrade)
    assert "rescue_null_follow_fields(bind)" in source, (
        "`upgrade` no longer runs the rescue, so a follow still holding NULL "
        "loses its only source when the columns are dropped below."
    )
    assert source.index("rescue_null_follow_fields(bind)") < source.index(
        'op.drop_column("tg_channels", column)'
    ), "the rescue reads columns the loop above it has already dropped"


def test_the_follows_backfill_gives_each_new_follow_a_group(
    session: Session,
) -> None:
    """`backfill_channel_follows` writes a schedulable follow, not a bare one.

    `prestart.sh` runs it `--if-needed`, and the only database that still
    reaches it is a restored pre-ticket-04 backup — where a bare
    `ensure_follow_for_channel` leaves every channel group-less and the install
    comes up syncing nothing at all.
    """
    from scripts.backfill_channel_follows import backfill

    _seed_channel(session, "backfill-ch")
    session.commit()

    backfill(dry_run=False)

    session.expire_all()
    follows = session.exec(
        select(ChannelFollow).where(col(ChannelFollow.channel_id) == "backfill-ch")
    ).all()
    assert follows, "the backfill wrote no follow at all"
    assert all(follow.setting_group_id is not None for follow in follows), (
        "the backfill created a group-less follow. `run_auto_sync` skips such a "
        "channel silently and `get_group_for_channel` answers 500 for it."
    )


def test_importing_an_existing_channel_gives_the_importer_a_group(
    session: Session,
    user: User,
    other_user: User,
) -> None:
    """A restore onto a handle somebody else scraped still resolves a group.

    The `if ch:` branch takes `follow_values_from_body`, which deliberately never
    carries `setting_group_id` — an id the *document* supplies would attach the
    caller's follow to another account's policy row, the hole ticket 35 closed on
    `bulk_assign_setting_group`. So the group has to be resolved here, exactly as
    the create branch does, or the follow this import creates has none.

    It takes a **second account** to reach: with one, the importer already
    follows every Channel in the database and this branch only ever updates.
    """
    from app.services.data_import_export import _import_channels

    channel = _seed_channel(session, "shared-ch")
    ensure_follow(
        session,
        channel_id=channel.id,
        user_id=other_user.id,
        next_sync_at=None,
        setting_group_id=ensure_default_group(session, user_id=other_user.id).id,
    )
    session.commit()

    _import_channels(
        session, [{"id": "shared-ch", "name": "shared-ch"}], user_id=user.id
    )
    session.commit()

    follow = get_follow(session, user_id=user.id, channel_id=channel.id)
    assert follow is not None, "the import created no follow for the importer"
    assert follow.setting_group_id is not None, (
        "the import created the importer's first follow with no group, which "
        "`_import_channels`' own docstring says nothing downstream tolerates"
    )


def test_the_scraper_skips_a_group_less_follow_instead_of_raising(
    session: Session,
    user: User,
) -> None:
    """`_prepare_channel_sync` answers `"missing"`, not an `HTTPException`.

    It runs in a queue consumer with no response to put a 500 in, and it is
    called *before* the `try` in `_sync_claimed_channel` — so the raising lookup
    escaped the message entirely rather than failing one channel and letting the
    rest of the batch through.
    """
    from app.services.sync_orchestrator import _prepare_channel_sync

    channel = _seed_channel(session, "groupless-ch")
    ensure_follow(session, channel_id=channel.id, user_id=user.id, next_sync_at=None)
    session.commit()

    status, ctx, _reason = _prepare_channel_sync(
        channel.id, user.id, sync_mode="individual"
    )

    assert status == "missing"
    assert ctx is None


def test_a_chat_id_collision_freezes_every_follower(
    session: Session,
    user: User,
    other_user: User,
) -> None:
    """Both accounts end up in their own Frozen group, not just the resolved one.

    A chat-id collision means this Channel may be about to receive another
    channel's posts, which is a fact about the handle rather than about one
    account's view of it — the same argument that widened the uniqueness index
    in this ticket's migration. It used to be automatic: `setting_group_id` was
    a Channel column, so one write froze the handle for everybody.

    Each account is parked in **its own** Frozen group. Ticket 21's cascading
    key would delete another account's group out from under them, so the second
    assertion is not decoration.
    """
    from app.services.sync_orchestrator import _freeze_channel_for_chat_id_problem

    channel = _seed_channel(session, "collide-ch")
    for account in (user, other_user):
        ensure_follow(
            session,
            channel_id=channel.id,
            user_id=account.id,
            next_sync_at=None,
            setting_group_id=ensure_default_group(session, user_id=account.id).id,
        )
    session.commit()

    _freeze_channel_for_chat_id_problem(
        session,
        channel,
        error="duplicate chat id",
        response={},
        job_source="test",
        channel_owner_id=user.id,
    )
    session.commit()
    session.expire_all()

    for account in (user, other_user):
        follow = get_follow(session, user_id=account.id, channel_id=channel.id)
        assert follow is not None
        assert follow.setting_group_id == frozen_group_id_for_user(account.id), (
            f"account {account.id} kept syncing a channel the scraper had just "
            f"declared unsafe. Freezing only the resolved owner leaves every "
            f"other follower on it, and freezes nobody when that owner has no "
            f"follow of its own."
        )
        group = session.get(ChannelSettingGroup, follow.setting_group_id)
        assert group is not None and group.user_id == account.id, (
            "an account was parked in somebody else's Frozen group; ticket 21's "
            "cascading key deletes that out from under them"
        )
