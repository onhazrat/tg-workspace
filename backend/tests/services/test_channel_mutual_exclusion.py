"""Ticket 11: one sync per Channel at a time, and the second one rides the first.

Plan decision 34 is blunt about why this cannot wait: concurrent syncs of one
Channel interleave writes to `last_updated`, `anchor_post_id`,
`oldest_stored_post_timestamp` and `history_complete_to_cutoff`. Posts are safe
without any of this -- `bulk_upsert_posts_impl` upserts on the unique constraint
-- but those four are read-modify-write against a backward walk's own idea of
where it got to, and two walks produce a row that describes neither.

Until now the protection was `scraper_jobs._channel_locks`, an in-process
`asyncio.Lock`. Ticket 10 moved the scheduler into its own process, so that lock
now guards one process against itself while saying nothing to the API beside it
-- and ticket 13 puts a second worker next to the first. The claim moves to the
database, which is what "outside process memory" in the ticket means.

Four things here are worth more than "the claim works".

* **The lease is what makes a crash recoverable, and it is separate from the
  visibility timeout on purpose.** The VT decides when a dead worker's *message*
  comes back (~2.4 hours); the lease decides when its *Channel* does (5
  minutes). Sizing one off the other would leave a Channel that crashed at noon
  refusing every sync until 14:24, including one a person is sitting in front
  of. So the expiry is asserted as its own thing, in both directions: a stale
  claim is taken, a live one is not.
* **Release and renew are conditional on the holder, and that is not
  bookkeeping.** A runner that overran its lease and had the Channel taken from
  it reaches its own `finally` afterwards. An unconditional release there clears
  the *new* holder's claim and hands a third walk into cursors the second is
  mid-write -- the interleaving this file exists to prevent, arrived at through
  the cleanup path rather than the claim path.
* **Coalescing is asserted by counting walks, not by reading a status.** The
  second request must report the first's result *without having scraped*, and a
  test that only checks the reported status passes just as well when both
  requests scraped and agreed. The recorder below counts entries into
  `_walk_channel_pages`, so "it rode the first one" and "it did the work twice
  and got the same answer" stop looking alike.
* **"Not charged" follows from making no Requests, and both halves are pinned.**
  The meter travels by `contextvars` and counts `fetch_with_retry` calls
  (ticket 08), so a coalesced request that never enters the walk cannot count
  anything -- and `charge_sync_job` writes no row for a count of zero. Asserting
  only the second would pass for a request that scraped and was let off.

Per `CLAUDE.md`, every assertion here was watched to fail before it was trusted.
The mutations that were run are listed so the next person need not re-derive
them:

* drop the `sync_claimed_at IS NULL OR ... < :cutoff` predicate from
  `try_claim_channel_sync` -> five fail: `test_a_live_claim_is_not_stolen`,
  `test_only_one_of_two_racing_claims_wins`, `test_renew_pushes_the_expiry_out`,
  `test_two_concurrent_syncs_of_one_channel_do_not_interleave` and
  `test_the_second_request_is_not_charged_because_it_made_no_requests`
* return `result.rowcount > 0` instead of reading `RETURNING` -> **nothing
  fails, and that is the correct outcome.** Worth recording rather than
  quietly dropping, because the mutation was written expecting a catch.
  `CLAUDE.md`'s warning is about `session.exec`, which wraps the result for
  reads so `rowcount` stops meaning rows affected, and about
  `ON CONFLICT DO NOTHING`, where it reports a write for a conflict that wrote
  nothing. Neither applies to a plain conditional `UPDATE` issued through
  `session.execute`: there `rowcount` is accurate, so there is no defect here
  for a guard to find. `RETURNING` is kept anyway because it is the spelling
  that stays correct if this ever becomes an upsert -- but it is kept as a
  habit, not as something this file proves.
* drop `AND sync_claimed_by = :holder` from `release_channel_sync_claim` ->
  `test_release_only_clears_our_own_claim` fails
* drop the same from `renew_channel_sync_claim` ->
  `test_renew_fails_once_the_claim_has_been_stolen` fails
* make `channel_sync_claim_holder` ignore the lease cutoff ->
  `test_an_expired_claim_reports_no_live_holder` fails
* have the coalescing branch fall through and sync anyway ->
  `test_two_concurrent_syncs_of_one_channel_do_not_interleave` fails on the
  walk count, which is the assertion that mutation was written for
* release the claim without publishing the outcome -> the coalesced call falls
  back to its poll and still reports, so **no test fails on the notification
  alone**; that is why `test_the_release_notification_carries_the_outcome`
  asserts the payload directly rather than inferring it from behaviour
* advance `next_regular_sync_at` at claim time instead of on completion ->
  `test_the_claim_does_not_touch_the_scheduling_deadline` fails

Code review found seven further holes, all real, all closed here. Their
mutations were run too, and each is caught by exactly one test:

* drop the claim columns from `SERVER_MANAGED_CHANNEL_FIELDS` ->
  `test_the_claim_columns_cannot_be_written_through_the_api`
* time the lease off `time.time()` instead of `now()` ->
  `test_the_lease_is_timed_by_the_database_not_the_caller`
* release the claim before announcing the outcome ->
  `test_the_outcome_is_announced_while_the_claim_is_still_held`
* announce without first checking we are still the holder ->
  `test_a_runner_that_lost_its_lease_announces_nothing`
* finalise without re-checking the claim ->
  `test_losing_the_lease_skips_the_cursor_write`
* make every announced outcome adoptable by a rider ->
  `test_an_outcome_from_a_run_that_never_walked_is_not_adopted`
* return success from the row fallback unconditionally ->
  `test_the_row_fallback_refuses_to_invent_a_success`
"""

from __future__ import annotations

import asyncio
import inspect
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models import User
from app.models_tg import Channel, QuotaUsage
from app.services import channels as channels_service
from app.services import sync_orchestrator
from app.services.channels import (
    CHANNEL_CLAIM_LEASE_SECONDS,
    channel_sync_claim_holder,
    release_channel_sync_claim,
    renew_channel_sync_claim,
    try_claim_channel_sync,
)
from app.services.scraper_jobs import ChannelSyncState, SyncJobState
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

CHANNEL_ID = "t11-shared"
CHANNEL_NAME = "t11shared"


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def channel(session: Session, user: User) -> Channel:
    return add_test_channel(session, CHANNEL_ID, name=CHANNEL_NAME, user_id=user.id)


def _claim_row(session: Session) -> tuple[int | None, str | None]:
    session.expire_all()
    row = session.exec(
        select(Channel.sync_claimed_at, Channel.sync_claimed_by).where(
            col(Channel.id) == CHANNEL_ID
        )
    ).one()
    return row[0], row[1]


def _age_the_claim(session: Session, *, seconds: int) -> None:
    """Backdate the live claim so it looks like a worker that died `seconds` ago.

    `expire_all` first: the claim was written by `try_claim_channel_sync` in its
    own session, so this one is still holding the pre-claim identity-map copy
    and would backdate a `None`.
    """
    session.expire_all()
    channel = session.get(Channel, CHANNEL_ID)
    assert channel is not None and channel.sync_claimed_at is not None
    channel.sync_claimed_at = channel.sync_claimed_at - seconds * 1000
    session.add(channel)
    session.commit()


# ---------------------------------------------------------------------------
# The claim itself
# ---------------------------------------------------------------------------


def test_the_claim_is_a_row_not_a_lock_in_this_process(
    session: Session, channel: Channel
) -> None:
    """Checkbox 1: enforced *outside process memory*.

    The claim has to be legible to a second process, which means it has to be a
    row. This asserts the row rather than the return value, because a function
    that answered True and stored nothing would satisfy every other test in this
    file while protecting nothing across the process boundary ticket 10 created.
    """
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-a") is True

    claimed_at, claimed_by = _claim_row(session)
    assert claimed_by == "worker-a"
    assert claimed_at is not None
    assert abs(claimed_at - int(time.time() * 1000)) < 60_000


def test_a_live_claim_is_not_stolen(session: Session, channel: Channel) -> None:
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-a") is True
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-b") is False

    _claimed_at, claimed_by = _claim_row(session)
    assert claimed_by == "worker-a", "the losing claim overwrote the winner's row"


def test_only_one_of_two_racing_claims_wins(session: Session, channel: Channel) -> None:
    """The two callers are threads, deliberately.

    Two sequential calls prove the predicate; they do not prove it holds when
    both are inside the statement at once. Real contention is two workers, so
    the race is run as two threads against the same row and the assertion is
    that PostgreSQL's row lock -- not the ordering of our own reads -- is what
    decides it.
    """

    async def _race() -> list[bool]:
        return list(
            await asyncio.gather(
                asyncio.to_thread(try_claim_channel_sync, CHANNEL_ID, holder="a"),
                asyncio.to_thread(try_claim_channel_sync, CHANNEL_ID, holder="b"),
            )
        )

    results = asyncio.run(_race())

    assert sorted(results) == [False, True], (
        f"expected exactly one winner, got {results}"
    )


def test_an_expired_claim_is_taken_over(session: Session, channel: Channel) -> None:
    """Checkbox 4: a crashed worker's Channel is picked up without intervention.

    No reaper runs and no operator clears anything -- the next caller that wants
    the Channel takes it, because the predicate is about the claim's age rather
    than about anybody having tidied up.
    """
    assert try_claim_channel_sync(CHANNEL_ID, holder="dead-worker") is True
    _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS + 60)

    assert try_claim_channel_sync(CHANNEL_ID, holder="live-worker") is True

    _claimed_at, claimed_by = _claim_row(session)
    assert claimed_by == "live-worker"


def test_an_expired_claim_reports_no_live_holder(
    session: Session, channel: Channel
) -> None:
    assert try_claim_channel_sync(CHANNEL_ID, holder="dead-worker") is True
    assert channel_sync_claim_holder(CHANNEL_ID) == "dead-worker"

    _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS + 60)

    assert channel_sync_claim_holder(CHANNEL_ID) is None, (
        "an expired claim still reports a live holder, so a waiter would "
        "coalesce onto a worker that is not coming back"
    )


def test_renew_pushes_the_expiry_out(session: Session, channel: Channel) -> None:
    """A long backfill keeps its claim. This is what stops the lease from being
    a cap on how long a legitimate sync may take."""
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-a") is True
    _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS - 5)

    assert renew_channel_sync_claim(CHANNEL_ID, holder="worker-a") is True
    assert channel_sync_claim_holder(CHANNEL_ID) == "worker-a"

    # And the renewal is what did it: without it the claim was seconds from
    # being stealable.
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-b") is False


def test_renew_fails_once_the_claim_has_been_stolen(
    session: Session, channel: Channel
) -> None:
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-a") is True
    _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS + 60)
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-b") is True

    assert renew_channel_sync_claim(CHANNEL_ID, holder="worker-a") is False, (
        "the overrun worker renewed its way back on top of the new holder"
    )
    assert channel_sync_claim_holder(CHANNEL_ID) == "worker-b"


def test_release_only_clears_our_own_claim(session: Session, channel: Channel) -> None:
    """The cleanup path is a way into the interleaving, not just an untidy edge.

    `worker-a` overran, lost the Channel, and now reaches its own `finally`.
    Releasing unconditionally there would leave the row unclaimed while
    `worker-b` is mid-walk, and the next request would start a second walk into
    cursors `worker-b` is still writing.
    """
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-a") is True
    _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS + 60)
    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-b") is True

    assert release_channel_sync_claim(CHANNEL_ID, holder="worker-a") is False

    assert channel_sync_claim_holder(CHANNEL_ID) == "worker-b", (
        "the overrun worker released the new holder's claim on its way out"
    )

    assert release_channel_sync_claim(CHANNEL_ID, holder="worker-b") is True
    assert channel_sync_claim_holder(CHANNEL_ID) is None


def test_the_claim_does_not_touch_the_scheduling_deadline(
    session: Session, channel: Channel
) -> None:
    """Checkbox 3, and decision 33: claim and deadline are different questions.

    A claim taken, renewed and released must leave `next_regular_sync_at` and
    `next_dynamic_sync_at` exactly where they were. Advancing a deadline here
    would mean "enqueued" and "synced" were the same event, and a message that
    exhausts `read_ct` and is archived would then strand its Channel silently --
    the schedule says it ran, and nothing did.
    """
    row = session.get(Channel, CHANNEL_ID)
    assert row is not None
    row.next_regular_sync_at = 1_700_000_000_000
    row.next_dynamic_sync_at = 1_700_000_500_000
    row.last_updated = 1_699_000_000_000
    session.add(row)
    session.commit()

    assert try_claim_channel_sync(CHANNEL_ID, holder="worker-a") is True
    assert renew_channel_sync_claim(CHANNEL_ID, holder="worker-a") is True
    assert release_channel_sync_claim(CHANNEL_ID, holder="worker-a") is True

    session.expire_all()
    after = session.get(Channel, CHANNEL_ID)
    assert after is not None
    assert after.next_regular_sync_at == 1_700_000_000_000
    assert after.next_dynamic_sync_at == 1_700_000_500_000
    assert after.last_updated == 1_699_000_000_000


# ---------------------------------------------------------------------------
# Mutual exclusion and coalescing through the real sync path
# ---------------------------------------------------------------------------


def _job(job_id: str, user: User) -> tuple[SyncJobState, ChannelSyncState]:
    ch_state = ChannelSyncState(channel_id=CHANNEL_ID, channel_name=CHANNEL_NAME)
    job = SyncJobState(
        job_id=job_id,
        source="test",
        channels={CHANNEL_ID: ch_state},
        user_id=str(user.id),
        sync_mode="individual",
    )
    return job, ch_state


class _WalkRecorder:
    """Stands in for `_walk_channel_pages` and records the critical section.

    Two walks that overlap show up as `enter, enter` -- which is the shape the
    cursor interleaving takes, since every cursor write happens between one
    walk's entry and its exit.
    """

    def __init__(self, hold_seconds: float) -> None:
        self.events: list[str] = []
        self.hold_seconds = hold_seconds

    async def __call__(
        self,
        job: SyncJobState,
        ch_state: ChannelSyncState,
        ctx: Any,
        walk: Any,
        *,
        user_id: uuid.UUID | None,
    ) -> None:
        self.events.append("enter")
        await asyncio.sleep(self.hold_seconds)
        walk.final_latest_id = 4242
        walk.total_new_posts = 1
        self.events.append("exit")

    @property
    def walk_count(self) -> int:
        return self.events.count("enter")

    @property
    def overlapped(self) -> bool:
        depth = 0
        for event in self.events:
            depth += 1 if event == "enter" else -1
            if depth > 1:
                return True
        return False


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> _WalkRecorder:
    rec = _WalkRecorder(hold_seconds=0.4)
    monkeypatch.setattr(sync_orchestrator, "_walk_channel_pages", rec)
    return rec


def test_two_concurrent_syncs_of_one_channel_do_not_interleave(
    session: Session, channel: Channel, user: User, recorder: _WalkRecorder
) -> None:
    """The headline of the ticket, and of plan decision 34.

    Two requests for the same Channel start at the same moment. Exactly one
    walks it; the other coalesces and reports what the first found. The walk
    count is the assertion that matters -- a version where both scraped and
    happened to agree would pass a status check and fail this.
    """
    job_a, state_a = _job("job-a", user)
    job_b, state_b = _job("job-b", user)

    async def _both() -> None:
        await asyncio.gather(
            sync_orchestrator.sync_single_channel(job_a, state_a, user_id=user.id),
            sync_orchestrator.sync_single_channel(job_b, state_b, user_id=user.id),
        )

    asyncio.run(_both())

    assert recorder.walk_count == 1, (
        f"the Channel was walked {recorder.walk_count} times; the second request "
        f"repeated the work instead of riding the first"
    )
    assert not recorder.overlapped

    assert {state_a.status, state_b.status} == {"success"}, (
        f"both requests must report the sync's result: "
        f"{state_a.status} / {state_b.status} ({state_a.error} / {state_b.error})"
    )

    # And the claim is given back, so the next sync is not locked out.
    assert channel_sync_claim_holder(CHANNEL_ID) is None


def test_the_second_request_is_not_charged_because_it_made_no_requests(
    session: Session, channel: Channel, user: User, recorder: _WalkRecorder
) -> None:
    """Checkbox 2's last clause, asserted at the ledger.

    Two halves, and asserting either alone is a test that passes for the wrong
    reason. The coalesced request must make no Telegram Requests -- which is
    what `walk_count == 1` above establishes -- *and* a count of zero must write
    no row, or "not charged" would depend on nobody looking at the ledger.
    """
    from app.services.quota import charge_sync_job

    job_a, state_a = _job("job-a", user)
    job_b, state_b = _job("job-b", user)

    async def _both() -> None:
        await asyncio.gather(
            sync_orchestrator.sync_single_channel(job_a, state_a, user_id=user.id),
            sync_orchestrator.sync_single_channel(job_b, state_b, user_id=user.id),
        )

    asyncio.run(_both())
    assert recorder.walk_count == 1

    # What the coalesced message hands to the ledger.
    charge_sync_job(user.id, "individual", 0)

    session.expire_all()
    rows = session.exec(
        select(QuotaUsage).where(col(QuotaUsage.user_id) == user.id)
    ).all()
    assert rows == [], (
        "a coalesced request wrote a usage row; it made no Requests and a row "
        "of zero is indistinguishable from a real day of zero usage"
    )


def test_a_second_sync_after_the_first_finishes_runs_normally(
    session: Session, channel: Channel, user: User, recorder: _WalkRecorder
) -> None:
    """The other direction, and the reason coalescing is not just a lock.

    Sequential requests must both walk. A claim that was never released -- or a
    coalescing branch that triggered on a stale claim -- turns every subsequent
    sync of that Channel into a no-op, which looks exactly like the feature
    working if only the concurrent case is tested.
    """
    job_a, state_a = _job("job-a", user)
    job_b, state_b = _job("job-b", user)

    asyncio.run(sync_orchestrator.sync_single_channel(job_a, state_a, user_id=user.id))
    asyncio.run(sync_orchestrator.sync_single_channel(job_b, state_b, user_id=user.id))

    assert recorder.walk_count == 2
    assert state_a.status == "success"
    assert state_b.status == "success"


def test_a_crashed_holders_channel_is_synced_by_the_next_request(
    session: Session, channel: Channel, user: User, recorder: _WalkRecorder
) -> None:
    """Checkbox 4 through the real path, not just through the primitive.

    A worker took the claim and died -- no release, no heartbeat. The next
    request must not coalesce onto it for ever; once the lease lapses it takes
    the Channel and syncs it.
    """
    assert try_claim_channel_sync(CHANNEL_ID, holder="dead-worker") is True
    _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS + 60)

    job, state = _job("job-after-crash", user)
    asyncio.run(sync_orchestrator.sync_single_channel(job, state, user_id=user.id))

    assert recorder.walk_count == 1
    assert state.status == "success"
    assert channel_sync_claim_holder(CHANNEL_ID) is None


def test_the_release_notification_carries_the_outcome(
    session: Session, channel: Channel, user: User, recorder: _WalkRecorder
) -> None:
    """Asserted directly, because behaviour cannot distinguish it.

    A waiter that hears nothing still finishes: its poll notices the claim is
    gone and it reads the outcome from the row. So dropping the notification
    breaks no other test in this file -- it just makes every coalesced request
    wait for the poll interval instead of milliseconds. That is a real
    regression with no behavioural signature, which is exactly the kind a guard
    has to state outright.
    """
    published: list[tuple[str, dict[str, Any]]] = []

    def _capture(ch: str, payload: dict[str, Any]) -> None:
        published.append((ch, payload))

    from app.core import pg_notify

    original = pg_notify.publish
    pg_notify.publish = _capture  # type: ignore[assignment]
    try:
        job, state = _job("job-a", user)
        asyncio.run(sync_orchestrator.sync_single_channel(job, state, user_id=user.id))
    finally:
        pg_notify.publish = original  # type: ignore[assignment]

    releases = [
        payload
        for ch, payload in published
        if ch == sync_orchestrator.CHANNEL_SYNC_RELEASE_CHANNEL
    ]
    assert releases, "releasing the claim announced nothing"
    assert releases[-1]["channelId"] == CHANNEL_ID
    assert releases[-1]["status"] == "success"


def test_the_in_process_channel_lock_is_gone(session: Session) -> None:
    """One rule, one spelling.

    Keeping the `asyncio.Lock` beside the database claim would be two answers to
    "is this Channel being synced", and they diverge the moment the second
    worker arrives: the lock says no, the claim says yes, and which one a call
    site consulted decides whether the cursors are protected. `CLAUDE.md` names
    that shape as the drift the seams exist to prevent.
    """
    from app.services import scraper_jobs

    assert not hasattr(scraper_jobs, "_channel_locks"), (
        "the in-process channel lock is still here alongside the database claim"
    )
    assert not hasattr(scraper_jobs, "acquire_channel")

    source = channels_service.__file__
    assert source  # the claim lives in the aggregate that owns tg_channels


def test_a_coalesced_request_can_never_adopt_a_non_terminal_status() -> None:
    """The failure this closes has no error message and no end.

    `_finalize_if_complete` waits for every Channel of a job to reach a terminal
    status. A coalesced request copies its status from the running sync's
    announcement, so a `running` leaking into that payload leaves the second job
    waiting for a Channel that already finished -- for ever, with no `[DONE]` on
    the stream and nothing in error. Nothing else in this file would notice: the
    coalescing worked, the walk ran once, and the status matched what was sent.

    Asserted as a set equality rather than by driving it, because the two sets
    live in modules that cannot import each other (`sync_queue` imports
    `sync_orchestrator`) and the copy is the thing that drifts.
    """
    from app.jobs.sync_queue import _TERMINAL_CHANNEL_STATUSES

    assert sync_orchestrator._ANNOUNCEABLE_STATUSES == _TERMINAL_CHANNEL_STATUSES, (
        "the statuses a release may announce and the statuses a job can finish "
        "on have drifted; a coalesced request can now adopt one that leaves its "
        "job running for ever"
    )

    # And the guard in front of it: an escaped non-terminal state is reported as
    # a failure rather than passed on.
    ch_state = ChannelSyncState(channel_id=CHANNEL_ID, channel_name=CHANNEL_NAME)
    sync_orchestrator._apply_coalesced_outcome(ch_state, {"status": "running"})
    assert ch_state.status == "failed"


def test_a_coalesced_request_reports_the_failure_it_rode(
    session: Session, channel: Channel, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Coalescing must not launder a failure into a success.

    The second request did no work, so the temptation is to report that nothing
    went wrong for *it*. But it asked for a Channel to be synced and the sync it
    rode failed, so that is its answer too -- anything else tells a caller its
    Channel is up to date when it is not.
    """
    events: list[str] = []

    async def _failing_walk(
        job: SyncJobState,
        ch_state: ChannelSyncState,
        ctx: Any,
        walk: Any,
        *,
        user_id: uuid.UUID | None,
    ) -> None:
        events.append("enter")
        await asyncio.sleep(0.4)
        walk.failed_error = "chat id mismatch"

    monkeypatch.setattr(sync_orchestrator, "_walk_channel_pages", _failing_walk)

    job_a, state_a = _job("job-a", user)
    job_b, state_b = _job("job-b", user)

    async def _both() -> None:
        await asyncio.gather(
            sync_orchestrator.sync_single_channel(job_a, state_a, user_id=user.id),
            sync_orchestrator.sync_single_channel(job_b, state_b, user_id=user.id),
        )

    asyncio.run(_both())

    assert len(events) == 1
    assert state_a.status == "failed"
    assert state_b.status == "failed", (
        "the coalesced request reported success for a sync that failed"
    )
    assert state_b.error


# ---------------------------------------------------------------------------
# What code review found, and what now holds it closed
# ---------------------------------------------------------------------------


def test_the_claim_columns_cannot_be_written_through_the_api(
    session: Session, channel: Channel
) -> None:
    """The worst of the review findings, and the least visible.

    `apply_channel_fields` writes any key present in `Channel.model_fields`,
    `ChannelUpsertRequest` is `extra="allow"`, and `normalize_body` snake-cases
    whatever arrives. So adding two columns to `Channel` silently added two
    writable API fields. `PUT /data/channels/{id}` with `{"syncClaimedBy": null}`
    clears a live holder's claim mid-walk and the next request starts the second
    concurrent backward walk this whole file exists to prevent. The other
    direction is quieter and worse: a fresh `syncClaimedAt` with a made-up
    holder, re-sent every few minutes, parks that Channel for ever with nothing
    in any log to say why.

    Asserted at the frozenset *and* through the rejection, because the frozenset
    alone is a list somebody can satisfy while the check that reads it changes.
    """
    from app.services.channels import (
        SERVER_MANAGED_CHANNEL_FIELDS,
        _reject_server_managed_channel_fields,
    )

    assert {"sync_claimed_at", "sync_claimed_by"} <= SERVER_MANAGED_CHANNEL_FIELDS

    for field in ("sync_claimed_at", "sync_claimed_by"):
        with pytest.raises(HTTPException) as exc:
            _reject_server_managed_channel_fields({field: "anything"})
        assert exc.value.status_code == 400

    # And the import door, which strips rather than refusing.
    from app.services.data_import_export import (
        SERVER_MANAGED_CHANNEL_FIELDS as imported,
    )

    assert {"sync_claimed_at", "sync_claimed_by"} <= imported


def test_the_lease_is_timed_by_the_database_not_the_caller() -> None:
    """One worker makes this look like a distinction without a difference.

    Ticket 13 puts a second worker beside the first, and then a host clock a few
    minutes fast steals a live claim on its first attempt and starts the
    concurrent walk. Every one of the three statements therefore compares
    `sync_claimed_at` against `now()` inside Postgres.

    Asserted against the source rather than by skewing a clock, and the reason
    is the assertion's own strongest evidence: `channels.py` no longer imports
    `time` at all, so there is no clock in the module left to skew. A test that
    monkeypatched one would be patching an attribute that does not exist -- it
    did, and it failed for that reason rather than finding anything.
    """
    import app.services.channels as mod

    assert "now()" in channels_service._DB_NOW_MS
    assert "now()" in channels_service._CLAIM_CUTOFF_MS

    for fn in (
        channels_service.try_claim_channel_sync,
        channels_service.renew_channel_sync_claim,
        channels_service.channel_sync_claim_holder,
    ):
        source = inspect.getsource(fn)
        assert "time.time" not in source, (
            f"{fn.__name__} times the lease off the calling process's clock; a "
            f"fast host steals live claims once a second worker exists"
        )

    assert not hasattr(mod, "time"), (
        "channels.py has a clock again — check it is not being used to decide "
        "whether a claim has expired"
    )


def test_the_outcome_is_announced_while_the_claim_is_still_held(
    session: Session, channel: Channel, user: User, recorder: _WalkRecorder
) -> None:
    """Release-then-announce leaves a window that costs a whole extra scrape.

    Between the release committing and the notification going out, a waiter at
    the top of its loop finds the claim free, takes it, and walks the Channel
    that was just walked. Announcing first closes it: the waiter's claim attempt
    fails while the outcome is already in its queue.

    Asserted by recording who holds the claim *at the moment of publishing*,
    which is the only way to see the ordering from outside.
    """
    from app.core import pg_notify

    holders_at_publish: list[str | None] = []
    original = pg_notify.publish

    def _capture(ch: str, payload: dict[str, Any]) -> None:
        if ch == sync_orchestrator.CHANNEL_SYNC_RELEASE_CHANNEL:
            holders_at_publish.append(channel_sync_claim_holder(CHANNEL_ID))
        original(ch, payload)

    pg_notify.publish = _capture  # type: ignore[assignment]
    try:
        job, state = _job("job-a", user)
        asyncio.run(sync_orchestrator.sync_single_channel(job, state, user_id=user.id))
    finally:
        pg_notify.publish = original  # type: ignore[assignment]

    assert holders_at_publish, "nothing was announced"
    assert holders_at_publish[-1] is not None, (
        "the claim was already released when the outcome was announced; a "
        "waiter can win it in that window and re-scrape the Channel"
    )


def test_a_runner_that_lost_its_lease_announces_nothing(
    session: Session, channel: Channel, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An overrun runner must not answer for the run that replaced it.

    Holder A's lease lapses and B takes the Channel. A finishes its walk and
    reaches its own `finally`. Its release is refused (conditional on the
    holder) -- but an unconditional *announcement* there would be adopted by a
    waiter riding B, which would then report a finished sync while B is still
    fetching pages.
    """
    from app.core import pg_notify

    published: list[dict[str, Any]] = []
    original = pg_notify.publish

    def _capture(ch: str, payload: dict[str, Any]) -> None:
        if ch == sync_orchestrator.CHANNEL_SYNC_RELEASE_CHANNEL:
            published.append(payload)

    async def _walk_then_lose_the_claim(
        job: SyncJobState,
        ch_state: ChannelSyncState,
        ctx: Any,
        walk: Any,
        *,
        user_id: uuid.UUID | None,
    ) -> None:
        # Somebody else takes the Channel while this walk is in progress.
        _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS + 60)
        assert try_claim_channel_sync(CHANNEL_ID, holder="worker-b") is True
        walk.final_latest_id = 99

    monkeypatch.setattr(
        sync_orchestrator, "_walk_channel_pages", _walk_then_lose_the_claim
    )
    pg_notify.publish = _capture  # type: ignore[assignment]
    try:
        job, state = _job("job-a", user)
        asyncio.run(sync_orchestrator.sync_single_channel(job, state, user_id=user.id))
    finally:
        pg_notify.publish = original  # type: ignore[assignment]

    assert published == [], (
        "a runner that had lost its claim still announced an outcome; a waiter "
        "riding the new holder would adopt it"
    )
    # And the new holder's claim survived the old runner's cleanup.
    assert channel_sync_claim_holder(CHANNEL_ID) == "worker-b"


def test_losing_the_lease_skips_the_cursor_write(
    session: Session, channel: Channel, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The interleaving, reached through the path the design admits can happen.

    The heartbeat gives up quietly when it loses the lease and the walk carries
    on. Carrying on into `_finalize_channel_success` means writing
    `last_updated`, `anchor_post_id`, `oldest_stored_post_timestamp` and
    `history_complete_to_cutoff` while the new holder is mid-walk and about to
    write the same four -- which is exactly what the claim exists to prevent.

    `last_updated` is the witness: only the success finaliser advances it.
    """
    row = session.get(Channel, CHANNEL_ID)
    assert row is not None
    row.last_updated = 111_000
    session.add(row)
    session.commit()

    async def _walk_then_lose_the_claim(
        job: SyncJobState,
        ch_state: ChannelSyncState,
        ctx: Any,
        walk: Any,
        *,
        user_id: uuid.UUID | None,
    ) -> None:
        _age_the_claim(session, seconds=CHANNEL_CLAIM_LEASE_SECONDS + 60)
        assert try_claim_channel_sync(CHANNEL_ID, holder="worker-b") is True
        walk.final_latest_id = 99

    monkeypatch.setattr(
        sync_orchestrator, "_walk_channel_pages", _walk_then_lose_the_claim
    )

    job, state = _job("job-a", user)
    asyncio.run(sync_orchestrator.sync_single_channel(job, state, user_id=user.id))

    session.expire_all()
    after = session.get(Channel, CHANNEL_ID)
    assert after is not None
    assert after.last_updated == 111_000, (
        "a runner that had lost its claim wrote the Channel's cursors anyway, "
        "while the new holder was walking it"
    )
    assert state.status == "failed"


def test_an_outcome_from_a_run_that_never_walked_is_not_adopted() -> None:
    """A rider adopts facts about the Channel, never about the holder's job.

    `skipped` from a `sync_mode` denial and `cancelled` from the holder's job
    are both properties of *that* job. A rider adopting them silently never
    syncs -- and in the denial case is told "Sync not allowed for group ..."
    about a mode that is allowed for it.

    Absent `walked` reads as True so a rolling deploy, where the other process
    publishes payloads without the key, does not make every rider re-scrape.
    """
    assert sync_orchestrator._is_channel_outcome({"walked": True}) is True
    assert sync_orchestrator._is_channel_outcome({"walked": False}) is False
    assert sync_orchestrator._is_channel_outcome({}) is True

    source = inspect.getsource(sync_orchestrator._claim_or_coalesce)
    assert "_is_channel_outcome" in source, (
        "the coalescing loop no longer checks whether the outcome it heard is a "
        "fact about the Channel; job-scoped skips and cancels are adoptable again"
    )


def test_the_row_fallback_refuses_to_invent_a_success(
    session: Session, channel: Channel, user: User
) -> None:
    """The fallback ran when nobody was watching, and it always said success.

    Reached when a holder released without its announcement arriving. The first
    cut returned success for any row that existed, so a Channel that had just
    failed on a dead handle reported a completed sync -- with a `newLatestId`
    off a row nothing had advanced. `last_updated` is the evidence and is now
    actually read.
    """
    ch_state = ChannelSyncState(channel_id=CHANNEL_ID, channel_name=CHANNEL_NAME)

    row = session.get(Channel, CHANNEL_ID)
    assert row is not None
    row.last_updated = 500_000
    session.add(row)
    session.commit()

    stale = sync_orchestrator._outcome_from_row(ch_state, 900_000)
    assert stale["status"] == "failed", (
        "the fallback reported success for a sync that left no trace of having "
        "completed"
    )

    fresh = sync_orchestrator._outcome_from_row(ch_state, 100_000)
    assert fresh["status"] == "success"
