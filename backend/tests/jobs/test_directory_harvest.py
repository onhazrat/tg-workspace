"""Handles enter the Directory on their own (ticket 04, IDEA-011 D16; DDS-02).

Before ticket 04 the deployment only ever probed handles somebody's Discovery
report had named. The harvest sweep fills the map without anybody generating a
report to drive it, and the Operator can see what that costs.

Since DDS-02 the sweep reads **References** rather than walking Posts. The
graph already holds every handle a stored Post names, and a Directory sample
names more, so a handle an unfollowed Channel cites reaches the queue too and
the crawl is recursive.

Driven through one seam, the tick (`run_directory_harvest_sweep`). Inputs go in
through the real write paths only: Posts as rows the extraction walk reads,
samples through `record_probe_result`. No test writes a Reference by hand, so
extraction and enqueue are exercised together, the way production runs them.
Everything is observed by what the queue hands out next and what the tally
holds, never by a column layout.

## The properties that are the ticket

* A handle a stored Post references is queued, and nobody had to ask for it.
* So is a handle a Directory sample references, unless the switch is off, and
  then the queue is exactly what the followed Posts alone produce.
* A handle somebody follows is **not**: sync already keeps that entry current
  for free (ticket 03's `record_sync_metadata`).
* One Account's corpus does not starve another's out of the queue, because
  every queued handle carries `HARVEST_PRIORITY` and the drain order falls
  through to the handle itself.
* The batch counts **new** handles, and a handle the ceiling turned away is
  queued by a later tick rather than lost.

## Watched to fail

Per `CLAUDE.md`, each assertion was mutation-tested:

* drop the `followed` filter → the followed-handle tests fail
* ignore the switch → the switch-off test fails
* drop the Directory anti-join → the budget test fails (`enqueue_handles`
  already skips known rows, so only the `LIMIT` notices)
* rank queued handles by discovery order instead of `HARVEST_PRIORITY` →
  the fairness test fails, and so does the one asserting a report's candidates
  still drain first
* stop the upsert clearing `references_extracted` on an edit → the edit test
  fails
* order by handle instead of newest Reference → the prompt-Post test fails
"""

from __future__ import annotations

import asyncio
import itertools
from datetime import timedelta
from typing import Any
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
    record_probe_result,
)
from app.services.directory_probe_usage import (
    record_probe_requests,
    requests_on,
    requests_since,
    today_utc,
)
from app.services.posts import bulk_upsert_posts_impl
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

#: A Reference is keyed by its source's chat id (ADR-019 Decision 2), so every
#: followed Channel a test seeds needs one of its own, or its Posts are deferred
#: rather than extracted and nothing reaches the queue.
_chat_ids = itertools.count(9_100_000)


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


def _follow(session: Session, name: str, user: User) -> None:
    add_test_channel(session, name, user_id=user.id, telegram_chat_id=next(_chat_ids))


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


def _probe(handle: str, *samples: dict[str, Any]) -> None:
    """A probe of an unfollowed Channel whose preview page carried `samples`."""
    with Session(engine) as fresh:
        record_probe_result(
            fresh,
            handle,
            {
                "isTelegramPage": True,
                "kind": "channel",
                "telegramChatId": next(_chat_ids),
                "latestId": len(samples),
                "samples": list(samples),
            },
        )


def _sample(post_id: int, text: str) -> dict[str, Any]:
    return {"id": post_id, "text": text, "timestamp": post_id * 10}


def _sweep() -> dict:
    return asyncio.run(run_directory_harvest_sweep())


def _entries() -> dict[str, DirectoryEntry]:
    with Session(engine) as session:
        return {row.handle: row for row in session.exec(select(DirectoryEntry)).all()}


def _pending_handles() -> set[str]:
    return {h for h, row in _entries().items() if row.status == "unknown"}


def _clear_queue() -> None:
    with Session(engine) as fresh:
        for row in fresh.exec(
            select(DirectoryEntry).where(col(DirectoryEntry.status) == "unknown")
        ).all():
            fresh.delete(row)
        fresh.commit()


def _unextracted() -> int:
    with Session(engine) as session:
        return len(
            session.exec(
                select(Post).where(col(Post.references_extracted) == False)  # noqa: E712
            ).all()
        )


# --------------------------------------------------------------------------
# What reaches the queue
# --------------------------------------------------------------------------


def test_a_forward_a_mention_and_a_link_all_reach_the_directory(
    session: Session, user: User
) -> None:
    """The three signal kinds a report counts are the three the sweep queues.

    The graph's extractor is a sibling of `discover.post_references`, and
    `test_post_references.py` asserts the two agree, so a forward is a forward
    on both sides.
    """
    _follow(session, "t04-src", user)
    _post(session, "t04-src", 1, timestamp=10, forwarded_from="forwardedone")
    _post(session, "t04-src", 2, timestamp=20, text="see @mentionedone for more")
    _post(session, "t04-src", 3, timestamp=30, text="https://t.me/linkedonehere")

    result = _sweep()

    assert result["queued"] == 3
    assert set(_entries()) == {"forwardedone", "mentionedone", "linkedonehere"}


def test_nobody_had_to_ask(session: Session, user: User) -> None:
    """No report, no candidate list, no request: the tick is the whole trigger."""
    _follow(session, "t04-quiet", user)
    _post(session, "t04-quiet", 1, timestamp=10, forwarded_from="unaskedfor")

    _sweep()

    with Session(engine) as fresh:
        assert dequeue_handles(fresh, limit=10) == ["unaskedfor"]


def test_a_channel_never_queues_itself(session: Session, user: User) -> None:
    """The extractor drops self-references, and the sweep inherits that."""
    _follow(session, "t04-selfref", user)
    _post(session, "t04-selfref", 1, timestamp=10, text="we are @t04-selfref")

    _sweep()

    assert "t04-selfref" not in _entries()


def test_a_post_a_backward_sync_stored_is_reached(session: Session, user: User) -> None:
    """An old Post stored after newer ones still reaches the queue.

    A backward sync stores Posts with old timestamps below everything already
    extracted. The References table has no order to fall behind: whatever the
    extraction walk writes, the next tick reads.
    """
    _follow(session, "t05-backward", user)
    _post(session, "t05-backward", 2, timestamp=200, forwarded_from="recentref")
    _sweep()
    assert "recentref" in _entries()

    _post(session, "t05-backward", 1, timestamp=100, forwarded_from="historicref")
    _sweep()
    assert "historicref" in _entries()


# --------------------------------------------------------------------------
# Samples: the crawl past one hop (DDS-02)
# --------------------------------------------------------------------------


def test_a_handle_a_sample_names_is_queued() -> None:
    """The source nobody follows. The probe already fetched this page.

    Before DDS-02 a sample's References were written to the graph and its
    handles went nowhere, so the Directory stopped one hop from the follows.
    """
    _probe("t02-unfollowed", _sample(1, "more at @deepfind"))

    _sweep()

    assert "deepfind" in _pending_handles()


def test_the_crawl_is_recursive() -> None:
    """A queued handle's own probe feeds the next tick, with nobody asking."""
    _probe("t02-first", _sample(1, "try @hopone"))
    _sweep()
    assert "hopone" in _pending_handles()

    _probe("hopone", _sample(1, "and @hoptwo"))
    _sweep()
    assert "hoptwo" in _pending_handles()


def test_a_refresh_brings_in_what_the_channel_cited_since() -> None:
    """Refresh re-probes a live entry, and its new samples feed the queue."""
    _probe("t02-refreshed", _sample(1, "old news from @citedbefore"))
    _sweep()

    _probe("t02-refreshed", _sample(2, "new from @citedsince"))
    _sweep()

    assert {"citedbefore", "citedsince"} <= set(_entries())


def test_with_the_switch_off_only_followed_posts_feed_the_queue(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Off is a true rollback: exactly what the Post walk used to queue."""
    monkeypatch.setattr(settings, "DIRECTORY_FOLLOW_SAMPLE_REFERENCES", False)

    _follow(session, "t02-read", user)
    _post(session, "t02-read", 1, timestamp=10, forwarded_from="fromthefeed")
    _probe("t02-stranger", _sample(1, "see @fromasample"))

    _sweep()

    assert _pending_handles() == {"fromthefeed"}


# --------------------------------------------------------------------------
# What it refuses to enqueue
# --------------------------------------------------------------------------


def test_a_followed_handle_is_skipped(session: Session, user: User) -> None:
    """Sync already keeps a followed Channel's entry current for nothing.

    `record_sync_metadata` (ticket 03) writes the Directory from the metadata
    every sync page already carries, so queueing a followed handle here is the
    same page fetched twice by two routes.
    """
    _follow(session, "t04-watcher", user)
    _follow(session, "t04-followed", user)
    _post(session, "t04-watcher", 1, timestamp=10, forwarded_from="t04-followed")
    _post(session, "t04-watcher", 2, timestamp=20, forwarded_from="t04-stranger")

    _sweep()

    entries = _entries()
    assert "t04-stranger" in entries
    assert "t04-followed" not in entries


def test_a_followed_handle_a_sample_names_is_skipped(
    session: Session, user: User
) -> None:
    """The follow filter applies to the sample source too."""
    _follow(session, "t02-mine", user)
    _probe("t02-elsewhere", _sample(1, "subscribe to @t02-mine"))

    _sweep()

    assert "t02-mine" not in _entries()


def test_a_second_account_following_it_is_enough(
    session: Session, user: User, other_user: User
) -> None:
    """ "Somebody follows it" is deployment-wide, not "the source's follower"."""
    _follow(session, "t04-mine", user)
    _follow(session, "t04-theirs", other_user)
    _post(session, "t04-mine", 1, timestamp=10, forwarded_from="t04-theirs")

    _sweep()

    assert "t04-theirs" not in _entries()


def test_a_handle_already_on_the_map_is_not_queued_again(
    session: Session, user: User
) -> None:
    """Any row, whatever the verdict: pending is queued and conclusive is answered.

    And the batch is spent on *new* handles for this reason: a graph full of
    References to known handles is not work, so letting them exhaust the batch
    would throttle nothing while looking like it throttled everything.
    """
    with Session(engine) as fresh:
        enqueue_handles(fresh, ["alreadyknown"])

    _follow(session, "t04-repeat", user)
    _post(session, "t04-repeat", 1, timestamp=10, forwarded_from="alreadyknown")
    _post(session, "t04-repeat", 2, timestamp=20, forwarded_from="brandnewone")

    result = _sweep()

    assert result["queued"] == 1
    assert _entries()["alreadyknown"].priority != HARVEST_PRIORITY


# --------------------------------------------------------------------------
# Fairness and order
# --------------------------------------------------------------------------


def test_one_accounts_corpus_does_not_starve_another_account(
    session: Session, user: User, other_user: User
) -> None:
    """Every queued handle carries one priority, so the queue orders by handle.

    Ranking by the order the sweep found handles in would hand the front of the
    queue to whichever account's Posts were extracted first. At one priority
    `dequeue_handles` falls through to its `handle` tiebreak, which cannot
    prefer an account.
    """
    _follow(session, "t04-loud", user)
    _follow(session, "t04-modest", other_user)
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
        assert dequeue_handles(fresh, limit=1) == ["amodest"]


def test_a_reports_candidates_still_drain_before_harvested_handles(
    session: Session, user: User
) -> None:
    """`HARVEST_PRIORITY` sits behind a rank and ahead of a refresh."""
    _follow(session, "t04-order", user)
    _post(session, "t04-order", 1, timestamp=10, forwarded_from="aharvested")
    _sweep()

    with Session(engine) as fresh:
        enqueue_handles(fresh, ["zranked"])
        assert dequeue_handles(fresh, limit=2) == ["zranked", "aharvested"]


# --------------------------------------------------------------------------
# The ceiling
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("already_pending", "expected_queued"),
    [(0, 150), (100, 50)],
)
def test_the_new_handle_budget_is_what_is_left_under_the_ceiling(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    already_pending: int,
    expected_queued: int,
) -> None:
    """Derived from the ceiling, not a second setting that can disagree with it."""
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 150)

    if already_pending:
        with Session(engine) as fresh:
            enqueue_handles(
                fresh, [f"prefilled{i:03d}" for i in range(already_pending)]
            )

    _follow(session, "t05-derived", user)
    for index in range(250):
        _post(
            session,
            "t05-derived",
            index + 1,
            timestamp=(index + 1) * 10,
            forwarded_from=f"budgeted{index:03d}",
        )

    assert _sweep()["queued"] == expected_queued


def test_known_targets_do_not_spend_the_budget(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The anti-join is what makes the budget count new handles.

    `enqueue_handles` already ignores a known handle, so dropping the Directory
    anti-join changes nothing about *what* is queued. It changes what the
    `LIMIT` is spent on: known targets sorting first would fill every slot and
    the new one behind them would never be reached.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 3)
    for handle in ("aaknown1", "aaknown2", "aaknown3"):
        _probe(handle)

    _follow(session, "t02-budget", user)
    for index, handle in enumerate(("aaknown1", "aaknown2", "aaknown3", "zznew")):
        _post(session, "t02-budget", index + 1, timestamp=10, forwarded_from=handle)

    assert _sweep()["queued"] == 1
    assert "zznew" in _pending_handles()


def test_the_sweep_stops_adding_at_the_backlog_ceiling(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The sweep adds on a timer; the lane drains behind every sync and a
    widening proxy wait. Nothing makes those rates agree.

    Without a ceiling the backlog grows monotonically, and because a queued
    row sorts ahead of every `REFRESH_PRIORITY` row, ticket 03's staleness
    refresh then stops being dequeued at all, silently.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 2)

    with Session(engine) as fresh:
        enqueue_handles(fresh, ["backlogone", "backlogtwo"])

    _follow(session, "t05-full", user)
    _post(session, "t05-full", 1, timestamp=10, forwarded_from="wouldbequeued")

    result = _sweep()

    assert result["skipped"] is True
    assert result["reason"] == "probe backlog at the ceiling"
    assert "wouldbequeued" not in _entries()


def test_a_handle_the_ceiling_turned_away_is_queued_later(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A full queue delays a handle; it never loses one.

    The Reference outlives the tick that could not queue it, so the next tick
    with room finds the same target still unknown.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 1)

    with Session(engine) as fresh:
        enqueue_handles(fresh, ["blocking"])

    _follow(session, "t02-later", user)
    _post(session, "t02-later", 1, timestamp=10, forwarded_from="patientone")
    assert _sweep()["skipped"] is True

    _clear_queue()

    _sweep()
    assert "patientone" in _entries()


def test_a_new_post_is_queued_before_an_old_backlog(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Newest Reference first, which is what makes a new reference prompt.

    With more unknown targets than the budget can take, the one a Post named a
    moment ago must still be the one queued. Ordered by handle, `zz...` would
    lose to every older target sorting ahead of it, for as long as the crawl
    keeps finding more.
    """
    monkeypatch.setattr(settings, "DIRECTORY_HARVEST_BACKLOG_CEILING", 1)

    _follow(session, "t05-prompt", user)
    for index in range(4):
        _post(
            session,
            "t05-prompt",
            index + 1,
            timestamp=(index + 1) * 10,
            forwarded_from=f"backlogref{index}",
        )
    _post(session, "t05-prompt", 99, timestamp=9999, forwarded_from="zzjustarrived")

    assert _sweep()["queued"] == 1
    assert _pending_handles() == {"zzjustarrived"}


def test_a_caught_up_tick_queues_nothing(session: Session, user: User) -> None:
    """Steady state: every target already has an entry, so the tick adds none."""
    _follow(session, "t05-settled", user)
    _post(session, "t05-settled", 1, timestamp=10, forwarded_from="settledref")

    _sweep()
    assert _sweep()["queued"] == 0


# --------------------------------------------------------------------------
# Faults
# --------------------------------------------------------------------------


def test_a_tick_that_dies_before_enqueueing_loses_no_handles(
    session: Session, user: User
) -> None:
    """The Reference is the record, so a failed enqueue is retried by the next tick."""
    _follow(session, "t05-atomic", user)
    _post(session, "t05-atomic", 1, timestamp=10, forwarded_from="mustsurvive")

    with (
        patch(
            "app.jobs.directory_harvest.enqueue_handles",
            side_effect=RuntimeError("died before the commit"),
        ),
        pytest.raises(RuntimeError),
    ):
        _sweep()

    assert _entries() == {}

    _sweep()
    assert "mustsurvive" in _entries()


def test_a_failed_extraction_does_not_stop_the_enqueue() -> None:
    """The graph already holds References the enqueue can use.

    A sample's References are written at probe time, so a tick whose
    extraction walk fails still has them to queue.
    """
    _probe("t02-written", _sample(1, "see @alreadyinthegraph"))

    with patch(
        "app.jobs.directory_harvest.extract_batch",
        side_effect=RuntimeError("lock timeout"),
    ):
        result = _sweep()

    assert result["referencesFailed"] == 1
    assert "alreadyinthegraph" in _pending_handles()


def test_two_ticks_do_not_overlap() -> None:
    """The lock covers the manual trigger as well as the scheduled tick."""

    async def _both() -> tuple[dict, dict]:
        return await asyncio.gather(  # type: ignore[return-value]
            run_directory_harvest_sweep(), run_directory_harvest_sweep()
        )

    first, second = asyncio.run(_both())
    assert second.get("skipped") is True or first.get("skipped") is True


# --------------------------------------------------------------------------
# An edited Post
# --------------------------------------------------------------------------


def test_an_edit_that_adds_a_reference_reaches_the_directory(
    session: Session, user: User
) -> None:
    """An edit sends the Post back to reference extraction.

    With the Post walk gone, extraction is the only reader. Without the reset
    a channel editing an already-extracted Post to add a `t.me` link would hide
    that handle for ever. The References table's uniqueness absorbs whatever
    the first extraction already wrote.
    """
    _follow(session, "t05-edit", user)
    _post(session, "t05-edit", 1, timestamp=10, text="nothing here yet")

    _sweep()
    assert _unextracted() == 0
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

    assert _unextracted() == 1
    _sweep()
    assert "editedinlater" in _entries()


def test_an_unchanged_re_upsert_does_not_send_the_post_back(
    session: Session, user: User
) -> None:
    """The condition is the whole point.

    Sync re-scrapes the newest page of every followed Channel on every run, so
    clearing the flag unconditionally would hand extraction thousands of
    unchanged rows per sync round for ever.
    """
    _follow(session, "t05-noedit", user)
    _post(session, "t05-noedit", 1, timestamp=10, text="stable body")

    _sweep()
    assert _unextracted() == 0

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

    assert _unextracted() == 0


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
