"""The follow backfill and the drift audit (ticket 04).

Both are operator tools run by hand against a live database, which is exactly
the kind of code that goes untested and then gets run once, on production, at
the worst moment. The two properties that matter are cheap to assert and
expensive to get wrong: a `--dry-run` writes nothing, and a second run is a
no-op rather than a duplicate-key crash halfway through.

## Watched to fail

* write inside the `if dry_run` branch → the dry-run test fails
* drop `on_conflict_do_nothing` from the aggregate → the second-run test fails
  with an IntegrityError instead of a clean zero
* give an ownerless channel no follow instead of the operator's → the
  ownerless test fails
* count a channel as followed when only *another* account follows it → the
  per-owner test fails
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models import User
from app.models_tg import Channel, ChannelFollow
from app.services.follows import ensure_follow
from app.services.operator import get_operator_user_id
from tests.utils.user import create_random_user

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from audit_tenancy_drift import audit  # noqa: E402
from backfill_channel_follows import backfill  # noqa: E402


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


def _channel(session: Session, channel_id: str, **kwargs) -> Channel:
    channel = Channel(
        id=channel_id,
        name=channel_id,
        setting_group_id="default-global",
        **kwargs,
    )
    session.add(channel)
    session.commit()
    return channel


def test_dry_run_writes_nothing(session: Session) -> None:
    _channel(session, "bf_dry")

    stats = backfill(dry_run=True)

    assert stats["created"] == 1
    assert session.exec(select(ChannelFollow)).all() == []


def test_backfill_creates_one_follow_per_channel(session: Session) -> None:
    operator_id = get_operator_user_id(session)
    _channel(session, "bf_a")
    _channel(session, "bf_b")

    stats = backfill()

    assert stats["created"] == 2
    follows = session.exec(select(ChannelFollow)).all()
    assert {f.channel_id for f in follows} == {"bf_a", "bf_b"}
    assert {f.user_id for f in follows} == {operator_id}


def test_running_it_twice_creates_nothing_new(session: Session) -> None:
    """Idempotent by construction, so a partial run can simply be re-run."""
    _channel(session, "bf_twice")

    first = backfill()
    second = backfill()

    assert (first["created"], second["created"]) == (1, 0)
    assert second["already_present"] == 1
    assert len(session.exec(select(ChannelFollow)).all()) == 1


def test_an_ownerless_channel_goes_to_the_operator(session: Session) -> None:
    """`Channel.user_id` is nullable and plenty of rows predate the stamp."""
    operator_id = get_operator_user_id(session)
    _channel(session, "bf_null", user_id=None)

    stats = backfill()

    assert stats["reassigned_to_operator"] == 1
    follow = session.get(ChannelFollow, (operator_id, "bf_null"))
    assert follow is not None


def test_an_owned_channel_keeps_its_owner(session: Session) -> None:
    account = create_random_user(session)
    _channel(session, "bf_owned", user_id=account.id)

    backfill()

    assert session.get(ChannelFollow, (account.id, "bf_owned")) is not None
    session.exec(delete(User).where(col(User.id) == account.id))
    session.commit()


def test_the_backfill_copies_the_per_user_columns(session: Session) -> None:
    operator_id = get_operator_user_id(session)
    _channel(
        session,
        "bf_copy",
        tags=["x"],
        followed_at=42,
        start_id=3,
        next_regular_sync_at=777,
    )

    backfill()

    follow = session.get(ChannelFollow, (operator_id, "bf_copy"))
    assert follow is not None
    assert (follow.tags, follow.followed_at, follow.start_id) == (["x"], 42, 3)
    assert follow.next_sync_at == 777


def test_batching_covers_every_channel(session: Session) -> None:
    """The batch loop has an off-by-one shape; a batch size of 1 finds it.

    Paging with `offset`/`limit` over a table the same transaction is writing to
    is the kind of loop that silently skips rows, and 500 channels of test data
    to prove otherwise would be absurd — shrinking the batch is the same test.
    """
    for i in range(5):
        _channel(session, f"bf_batch_{i}")

    stats = backfill(batch_size=1)

    assert stats["created"] == 5


def test_the_audit_reports_channels_with_no_follow(session: Session) -> None:
    _channel(session, "audit_lonely")

    findings = audit()

    assert findings["channels_with_no_follow"] == 1


def test_the_audit_is_clean_after_the_backfill(session: Session) -> None:
    _channel(session, "audit_ok")

    backfill()
    findings = audit()

    assert "channels_with_no_follow" not in findings


def test_the_audit_counts_a_null_owner_as_drift(session: Session) -> None:
    """The old `Channel.user_id` stamp, which ticket 22 drops.

    Still worth counting until then: it is how you tell whether anything still
    depends on the column before dropping it.
    """
    _channel(session, "audit_null", user_id=None)

    findings = audit()

    assert findings["tg_channels.null_owner"] == 1


def test_a_channel_followed_by_someone_else_is_still_unfollowed_by_you(
    session: Session,
) -> None:
    """`channel_ids_without_follows` asks "does *anyone* follow this", on purpose.

    That is the right question for the backfill and for ticket 05's retention,
    and the wrong one for a user's channel list — which is why the read paths in
    tickets 15-16 go through the tenancy seam's EXISTS rather than this helper.
    """
    account = create_random_user(session)
    _channel(session, "audit_theirs")
    ensure_follow(session, channel_id="audit_theirs", user_id=account.id)
    session.commit()

    findings = audit()

    assert "channels_with_no_follow" not in findings
    session.exec(delete(User).where(col(User.id) == account.id))
    session.commit()
