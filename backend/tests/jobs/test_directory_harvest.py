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
* let `_enqueue` skip the cursor save when nothing was queued → the
  no-progress test fails
* charge the probe meter to `quota.charge_requests` → the ledger test fails
* drop the wrap on exhaustion → the backward-sync test fails
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
from app.jobs.settings import HARVEST_START, load_harvest_state
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


def test_the_batch_bounds_the_new_handles_and_the_rest_wait(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`DIRECTORY_HARVEST_BATCH_SIZE` is the throttle the ticket asks for."""
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BATCH_SIZE", 2)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 1)

    add_test_channel(session, "t04-many", user_id=user.id)
    for index in range(5):
        _post(
            session,
            "t04-many",
            index + 1,
            timestamp=(index + 1) * 10,
            forwarded_from=f"harvested{index}",
        )

    first = _sweep()
    assert first["queued"] == 2

    second = _sweep()
    assert second["queued"] == 2
    assert len(_entries()) == 4


def test_the_scan_limit_bounds_a_tick_that_finds_nothing(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cost bound, which has to exist separately from the throttle.

    Once the corpus is harvested almost every Post references only known
    handles, so a tick chasing `DIRECTORY_HARVEST_BATCH_SIZE` new ones would
    walk the whole table before giving up. This is the "a scheduled job pays its
    cost every tick, forever" rule made into a number.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BATCH_SIZE", 50)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 3)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 0)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 2)

    add_test_channel(session, "t04-boring", user_id=user.id)
    for index in range(10):
        _post(session, "t04-boring", index + 1, timestamp=(index + 1) * 10)

    result = _sweep()

    assert result["queued"] == 0
    assert result["scanned"] <= 3


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
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 100)

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
# The cursor
# --------------------------------------------------------------------------


def test_the_tail_advances_so_the_next_tick_reads_new_posts(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 1)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 0)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 1)

    add_test_channel(session, "t04-cursor", user_id=user.id)
    _post(session, "t04-cursor", 1, timestamp=10, forwarded_from="firstfound")
    _post(session, "t04-cursor", 2, timestamp=20, forwarded_from="secondfound")

    first = _sweep()
    assert first["tail"] == 10
    assert set(_entries()) == {"firstfound"}

    second = _sweep()
    assert second["tail"] == 20
    assert set(_entries()) == {"firstfound", "secondfound"}


def test_a_post_that_arrives_after_the_tail_is_harvested_on_the_next_tick(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The property the single-mark first draft did not have.

    With one mark the walk wrapped the moment it reached the end, so a Post
    stored today waited a full lap of the corpus — days on a large one — before
    anything looked at it. The tail leg makes it the very next tick.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 0)

    add_test_channel(session, "t04-tail", user_id=user.id)
    _post(session, "t04-tail", 1, timestamp=100, forwarded_from="oldref")
    _sweep()

    _post(session, "t04-tail", 2, timestamp=200, forwarded_from="arrivedlater")

    result = _sweep()
    assert result["queued"] == 1
    assert "arrivedlater" in _entries()


def test_a_caught_up_tail_costs_one_empty_query(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Steady state has to be cheap, or the job is the "pays its cost every
    tick, forever" shape `CLAUDE.md` names.

    With the backfill leg switched off, a tick with nothing new must read no
    Posts at all — not re-read the corpus to discover that.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 0)

    add_test_channel(session, "t04-settled", user_id=user.id)
    for index in range(5):
        _post(session, "t04-settled", index + 1, timestamp=(index + 1) * 10)

    _sweep()
    assert _sweep()["scanned"] == 0


def test_a_tick_that_finds_nothing_still_records_its_progress(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Otherwise the sweep re-reads the same stretch on every tick for ever.

    That is the shape of a job that costs the same every tick and achieves
    nothing, which this repo has already paid for once.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 1)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 1)

    add_test_channel(session, "t04-silent", user_id=user.id)
    _post(session, "t04-silent", 1, timestamp=42)

    result = _sweep()

    assert result["queued"] == 0
    with Session(engine) as fresh:
        assert load_harvest_state(fresh)[0] == 42


def test_the_backfill_leg_reaches_a_post_a_backward_sync_stored(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A backward walk stores Posts *below* a tail that has already passed.

    The tail leg by construction never sees them, so without the backfill leg
    every handle referenced in fetched history would be permanently invisible.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 10)

    add_test_channel(session, "t04-wrap", user_id=user.id)
    _post(session, "t04-wrap", 2, timestamp=200, forwarded_from="recentref")

    first = _sweep()
    assert first["tail"] == 200
    assert "recentref" in _entries()

    # A backward sync now stores an older Post. Its timestamp is below the tail.
    _post(session, "t04-wrap", 1, timestamp=100, forwarded_from="historicref")

    _sweep()
    assert "historicref" in _entries()


def test_the_backfill_wraps_and_the_tail_never_does(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two marks, and only one of them goes backwards.

    A tail that wrapped would re-walk the whole corpus to find new Posts; a
    backfill that parked would stop seeing new history. Each leg's end is
    handled the way that leg needs.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 10)

    add_test_channel(session, "t04-legs", user_id=user.id)
    _post(session, "t04-legs", 1, timestamp=100, forwarded_from="onlyref")

    result = _sweep()

    assert result["tail"] == 100
    assert result["wrapped"] is True
    assert result["cursor"] == HARVEST_START


def test_the_backfill_leg_has_its_own_budget(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """It never finishes, so its cost is paid on every tick for ever.

    Letting it spend the whole scan limit is what made the single-mark draft
    re-read the corpus every five minutes to find nothing.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 100)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 2)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 1)

    add_test_channel(session, "t04-budget", user_id=user.id)
    for index in range(10):
        _post(session, "t04-budget", index + 1, timestamp=(index + 1) * 10)

    # First tick: the tail leg walks all ten and the backfill has nothing below
    # it yet. Second tick: the tail is caught up, so only the backfill runs.
    _sweep()
    assert _sweep()["scanned"] == 2


def test_a_post_with_no_timestamp_is_still_walked(session: Session, user: User) -> None:
    """`Post.timestamp` defaults to 0 for a row stored with no usable date.

    The mark is exclusive, so a sentinel of `0` would make those rows invisible
    to every pass for ever. `HARVEST_START` is -1 for exactly this.
    """
    add_test_channel(session, "t04-zero", user_id=user.id)
    _post(session, "t04-zero", 1, timestamp=0, forwarded_from="datelessref")

    _sweep()
    assert "datelessref" in _entries()


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

    add_test_channel(session, "t04-full", user_id=user.id)
    _post(session, "t04-full", 1, timestamp=10, forwarded_from="wouldbeharvested")

    result = _sweep()

    assert result["skipped"] is True
    assert result["reason"] == "probe backlog at the ceiling"
    assert "wouldbeharvested" not in _entries()


def test_a_refresh_is_dequeued_once_the_harvest_backlog_clears(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The property the ceiling exists to protect, asserted end to end.

    A harvested handle outranks a refresh deliberately — an answer we have never
    had beats one we hold. The ceiling is what turns that into a bounded delay
    rather than starvation.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 1)

    add_test_channel(session, "t04-starve", user_id=user.id)
    _post(session, "t04-starve", 1, timestamp=10, forwarded_from="harvestedref")
    _sweep()
    assert "harvestedref" in _entries()

    # With one handle pending the sweep is already at the ceiling and adds none.
    _post(session, "t04-starve", 2, timestamp=20, forwarded_from="wouldpileon")
    assert _sweep()["skipped"] is True
    assert "wouldpileon" not in _entries()


def test_a_corrupt_mark_restarts_rather_than_breaking_the_job(
    session: Session, user: User
) -> None:
    """The sweep is idempotent, so restarting costs one cycle; raising costs the job."""
    from app.jobs.settings import save_settings_section
    from app.services.settings_registry import DIRECTORY_RUNTIME_KEY

    with Session(engine) as fresh:
        save_settings_section(
            fresh,
            DIRECTORY_RUNTIME_KEY,
            {"harvestTail": "not a number", "harvestCursor": None},
        )
        assert load_harvest_state(fresh) == (HARVEST_START, HARVEST_START)

    add_test_channel(session, "t04-corrupt", user_id=user.id)
    _post(session, "t04-corrupt", 1, timestamp=10, forwarded_from="stillfound")

    _sweep()
    assert "stillfound" in _entries()


def test_two_ticks_do_not_overlap() -> None:
    """The lock covers the manual trigger as well as the scheduled tick.

    Two overlapping ticks would read the same cursor and harvest the same Posts.
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


def test_harvest_page_reports_the_end_of_the_corpus_as_no_cursor(
    session: Session, user: User
) -> None:
    """`None` is "there is nothing after this", which is what decides the wrap.

    Distinct from "the cursor did not move", which is a page that read Posts
    referencing nothing.
    """
    add_test_channel(session, "t04-page", user_id=user.id)
    _post(session, "t04-page", 1, timestamp=10)

    with Session(engine) as fresh:
        assert harvest_page(fresh, after=0, limit=10).cursor == 10
        assert harvest_page(fresh, after=10, limit=10).cursor is None


def test_harvest_page_dedupes_within_a_page(session: Session, user: User) -> None:
    add_test_channel(session, "t04-dupe", user_id=user.id)
    _post(session, "t04-dupe", 1, timestamp=10, forwarded_from="repeatedref")
    _post(session, "t04-dupe", 2, timestamp=20, forwarded_from="repeatedref")

    with Session(engine) as fresh:
        assert harvest_page(fresh, after=0, limit=10).handles == ["repeatedref"]


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


def test_the_backfill_leg_never_reads_past_the_tail(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`until` is what keeps the two legs from doing each other's work.

    Unbounded, the backfill would walk to the end of the corpus every lap —
    re-reading exactly the Posts the tail leg is there to reach, and spending
    the budget that exists for history on the newest rows instead.

    Observed by what it harvests rather than by a row count: with the tail
    deliberately left behind, a Post above it must stay unharvested until the
    tail leg gets to it.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 1)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 1)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 0)

    add_test_channel(session, "t04-until", user_id=user.id)
    _post(session, "t04-until", 1, timestamp=10, forwarded_from="firstbelow")
    _post(session, "t04-until", 2, timestamp=20, forwarded_from="secondbelow")
    _post(session, "t04-until", 3, timestamp=30, forwarded_from="thirdabove")
    _post(session, "t04-until", 4, timestamp=40, forwarded_from="fourthabove")

    first = _sweep()
    assert first["tail"] == 10

    # The tail is at 10 and the backfill now has a budget big enough for the
    # whole corpus. Bounded by the tail it reaches nothing new; unbounded it
    # would harvest both Posts above it.
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 10)
    second = _sweep()
    assert second["tail"] == 20

    entries = _entries()
    assert "thirdabove" not in entries
    assert "fourthabove" not in entries


def test_the_backfill_makes_progress_while_the_tail_leg_is_saturated(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The starvation the leftover budget caused, asserted directly.

    On a deployment where new Posts arrive faster than the tail leg's budget,
    "whatever the tail leg did not use" is always nothing — so the backfill
    would never run, and a handle referenced only in Posts a backward sync
    fetched would never be seen at all. The leg has its own budget for that
    reason, and here the tail leg is deliberately saturated.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_SCAN_LIMIT", 1)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT", 1)
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_PAGE_SIZE", 1)

    add_test_channel(session, "t04-saturated", user_id=user.id)
    for index in range(5):
        _post(session, "t04-saturated", index + 1, timestamp=(index + 1) * 10)

    result = _sweep()

    # The tail leg spent its whole budget on the first Post, so a leftover
    # budget would be zero and the backfill mark would not have moved.
    assert result["tail"] == 10
    assert result["cursor"] != HARVEST_START
