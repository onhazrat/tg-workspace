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
from app.services.follows import ensure_follow, get_operator_user_id
from tests.utils.user import create_random_user

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from audit_tenancy_drift import (  # noqa: E402
    AWAITING_COLLECTION,
    audit,
    drift_only,
)
from backfill_channel_follows import (  # noqa: E402
    already_completed,
    backfill,
)


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


def _channel(session: Session, channel_id: str, **kwargs) -> Channel:
    # No `setting_group_id`: ticket 22 dropped it from the Channel, and the
    # backfill no longer has one to copy.
    channel = Channel(
        id=channel_id,
        name=channel_id,
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


def test_every_backfilled_channel_goes_to_the_operator(session: Session) -> None:
    """There is no per-Channel owner left to prefer (ticket 22).

    This used to be two tests — an unowned Channel went to the operator and an
    owned one kept its stamp. `Channel.user_id` recorded who scraped a handle
    first, which was never the same question as who follows it, and it is gone.

    Nothing is lost in practice: ticket 21 closed every path that creates a
    Channel without a Follow before flipping enforcement, so a Channel this
    script still finds unfollowed can only come from a backup predating ticket
    04 — which has one account's data in it. A second account is seeded here
    anyway, because it is the only thing that could show the operator rule being
    applied to somebody else's row.
    """
    operator_id = get_operator_user_id(session)
    stranger = create_random_user(session)
    _channel(session, "bf_null")

    stats = backfill()

    assert stats["reassigned_to_operator"] == 1
    assert session.get(ChannelFollow, (operator_id, "bf_null")) is not None
    assert session.get(ChannelFollow, (stranger.id, "bf_null")) is None

    session.exec(delete(User).where(col(User.id) == stranger.id))
    session.commit()


def test_the_backfilled_follow_starts_empty_but_keeps_the_schedule(
    session: Session,
) -> None:
    """There are no per-User columns on the Channel left to copy (ticket 22).

    The follow is created with unset tags, follow date and start id, which is
    the honest row: those were one account's choices and the Channel never held
    anyone's but the first scraper's.

    **The setting group is the exception, and it is resolved rather than left
    unset.** It was copied off the Channel before ticket 22, so a bare
    `ensure_follow_for_channel` now writes NULL — and a group-less follow is
    silently unschedulable: `run_auto_sync` skips the channel for ever and
    `get_group_for_channel` answers 500. This script's only remaining caller is
    `prestart.sh --if-needed` against a restored pre-ticket-04 backup, so that
    would be every channel in the database. `/code-review` caught it; the
    behaviour is pinned in `test_follow_always_has_a_group.py` as well, from the
    other side.

    `next_sync_at` is the other survivor. It is seeded from
    `Channel.next_regular_sync_at`, a column ticket 22 keeps because the
    backward walk is shared — and a follow with no deadline reads as "due now",
    which would stampede every channel on the first tick after a backfill.
    """
    operator_id = get_operator_user_id(session)
    _channel(session, "bf_copy", next_regular_sync_at=777)

    backfill()

    follow = session.get(ChannelFollow, (operator_id, "bf_copy"))
    assert follow is not None
    assert (follow.tags, follow.followed_at, follow.start_id) == ([], None, None)
    assert follow.setting_group_id is not None
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


def test_the_audit_counts_channels_awaiting_collection(session: Session) -> None:
    """Counted, and deliberately not drift.

    Before ticket 05 a Channel could only reach zero followers through a
    backfill that had not run or a creation path that skipped its dual-write,
    so the audit called it drift. Unfollow made it the ordinary state retention
    collects, and leaving it in the strict gate would fail a healthy database
    in the window between a removal and the next retention run.
    """
    _channel(session, "audit_lonely")

    findings = audit()

    assert findings[AWAITING_COLLECTION] == 1
    assert AWAITING_COLLECTION not in drift_only(findings)


def test_the_audit_is_clean_after_the_backfill(session: Session) -> None:
    _channel(session, "audit_ok")

    backfill()
    findings = audit()

    assert AWAITING_COLLECTION not in findings


def test_the_audit_no_longer_counts_a_channel_owner(session: Session) -> None:
    """Ticket 22 dropped the stamp, and the audit dropped it too — on its own.

    This used to assert that an unowned Channel showed up as
    `tg_channels.null_owner`, which was how you told whether anything still
    depended on the column before removing it. Nothing does, and the column is
    gone.

    The assertion that earns its place now is about the *derivation*:
    `_owner_column_models` filters `SCOPES` with `hasattr`, so a table stops
    being audited for owners the moment its column goes rather than when
    somebody remembers to edit a list. A hard-coded list would still be
    reporting a key for a column that does not exist.
    """
    _channel(session, "audit_null")

    findings = audit()

    assert "tg_channels.null_owner" not in findings
    assert "tg_posts.null_owner" not in findings

    # Both directions, so this cannot pass because the owner scan broke
    # altogether: the tables that still stamp an owner are still audited.
    from scripts.audit_tenancy_drift import _owner_column_models

    audited = {str(model.__tablename__) for model in _owner_column_models()}
    assert "tg_summaries" in audited
    assert "tg_channels" not in audited
    assert "tg_posts" not in audited


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

    assert AWAITING_COLLECTION not in findings
    session.exec(delete(User).where(col(User.id) == account.id))
    session.commit()


# --------------------------------------------------------------------------
# `--if-needed`, the mode prestart.sh runs on every deploy
# --------------------------------------------------------------------------


def test_if_needed_runs_the_first_time(session: Session) -> None:
    _channel(session, "need_first")

    stats = backfill(if_needed=True)

    assert stats["created"] == 1
    assert already_completed(session) is True


def test_if_needed_does_nothing_once_recorded(session: Session) -> None:
    """Every deploy after the first costs one primary-key lookup."""
    _channel(session, "need_done")
    backfill(if_needed=True)

    _channel(session, "need_added_later")
    stats = backfill(if_needed=True)

    assert stats["channels"] == 0, "it should not have walked the table at all"


def test_if_needed_does_not_resurrect_an_unfollowed_channel(
    session: Session,
) -> None:
    """The reason the marker is a marker and not a "is there work?" query.

    From ticket 05 onward, unfollowing leaves a Channel with zero followers on
    purpose, until retention collects it. A deploy-time backfill that decided
    what to do by asking `channel_ids_without_follows` would hand that channel
    straight back to the operator who just removed it — silently, on the next
    deploy, in the window before retention runs.
    """
    _channel(session, "need_unfollowed")
    backfill(if_needed=True)
    session.exec(delete(ChannelFollow))
    session.commit()

    backfill(if_needed=True)

    assert session.exec(select(ChannelFollow)).all() == []


def test_a_dry_run_never_sets_the_marker(session: Session) -> None:
    """Otherwise a rehearsal would suppress the real run for good."""
    _channel(session, "need_dry")

    backfill(dry_run=True, if_needed=True)

    assert already_completed(session) is False


def test_an_interrupted_run_is_not_recorded_as_complete(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Marking before the walk finishes turns a crash into a permanent skip.

    The channels a half-run never reached would stay unfollowed forever, and
    `--if-needed` would never look at them again.
    """
    import backfill_channel_follows as module

    for i in range(3):
        _channel(session, f"need_crash_{i}")

    def _explode(*args, **kwargs):
        raise RuntimeError("connection lost")

    monkeypatch.setattr(module, "ensure_follow_for_channel", _explode)
    with pytest.raises(RuntimeError):
        backfill(if_needed=True)

    assert already_completed(session) is False


def test_an_explicit_run_ignores_the_marker(session: Session) -> None:
    """An operator asking for it by hand means it, marker or not."""
    _channel(session, "need_manual")
    backfill(if_needed=True)
    session.exec(delete(ChannelFollow))
    session.commit()

    stats = backfill()

    assert stats["created"] == 1
