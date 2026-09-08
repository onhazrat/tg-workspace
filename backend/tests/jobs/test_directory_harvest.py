"""Handles enter the Directory on their own (ticket 04, IDEA-011 D16).

Before this, the deployment only ever probed handles somebody's Discovery report
had named. The harvest sweep walks stored Posts instead, so a forward, a mention
or a `t.me` link reaches the map without anybody generating a report to drive
it — and the Operator can see what that costs.

Driven through the seams the spec already established: `discover.harvest_page`
for what a walk over Posts finds, `channel_directory.enqueue_handles` for what
lands in the queue, and `run_directory_harvest_sweep` for the tick that joins
them. Everything is observed by what the queue hands out next and what the
tally holds, never by a column layout.

## The properties that are the ticket

* A handle referenced by a Post is queued, and nobody had to ask for it.
* A handle somebody follows is **not** — sync already keeps that entry current
  for free (ticket 03's `record_sync_metadata`), so probing it here is the same
  page fetched twice by two routes.
* One Account's corpus does not starve another's out of the queue. The
  mechanism is `HARVEST_PRIORITY`: one number for every harvested handle, so
  the drain order falls through to the handle itself and cannot prefer whoever
  the cursor happened to be walking.
* The batch counts **new** handles, because a batch spent on handles already on
  the map throttles nothing.
* Probe-lane Requests are counted at deployment level and no account's ledger
  is touched.

## Watched to fail

Per `CLAUDE.md`, each assertion was mutation-tested:

* drop the `followed` filter → the followed-handle test fails
* rank harvested handles by discovery order instead of `HARVEST_PRIORITY` →
  the fairness test fails, and so does the one asserting a report's candidates
  still drain first
* count scanned Posts instead of new handles against the batch → the
  known-handles test fails
* let the sweep skip its own commit when nothing was queued → the
  no-progress test fails
* charge the probe meter to `quota.charge_requests` → the ledger test fails
* walk ascending instead of newest-first → the prompt-Post test fails
* mark the Posts in a transaction of their own → the atomicity test fails
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import delete
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.jobs.directory_harvest import run_directory_harvest_sweep
from app.models import User
from app.models_tg import DirectoryEntry, DirectoryProbeUsage, Post
from app.services.channel_directory import (
    HARVEST_PRIORITY,
    dequeue_handles,
    enqueue_handles,
    known_handles,
)
from app.services.directory_probe_usage import (
    record_probe_requests,
    requests_on,
    requests_since,
    today_utc,
)
from app.services.discover import harvest_page
from app.services.posts import bulk_upsert_posts_impl, mark_harvested
from tests.utils.setting_groups import add_test_channel
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


def _post(
    session: Session,
    channel_name: str,
    post_id: int,
    *,
    text: str = "",
    timestamp: int = 1,
    forwarded_from: str | None = None,
) -> None:
    session.add(
        Post(
            channel_name=channel_name,
            post_id=post_id,
            text=text,
            timestamp=timestamp,
            forwarded_from=forwarded_from,
        )
    )
    session.commit()


def _sweep() -> dict:
    return asyncio.run(run_directory_harvest_sweep())


def _entries() -> dict[str, DirectoryEntry]:
    with Session(engine) as session:
        return {row.handle: row for row in session.exec(select(DirectoryEntry)).all()}


def _unharvested() -> int:
    """Posts the sweep has not looked at — the whole of its progress state."""
    with Session(engine) as session:
        return len(
            session.exec(
                select(Post).where(col(Post.harvested) == False)  # noqa: E712
            ).all()
        )


# --------------------------------------------------------------------------
# The walk
# --------------------------------------------------------------------------


def test_a_forward_a_mention_and_a_link_all_reach_the_directory(
    session: Session, user: User
) -> None:
    """The three signal kinds a report counts are the three the sweep harvests.

    `post_references` is reused rather than reimplemented precisely so that this
    cannot drift: a forward is a forward on both sides.
    """
    add_test_channel(session, "t04-src", user_id=user.id)
    _post(session, "t04-src", 1, timestamp=10, forwarded_from="forwardedone")
    _post(session, "t04-src", 2, timestamp=20, text="see @mentionedone for more")
    _post(session, "t04-src", 3, timestamp=30, text="https://t.me/linkedonehere")

    result = _sweep()

    assert result["queued"] == 3
    assert set(_entries()) == {"forwardedone", "mentionedone", "linkedonehere"}


def test_nobody_had_to_ask(session: Session, user: User) -> None:
    """No report, no candidate list, no request — the tick is the whole trigger.

    This is the user story the ticket exists for: the map fills in without an
    Account generating scans to drive it.
    """
    add_test_channel(session, "t04-quiet", user_id=user.id)
    _post(session, "t04-quiet", 1, timestamp=10, forwarded_from="unaskedfor")

    _sweep()

    with Session(engine) as fresh:
        assert dequeue_handles(fresh, limit=10) == ["unaskedfor"]


def test_a_channel_never_harvests_itself(session: Session, user: User) -> None:
    """`post_references` drops self-references, and the sweep inherits that."""
    add_test_channel(session, "t04-selfref", user_id=user.id)
    _post(session, "t04-selfref", 1, timestamp=10, text="we are @t04-selfref")

    _sweep()

    assert "t04-selfref" not in _entries()


# --------------------------------------------------------------------------
# What it refuses to enqueue
# --------------------------------------------------------------------------


def test_a_followed_handle_is_skipped(session: Session, user: User) -> None:
    """Sync already keeps a followed Channel's entry current for nothing.

    `record_sync_metadata` (ticket 03) writes the Directory from the metadata
    every sync page already carries, so harvesting a followed handle here is the
    same page fetched twice by two routes — and the sync route is both cheaper
    and more frequent.
    """
    add_test_channel(session, "t04-watcher", user_id=user.id)
    add_test_channel(session, "t04-followed", user_id=user.id)
    _post(session, "t04-watcher", 1, timestamp=10, forwarded_from="t04-followed")
    _post(session, "t04-watcher", 2, timestamp=20, forwarded_from="t04-stranger")

    _sweep()

    entries = _entries()
    assert "t04-stranger" in entries
    assert "t04-followed" not in entries


def test_a_second_account_following_it_is_enough(
    session: Session, user: User, other_user: User
) -> None:
    """ "Somebody follows it" is deployment-wide, not "the walker follows it".

    The Directory is corpus-wide and so is the sync that keeps it current: it
    does not matter *whose* follow causes the Channel to be synced, only that
    one exists.
    """
    add_test_channel(session, "t04-mine", user_id=user.id)
    add_test_channel(session, "t04-theirs", user_id=other_user.id)
    _post(session, "t04-mine", 1, timestamp=10, forwarded_from="t04-theirs")

    _sweep()

    assert "t04-theirs" not in _entries()


def test_a_handle_already_on_the_map_is_not_harvested_again(
    session: Session, user: User
) -> None:
    """Any row, whatever the verdict — pending is queued and conclusive is answered.

    And the batch is spent on *new* handles for this reason: a stretch of Posts
    referencing only known handles is not work, so letting it exhaust the batch
    would throttle nothing while looking like it throttled everything.
    """
    with Session(engine) as fresh:
        enqueue_handles(fresh, ["alreadyknown"])

    add_test_channel(session, "t04-repeat", user_id=user.id)
    _post(session, "t04-repeat", 1, timestamp=10, forwarded_from="alreadyknown")
    _post(session, "t04-repeat", 2, timestamp=20, forwarded_from="brandnewone")

    result = _sweep()

    assert result["queued"] == 1
    assert _entries()["alreadyknown"].priority != HARVEST_PRIORITY


def test_the_posts_beyond_the_budget_are_reached_by_the_next_tick(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Room under the ceiling stops the walk; it does not end it.

    The Posts a tick did not reach are still unharvested, so they are simply
    what the next tick with room reads first — no mark to leave behind and
    nothing to re-lap.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 50)

    add_test_channel(session, "t04-many", user_id=user.id)
    for index in range(150):
        _post(
            session,
            "t04-many",
            index + 1,
            timestamp=(index + 1) * 10,
            forwarded_from=f"harvested{index:03d}",
        )

    first = _sweep()
    # One page, because 100 new handles is already past a budget of 50.
    assert first["scanned"] == 100
    assert _unharvested() == 50

    # Clear the queue so the next tick has room again.
    with Session(engine) as fresh:
        for row in fresh.exec(select(DirectoryEntry)).all():
            fresh.delete(row)
        fresh.commit()

    second = _sweep()
    assert second["scanned"] == 50
    assert _unharvested() == 0


# --------------------------------------------------------------------------
# Fairness
# --------------------------------------------------------------------------


def test_one_accounts_corpus_does_not_starve_another_account(
    session: Session, user: User, other_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every harvested handle carries one priority, so the queue orders by handle.

    The walk is a single cursor over the corpus and knows nothing about who
    follows what, so the order it *finds* handles in is a fact about which
    Channels were being synced. Ranking by that order would hand the front of
    the queue to whichever account's Posts the cursor happened to be walking.
    At one priority `dequeue_handles` falls through to its `handle` tiebreak,
    which cannot prefer an account.
    """
    add_test_channel(session, "t04-loud", user_id=user.id)
    add_test_channel(session, "t04-modest", user_id=other_user.id)
    # The loud account's Posts are walked first and there are more of them.
    for index in range(4):
        _post(
            session,
            "t04-loud",
            index + 1,
            timestamp=(index + 1) * 10,
            forwarded_from=f"zloud{index}",
        )
    _post(session, "t04-modest", 1, timestamp=100, forwarded_from="amodest")

    _sweep()

    entries = _entries()
    assert {row.priority for row in entries.values()} == {HARVEST_PRIORITY}
    with Session(engine) as fresh:
        # Alphabetical, so the account that was walked last is served first.
        assert dequeue_handles(fresh, limit=1) == ["amodest"]


def test_a_reports_candidates_still_drain_before_harvested_handles(
    session: Session, user: User
) -> None:
    """`HARVEST_PRIORITY` sits behind a rank and ahead of a refresh.

    A handle somebody's report named is worth more than one nobody asked about;
    one nobody asked about is still an answer we have never had, which beats
    re-fetching an answer we hold.
    """
    add_test_channel(session, "t04-order", user_id=user.id)
    _post(session, "t04-order", 1, timestamp=10, forwarded_from="aharvested")
    _sweep()

    with Session(engine) as fresh:
        enqueue_handles(fresh, ["zranked"])
        assert dequeue_handles(fresh, limit=2) == ["zranked", "aharvested"]


# --------------------------------------------------------------------------
# The flag
# --------------------------------------------------------------------------


def test_a_walked_post_is_marked_and_not_walked_again(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The mark is the whole progress mechanism (ticket 05).

    Ticket 04 kept two `Post.timestamp` cursors in a settings row. A flag on the
    row it describes cannot disagree with the corpus, cannot be outrun by a
    commit landing behind it, and cannot skip a group of Posts sharing a value.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 1)

    add_test_channel(session, "t05-mark", user_id=user.id)
    _post(session, "t05-mark", 1, timestamp=20, forwarded_from="newerref")
    _post(session, "t05-mark", 2, timestamp=10, forwarded_from="olderref")

    first = _sweep()
    assert first["scanned"] == 1
    assert set(_entries()) == {"newerref"}
    assert _unharvested() == 1

    second = _sweep()
    assert second["scanned"] == 1
    assert set(_entries()) == {"newerref", "olderref"}
    assert _unharvested() == 0


def test_a_post_a_backward_sync_stored_is_reached(session: Session, user: User) -> None:
    """The property that cost ticket 04 a second mark, a wrap and a budget.

    A backward sync stores Posts with *old* timestamps, which land below a
    cursor that has already passed them — so the tail leg by construction never
    saw them and a wrapping backfill leg had to exist. Unharvested is
    unharvested whenever it arrived, so one query reaches it.
    """
    add_test_channel(session, "t05-backward", user_id=user.id)
    _post(session, "t05-backward", 2, timestamp=200, forwarded_from="recentref")

    _sweep()
    assert "recentref" in _entries()

    # A backward sync now stores an older Post, below everything already walked.
    _post(session, "t05-backward", 1, timestamp=100, forwarded_from="historicref")

    _sweep()
    assert "historicref" in _entries()


def test_a_new_post_is_harvested_before_an_old_backlog(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Newest first, which is what makes a new reference prompt.

    This is the tail leg's property without the tail leg. With a backlog still
    outstanding and a budget that cannot clear it, a Post stored a moment ago
    must still be the one the next tick reads.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 1)

    add_test_channel(session, "t05-prompt", user_id=user.id)
    for index in range(4):
        _post(
            session,
            "t05-prompt",
            index + 1,
            timestamp=(index + 1) * 10,
            forwarded_from=f"backlogref{index}",
        )

    _sweep()
    assert _unharvested() == 3

    _post(session, "t05-prompt", 99, timestamp=9999, forwarded_from="justarrived")

    result = _sweep()
    assert result["queued"] == 1
    assert "justarrived" in _entries()


def test_a_caught_up_tick_reads_no_posts(session: Session, user: User) -> None:
    """Steady state has to be free, or the job is the "pays its cost every tick,
    forever" shape `CLAUDE.md` names.

    Ticket 04's backfill leg re-lapped history at 100 Posts a tick for the life
    of the install. Here the index the tick scans is empty, not merely small.
    """
    add_test_channel(session, "t05-settled", user_id=user.id)
    for index in range(5):
        _post(session, "t05-settled", index + 1, timestamp=(index + 1) * 10)

    _sweep()
    assert _sweep()["scanned"] == 0
    assert _unharvested() == 0


def test_a_tick_that_finds_nothing_still_records_its_progress(
    session: Session, user: User
) -> None:
    """Otherwise the sweep re-reads the same stretch on every tick for ever.

    `enqueue_handles` commits, but returns early without doing so when handed
    nothing — so a tick whose Posts referenced nothing new depends on the
    sweep's own commit to keep its marks.
    """
    add_test_channel(session, "t05-silent", user_id=user.id)
    _post(session, "t05-silent", 1, timestamp=42)

    result = _sweep()

    assert result["queued"] == 0
    assert _unharvested() == 0


def test_a_post_with_no_timestamp_is_still_walked(session: Session, user: User) -> None:
    """`Post.timestamp` defaults to 0 for a row stored with no usable date.

    Ticket 04's exclusive cursor needed a sentinel of -1 so those rows were not
    invisible for ever. A flag has no sentinel to get wrong, but the row still
    has to come back — sorted last by `timestamp DESC`, not dropped.
    """
    add_test_channel(session, "t05-zero", user_id=user.id)
    _post(session, "t05-zero", 1, timestamp=0, forwarded_from="datelessref")

    _sweep()
    assert "datelessref" in _entries()


def test_the_scan_limit_bounds_a_tick_that_finds_nothing(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cost bound, which has to exist separately from the ceiling.

    Once the corpus is harvested almost every Post references only known
    handles, so a tick chasing new ones would walk the whole table before
    giving up. This is the "a scheduled job pays its cost every tick, forever"
    rule made into a number.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 3)

    add_test_channel(session, "t05-boring", user_id=user.id)
    for index in range(10):
        _post(session, "t05-boring", index + 1, timestamp=(index + 1) * 10)

    result = _sweep()

    assert result["queued"] == 0
    assert result["scanned"] <= 3


@pytest.mark.parametrize(
    ("already_pending", "expected_scanned"),
    [(0, 200), (100, 100)],
)
def test_the_new_handle_budget_is_what_is_left_under_the_ceiling(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    already_pending: int,
    expected_scanned: int,
) -> None:
    """Derived from the ceiling, not a second setting that can disagree with it.

    As `DIRECTORY_HARVEST_BATCH_SIZE` it did disagree: staging ran 1000 against
    a ceiling of 600 that is checked *before* the walk, so a tick starting at
    599 pending ended at 1599 — overshooting by 2.6x the bound that exists to
    stop ticket 03's refresh starving.

    Observed by how far the walk gets. At a ceiling of 150 with nothing pending
    the budget is 150, so the walk needs a second page; with 100 already pending
    it is 50 and the first page is already past it. A budget that ignored
    `pending` would read the same distance both times.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 150)

    if already_pending:
        with Session(engine) as fresh:
            enqueue_handles(
                fresh, [f"prefilled{i:03d}" for i in range(already_pending)]
            )

    add_test_channel(session, "t05-derived", user_id=user.id)
    for index in range(250):
        _post(
            session,
            "t05-derived",
            index + 1,
            timestamp=(index + 1) * 10,
            forwarded_from=f"budgeted{index:03d}",
        )

    assert _sweep()["scanned"] == expected_scanned


def test_a_tick_that_dies_mid_walk_loses_no_handles(
    session: Session, user: User
) -> None:
    """The marks and the enqueue are one transaction.

    Marking first and enqueueing after would make a crash between them drop
    those handles permanently: the Posts would be harvested and nothing would
    hold what they referenced.
    """
    add_test_channel(session, "t05-atomic", user_id=user.id)
    _post(session, "t05-atomic", 1, timestamp=10, forwarded_from="mustsurvive")

    with (
        patch(
            "app.jobs.directory_harvest.enqueue_handles",
            side_effect=RuntimeError("died before the commit"),
        ),
        pytest.raises(RuntimeError),
    ):
        _sweep()

    assert _unharvested() == 1
    assert _entries() == {}

    _sweep()
    assert "mustsurvive" in _entries()


def test_the_sweep_stops_adding_at_the_backlog_ceiling(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The sweep adds on a timer; the lane drains behind every sync and a
    widening proxy wait. Nothing makes those rates agree.

    Without a ceiling the backlog grows monotonically, and because a harvested
    row sorts ahead of every `REFRESH_PRIORITY` row, ticket 03's staleness
    refresh then stops being dequeued at all — silently.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 2)

    with Session(engine) as fresh:
        enqueue_handles(fresh, ["backlogone", "backlogtwo"])

    add_test_channel(session, "t05-full", user_id=user.id)
    _post(session, "t05-full", 1, timestamp=10, forwarded_from="wouldbeharvested")

    result = _sweep()

    assert result["skipped"] is True
    assert result["reason"] == "probe backlog at the ceiling"
    assert "wouldbeharvested" not in _entries()
    assert _unharvested() == 1


def test_a_refresh_is_dequeued_once_the_harvest_backlog_clears(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The property the ceiling exists to protect, asserted end to end.

    A harvested handle outranks a refresh deliberately — an answer we have never
    had beats one we hold. The ceiling is what turns that into a bounded delay
    rather than starvation.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 1)

    add_test_channel(session, "t05-starve", user_id=user.id)
    _post(session, "t05-starve", 1, timestamp=10, forwarded_from="harvestedref")
    _sweep()
    assert "harvestedref" in _entries()

    # With one handle pending the sweep is already at the ceiling and adds none.
    _post(session, "t05-starve", 2, timestamp=20, forwarded_from="wouldpileon")
    assert _sweep()["skipped"] is True
    assert "wouldpileon" not in _entries()


def test_two_ticks_do_not_overlap() -> None:
    """The lock covers the manual trigger as well as the scheduled tick.

    Two overlapping ticks would read the same unharvested Posts and harvest them
    twice — the marks are only visible to each other once committed.
    """

    async def _both() -> tuple[dict, dict]:
        return await asyncio.gather(  # type: ignore[return-value]
            run_directory_harvest_sweep(), run_directory_harvest_sweep()
        )

    first, second = asyncio.run(_both())
    assert second.get("skipped") is True or first.get("skipped") is True


# --------------------------------------------------------------------------
# The walk itself, at its own seam
# --------------------------------------------------------------------------


def test_harvest_page_returns_the_rows_it_examined(
    session: Session, user: User
) -> None:
    """`post_ids` is what the caller marks, so it has to be exactly the page.

    An empty one means there is nothing left to do — the condition that used to
    be a `None` cursor and decided whether the backfill leg wrapped.
    """
    add_test_channel(session, "t04-page", user_id=user.id)
    _post(session, "t04-page", 1, timestamp=10)

    with Session(engine) as fresh:
        page = harvest_page(fresh, limit=10)
        assert len(page.post_ids) == 1
        mark_harvested(fresh, page.post_ids)
        fresh.commit()
        assert harvest_page(fresh, limit=10).post_ids == []


def test_harvest_page_takes_the_newest_unharvested_post_first(
    session: Session, user: User
) -> None:
    """Newest first is what makes a new reference prompt with a backlog behind it."""
    add_test_channel(session, "t04-order", user_id=user.id)
    _post(session, "t04-order", 1, timestamp=10, forwarded_from="olderref")
    _post(session, "t04-order", 2, timestamp=20, forwarded_from="newerref")

    with Session(engine) as fresh:
        assert harvest_page(fresh, limit=1).handles == ["newerref"]


def test_harvest_page_dedupes_within_a_page(session: Session, user: User) -> None:
    add_test_channel(session, "t04-dupe", user_id=user.id)
    _post(session, "t04-dupe", 1, timestamp=10, forwarded_from="repeatedref")
    _post(session, "t04-dupe", 2, timestamp=20, forwarded_from="repeatedref")

    with Session(engine) as fresh:
        assert harvest_page(fresh, limit=10).handles == ["repeatedref"]


def test_known_handles_answers_for_every_verdict(session: Session) -> None:
    """Pending or conclusive, the handle is already on the map."""
    with Session(engine) as fresh:
        enqueue_handles(fresh, ["pendingone"])
        assert known_handles(fresh, {"pendingone", "neverseen"}) == {"pendingone"}


# --------------------------------------------------------------------------
# What the crawl costs
# --------------------------------------------------------------------------


def test_the_tally_accumulates_across_probes() -> None:
    """Every probe that finishes today lands on the same row.

    `= excluded.requests` would leave the table holding the size of the most
    recent probe, which looks entirely reasonable and is not what was spent.
    """
    with Session(engine) as fresh:
        record_probe_requests(fresh, 3)
        record_probe_requests(fresh, 4)
        assert requests_on(fresh) == 7


def test_a_charge_of_zero_writes_no_row() -> None:
    """A row of zero is indistinguishable from a real day with no probing."""
    with Session(engine) as fresh:
        record_probe_requests(fresh, 0)
        assert fresh.get(DirectoryProbeUsage, today_utc()) is None


def test_the_window_totals_the_days_inside_it() -> None:
    today = today_utc()
    with Session(engine) as fresh:
        record_probe_requests(fresh, 5, day=today)
        record_probe_requests(fresh, 6, day=today - timedelta(days=3))
        record_probe_requests(fresh, 7, day=today - timedelta(days=30))

        assert requests_since(fresh, today - timedelta(days=6)) == 11


def test_the_tally_has_no_owner_and_touches_no_ledger() -> None:
    """A deployment-level count, and deliberately not a fourth Budget.

    The three Budgets derive totally from `SyncJobState.sync_mode`, so there is
    no mode a fourth could come from; and charging an account for corpus work is
    what splitting the three exists to prevent. The table's primary key being
    the day alone is that claim as a schema constraint.
    """
    from app.models_tg import QuotaUsage

    assert {c.name for c in DirectoryProbeUsage.__table__.primary_key.columns} == {
        "day"
    }
    assert "user_id" not in DirectoryProbeUsage.__table__.columns

    with Session(engine) as fresh:
        record_probe_requests(fresh, 9)
        assert fresh.exec(select(QuotaUsage)).all() == []


def test_the_tally_is_on_neither_retention_inventory() -> None:
    """Kept for ever, like the quota ledger it is modelled on.

    365 rows a year, and it is the only record an Operator has of what the crawl
    cost. `run_retention_cleanup` and `stats.clear_table` both work from
    explicit inventories, so absence from them has to be asserted rather than
    assumed.
    """
    from pathlib import Path

    retention = Path("app/jobs/retention.py").read_text()
    assert "DirectoryProbeUsage" not in retention
    assert "tg_directory_probe_usage" not in retention


def test_draining_the_probe_lane_lands_on_the_deployment_tally() -> None:
    """The consumer meters, and the total reaches the table an Operator reads.

    The meter is the same `core/request_meter.py` the sync path uses, so the two
    numbers are in the same unit — Requests to the Telegram web view, counted
    inside `fetch_with_retry` — rather than one being requests and the other
    being probes.

    Driven through `_process_probe_message` rather than through
    `probe_one_handle`, because the metering is a property of *draining the
    lane*: the probe function is also called by tests and by the recheck path,
    and only the lane knows a message is being consumed.
    """
    from app.core.request_meter import record_telegram_request
    from app.jobs.sync_queue import _process_probe_message
    from app.services import pgmq

    async def _probe(handle: str) -> str:
        record_telegram_request()
        record_telegram_request()
        return "ok"

    msg = pgmq.PgmqMessage(msg_id=1, read_ct=1, message={"handle": "metered"})

    with patch("app.jobs.discover_probe.probe_one_handle", side_effect=_probe):
        asyncio.run(_process_probe_message(msg))

    with Session(engine) as fresh:
        assert requests_on(fresh) == 2


def test_a_probe_that_raises_still_pays_for_what_it_fetched() -> None:
    """Charged from a `finally`, exactly as the sync path is.

    Losing a failed probe's Requests would under-report precisely the traffic an
    Operator is watching for: a crawl going wrong is a crawl whose fetches are
    failing.
    """
    from app.core.request_meter import record_telegram_request
    from app.jobs.sync_queue import _process_probe_message
    from app.services import pgmq

    async def _explode(handle: str) -> str:
        record_telegram_request()
        raise RuntimeError("proxy died mid-walk")

    msg = pgmq.PgmqMessage(msg_id=2, read_ct=1, message={"handle": "doomed"})

    with (
        patch("app.jobs.discover_probe.probe_one_handle", side_effect=_explode),
        pytest.raises(RuntimeError),
    ):
        asyncio.run(_process_probe_message(msg))

    with Session(engine) as fresh:
        assert requests_on(fresh) == 1


def test_an_edit_that_adds_a_reference_sends_the_post_back(
    session: Session, user: User
) -> None:
    """Ticket 04's wrapping backfill leg would have caught this on the next lap.

    Ticket 05 deleted that leg, so a channel editing an already-harvested Post
    to add a `t.me` link would hide that handle for ever. `bulk_upsert_posts_impl`
    clears the flag when a field `post_references` reads actually changed.
    """
    add_test_channel(session, "t05-edit", user_id=user.id)
    _post(session, "t05-edit", 1, timestamp=10, text="nothing here yet")

    _sweep()
    assert _unharvested() == 0
    assert _entries() == {}

    with Session(engine) as fresh:
        bulk_upsert_posts_impl(
            [
                {
                    "channelName": "t05-edit",
                    "id": 1,
                    "text": "now see https://t.me/editedinlater",
                    "timestamp": 10,
                }
            ],
            fresh,
        )
        fresh.commit()

    assert _unharvested() == 1
    _sweep()
    assert "editedinlater" in _entries()


def test_an_unchanged_re_upsert_does_not_send_the_post_back(
    session: Session, user: User
) -> None:
    """The condition is the whole point.

    Sync re-scrapes the newest page of every followed Channel on every run, so
    clearing the flag unconditionally would hand the harvest thousands of
    unchanged rows per sync round for ever — the "pays its cost every tick,
    forever" shape, reintroduced by the fix for the test above.
    """
    add_test_channel(session, "t05-noedit", user_id=user.id)
    _post(session, "t05-noedit", 1, timestamp=10, text="stable body")

    _sweep()
    assert _unharvested() == 0

    with Session(engine) as fresh:
        bulk_upsert_posts_impl(
            [
                {
                    "channelName": "t05-noedit",
                    "id": 1,
                    "text": "stable body",
                    "timestamp": 10,
                }
            ],
            fresh,
        )
        fresh.commit()

    assert _unharvested() == 0


def test_harvest_running_is_readable_from_the_api_process() -> None:
    """ "Harvest running" must not be answered by a lock the API cannot see.

    The obvious implementation is `_sweep_lock.locked()`, and it is wrong
    everywhere it is read. The lock is an `asyncio.Lock` belonging to whichever
    process runs the job, the scheduler runs only in `app/worker.py`, and the
    read happens in the API process serving `GET /data/discover/probe/queue`.
    That process holds its own untouched copy of the module, so the indicator
    reported "idle" through every live harvest — a green light that could never
    turn on, which is worse than no light at all.

    `lastStatus` already crosses the boundary: `_run_guarded` announces it over
    `SCHEDULER_STATUS_CHANNEL` and every process folds announcements into
    `_job_status`. So this asserts the *source*, by moving the status the way a
    worker's announcement does while leaving the lock alone, and separately that
    a held lock does **not** answer it. Together those two say the reporting
    function reads across processes rather than inside one.
    """
    from app.jobs import scheduler
    from app.jobs.directory_harvest import (
        DIRECTORY_HARVEST_JOB_ID,
        _sweep_lock,
        is_harvest_running,
    )

    before = dict(scheduler._job_status[DIRECTORY_HARVEST_JOB_ID])
    try:
        scheduler._job_status[DIRECTORY_HARVEST_JOB_ID]["lastStatus"] = "running"
        assert is_harvest_running() is True

        scheduler._job_status[DIRECTORY_HARVEST_JOB_ID]["lastStatus"] = "ok"
        assert is_harvest_running() is False

        # The lock is the worker's mutual exclusion and says nothing about what
        # any other process should report. Holding it must not flip the report.
        async def _held() -> bool:
            async with _sweep_lock:
                return is_harvest_running()

        assert asyncio.run(_held()) is False
    finally:
        scheduler._job_status[DIRECTORY_HARVEST_JOB_ID].update(before)
