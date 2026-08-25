"""Consumes the sync lanes, one message per Channel (tickets 09, 10).

Ticket 09 put manual single syncs on `manual_single_normal` and drained it from
the web process. Ticket 10 generalises both halves: every sync mode enqueues,
the message is **one Channel** rather than one job, and the draining happens in
the worker process (`app/worker.py`) so restarting the API no longer aborts a
sync in flight. This module was `app/jobs/manual_single_queue.py` until then.

**One message per Channel, never one per tick** (decision 30). A tick-shaped
message cannot be attributed to a Channel, cannot be given a visibility timeout
that means anything (one channel or fifty behind the same VT), and fails as a
unit — one dead handle taking the other forty-nine with it. The batch does not
disappear, it moves to the job row: `tg_sync_jobs` plus its SSE stream stays the
batch view, so a fifty-Channel sync is one job row and fifty messages carrying
its id.

**The job is finished by whichever message finishes last.** There is no longer a
`run_sync_job` sitting above the channels to notice they are all done, so
`_finalize_if_complete` recomputes the job's status from its Channels after
every message and writes the terminal row once. Under a single-replica sync tier
this is safe by construction — asyncio gives it a consistent view of
`_active_jobs` between awaits — and it is exactly the assumption ticket 11's
database claim is what removes.

**Concurrency belongs to the worker, not to the job.** `run_sync_job` sized an
`asyncio.Semaphore` per job, which meant two jobs each got the full budget. One
process-wide semaphore is both simpler and closer to what the number always
meant: how many Channels this deployment may scrape at once. Sized from
`_load_sync_job_concurrency`, which reads the operator's `syncConcurrency`
against the proxy pool's real capacity.

*One caveat, stated rather than glossed:* `auto_summary._sync_channels_for_summary`
still calls `run_sync_job` directly, because it needs the sync finished before
it can summarise — enqueueing there would invert its control flow. It runs in
this same worker process and opens its own semaphore, so the gate below is the
cap on *lane* work, not on every scrape the worker performs. Ticket 13's
one-worker-per-proxy partitioning is what makes that distinction stop mattering.

**A message charges its own quota meter.** `run_sync_job` opened one meter per
job and charged once at the end; now each message opens its own. The day's total
is unchanged — `tg_quota_usage` accumulates on `(user_id, day, budget)` — and a
job that dies half way now pays for the Channels that did complete, which is the
argument `run_sync_job`'s `finally` already made for not rewarding a crash.

**Messages without a `channelId` still run the whole job.** A deploy has
messages in flight, and every one enqueued by ticket 09's code is job-shaped. On
a queue those outlive the process that wrote them, so treating them as malformed
would strand exactly the syncs someone triggered in the seconds before the
worker restarted.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

from sqlalchemy import text as sa_text
from sqlmodel import Session

from app.core import pg_notify
from app.core.config import settings
from app.core.db import engine
from app.core.request_meter import metered
from app.services import pgmq
from app.services.quota import budget_for_sync_mode, charge_sync_job
from app.services.scraper_jobs import (
    SyncJobState,
    claim_job,
    deactivate_job,
    get_job,
    persist_job,
    touch_job,
)
from app.services.sync_lanes import DRAIN_ORDER, lane_for_budget

logger = logging.getLogger(__name__)

_TERMINAL_JOB_STATUSES = frozenset({"completed", "failed", "cancelled"})
_TERMINAL_CHANNEL_STATUSES = frozenset({"success", "failed", "skipped", "cancelled"})

#: The `LISTEN`/`NOTIFY` channel an enqueue rings to say a lane has work.
#:
#: Ticket 09 kicked a drain *in the enqueueing process*, which was right when
#: that process was also the consumer. After ticket 10 it is the bug the ticket
#: exists to fix: `POST /jobs/sync` runs in the API process, so a local kick
#: would have the API scraping Telegram again — exactly the work the worker was
#: split out to own, and exactly what a deploy interrupts.
#:
#: So the kick became a message. The API enqueues and rings; the worker is
#: subscribed and drains. The 30-second sweep stays as the backstop for a ring
#: that was lost (`NOTIFY` has no replay), which is what keeps the queue durable
#: rather than dependent on delivery.
SYNC_LANE_WAKE_CHANNEL = "sync_lane_wake"

#: `(job_id, channel_id)` pairs with a sync in flight *in this process*, right
#: now. Guards against a redelivered message reprocessing work that is still
#: genuinely running past its VT — the terminal-status check alone only catches
#: what has already finished. Process-local, which is all it can be until
#: ticket 11 puts the claim in the database.
_in_flight: set[tuple[str, str | None]] = set()

#: `(lane, msg_id)` for every message claimed from PGMQ and not yet resolved.
#: Read only by `_release_claimed_messages` on shutdown — see that function.
_claimed_messages: set[tuple[str, int]] = set()

#: One semaphore for the whole worker, built on first use because its size
#: comes from settings and the proxy pool rather than from a constant.
_concurrency_gate: asyncio.Semaphore | None = None
_concurrency_value = 0
_gate_lock = asyncio.Lock()


def _worst_case_fetch_seconds() -> float:
    """Worst case for one `network.fetch_with_retry` call: every attempt times
    out and every backoff hits its ceiling. `NETWORK_FETCH_RETRIES` attempts at
    up to `NETWORK_FETCH_TIMEOUT_SECONDS` each, plus the backoff between them
    (`network.py`'s `(2**i) * initial_delay_ms`, ignoring the sub-second jitter
    and the 429 floor — both smaller than what this already rounds up to).
    """
    retries = settings.NETWORK_FETCH_RETRIES
    timeout = settings.NETWORK_FETCH_TIMEOUT_SECONDS
    delay_ms = settings.NETWORK_FETCH_INITIAL_DELAY_MS
    backoff_ms: int = sum((2**i) * delay_ms for i in range(retries - 1))
    return float(retries * timeout + backoff_ms / 1000)


def _worst_case_channel_sync_seconds() -> float:
    """Worst case for one Channel sync that needs no backfill: one
    `get_channel_info` call plus one `_scrape_page_with_retry` cycle
    (`sync_orchestrator.py`) — its own outer retries (`SYNC_MAX_RETRIES`,
    `SYNC_RETRY_BACKOFF_BASE_MS`) wrapping `fetch_with_retry` again.

    Not a bound on total sync time: a Channel that still needs backfill
    (`needs_backfill` in `sync_orchestrator.py`) keeps paginating until it
    reaches the retention cutoff, and that has no hard cap today whether or
    not a queue sits in front of it. `visibility_timeout_seconds` below is
    sized from the *no-backfill* worst case and documents that gap rather than
    pretending to close it — closing it is a scheduling problem (ticket 11's
    claim, or a heartbeat-style VT extension), not a bigger constant.

    Now that a message is one Channel rather than one job, this is the worst
    case for the *whole* message rather than for a fraction of it — which is
    what makes a single VT meaningful across every lane.
    """
    fetch = _worst_case_fetch_seconds()
    page_retries = settings.SYNC_MAX_RETRIES
    page_backoff_ms: int = sum(
        (2**i) * settings.SYNC_RETRY_BACKOFF_BASE_MS for i in range(1, page_retries + 1)
    )
    worst_page = (page_retries + 1) * fetch + page_backoff_ms / 1000
    return fetch + worst_page  # get_channel_info + the one page


def visibility_timeout_seconds() -> int:
    """PGMQ VT for every sync lane.

    Decision 32 of `docs/multi-user-tenancy-plan.md`: "Visibility timeout ~=
    2x worst case per queue ... A bulk sync exceeding its VT would silently
    double-scrape and double-charge." Derived from the retry/timeout settings
    above rather than a literal, so it moves if they do instead of quietly
    going stale. At current defaults this is ~2.4 hours — generous on
    purpose: VT only bounds how long a genuinely crashed worker's message sits
    before redelivery, not how long the SSE stream takes to show progress.

    One value for all three lanes, because after ticket 10 every message is the
    same shape: one Channel. Decision 32's "generous on the bulk lane" was
    written when a bulk message meant fifty Channels behind one timeout; a
    per-lane VT would now be describing a difference that no longer exists.
    """
    return int(2 * _worst_case_channel_sync_seconds())


async def _gate() -> asyncio.Semaphore:
    """The worker's one concurrency gate, built once and refreshed on change.

    **The check-then-await is the bug this guards.** `drain_sync_lanes` gathers
    a whole batch of `_run_channel` coroutines; without the lock every one of
    them saw `_concurrency_gate is None`, awaited the settings read, and then
    assigned its *own* `Semaphore`. Ten Channels would scrape at once whatever
    `syncConcurrency` said — silently, only under concurrency, and pointed at
    the proxies this deployment is trying to be polite to.
    """
    global _concurrency_gate, _concurrency_value
    async with _gate_lock:
        from app.services.sync_orchestrator import _load_sync_job_concurrency

        concurrency, _capacity = await asyncio.to_thread(
            _load_sync_job_concurrency, None
        )
        concurrency = max(1, concurrency)
        if _concurrency_gate is None:
            _concurrency_value = concurrency
            _concurrency_gate = asyncio.Semaphore(concurrency)
        elif concurrency != _concurrency_value and not _in_flight:
            # Rebuilt only while nothing holds a permit, because replacing a
            # semaphore mid-flight loses the count of what is outstanding. An
            # operator's change therefore lands on the next idle drain rather
            # than needing a restart, which is what `run_sync_job` gave them
            # when it read this per job.
            _concurrency_value = concurrency
            _concurrency_gate = asyncio.Semaphore(concurrency)
        return _concurrency_gate


def reset_concurrency_gate_for_tests() -> None:
    global _concurrency_gate, _concurrency_value
    _concurrency_gate = None
    _concurrency_value = 0


def _send(lane: str, payload: dict[str, Any]) -> int:
    with Session(engine) as session:
        msg_id = pgmq.send(session, lane, payload)
        session.commit()
        return msg_id


def _send_batch(lane: str, payloads: list[dict[str, Any]]) -> list[int]:
    with Session(engine) as session:
        msg_ids = pgmq.send_batch(session, lane, payloads)
        session.commit()
        return msg_ids


def queued_job_ids() -> set[str]:
    """Job ids with at least one message still sitting on a lane.

    The worker calls this at boot, before `reconcile_interrupted_jobs`, and it
    is what keeps that function honest after the split.

    Reconcile fails every non-terminal row on the reasoning that in-memory
    progress cannot survive a restart, so any such row belongs to a dead
    process. **That stopped being true when the API started creating jobs on its
    own lifecycle.** Press Sync — or let a bulk follow chain one — while the
    worker is restarting, and the row exists, its messages are durably on a
    lane, and the booting worker marks the row `failed` and then archives every
    message for it as "already terminal". A 2,000-Channel `sync_all` interrupted
    at Channel 50 loses the other 1,950, and the browser is told it failed.

    A job with messages still queued is not dead — it is *waiting*, which is the
    entire point of putting a queue there. Messages claimed by a crashed worker
    count too: they are still rows here, just with a `vt` in the future, and
    they will be redelivered.

    Deliberately reads the queue tables directly rather than through
    `pgmq.read`, which would claim the messages and bump `read_ct`. Lane names
    come from `DRAIN_ORDER`, which is code, not input — the identifier quoting
    is belt-and-braces.
    """
    ids: set[str] = set()
    with Session(engine) as session:
        for lane in DRAIN_ORDER:
            rows = session.execute(
                sa_text(f"SELECT DISTINCT message->>'jobId' FROM pgmq.\"q_{lane}\"")
            ).all()
            ids.update(str(row[0]) for row in rows if row[0])
    return ids


def _batch_size() -> int:
    """How many messages one read claims.

    At least `SYNC_QUEUE_BATCH_SIZE`, but never below the configured
    concurrency: a batch is awaited as a unit, so a batch smaller than the gate
    is a **silent ceiling** on it — an operator setting `syncConcurrency` to 20
    would quietly get 10, with nothing anywhere saying so.

    A batch is still awaited as a whole, which means one Channel needing a deep
    backfill holds its slot while the rest of its batch finishes. `run_sync_job`
    kept the semaphore saturated across a whole job instead. Draining as slots
    free is the better shape and belongs with ticket 12, which owns the draining
    strategy; this at least stops the batch size from deciding the limit.
    """
    return max(settings.SYNC_QUEUE_BATCH_SIZE, _concurrency_value)


def _read_batch(lane: str) -> list[pgmq.PgmqMessage]:
    with Session(engine) as session:
        messages = pgmq.read(
            session,
            lane,
            vt_seconds=visibility_timeout_seconds(),
            qty=_batch_size(),
        )
        # `pgmq.read`'s claim *is* an UPDATE (bumping `vt`/`read_ct`) — closing
        # the session without committing rolls it back, which would silently
        # hand the same message to a second concurrent drain (the
        # post-enqueue kick racing the periodic sweep) despite `FOR UPDATE
        # SKIP LOCKED`, since an uncommitted claim releases its lock without
        # leaving any trace that it happened.
        session.commit()
        return messages


def _archive(lane: str, msg_id: int) -> None:
    with Session(engine) as session:
        pgmq.archive(session, lane, msg_id)
        session.commit()


def lane_for_job(job: SyncJobState) -> str:
    """The lane a job's Channels are enqueued to.

    Routed through `budget_for_sync_mode` rather than a second mapping of its
    own, so "which Budget is this charged against" and "which lane does it
    queue on" cannot drift apart — they are the same question about the same
    `sync_mode`, and ticket 12's weighting is defined in terms of the Budgets.
    """
    return lane_for_budget(budget_for_sync_mode(job.sync_mode))


async def enqueue_sync_job(job: SyncJobState, user_id: uuid.UUID | None) -> None:
    """Enqueue one message per Channel, then kick an immediate drain attempt.

    Called wherever `asyncio.create_task(run_sync_job(...))` used to be: `POST
    /jobs/sync`, `run_auto_sync`, and bulk follow. The job row already exists,
    so the SSE stream sees the same "pending" -> "running" -> terminal sequence
    it always has.
    """
    lane = lane_for_job(job)
    payloads = [
        {
            "jobId": job.job_id,
            "channelId": channel_id,
            "userId": str(user_id) if user_id else None,
        }
        for channel_id in job.channels
    ]
    # One statement, not one per Channel. `sync_all` on this deployment is
    # ~2,000 Channels and a bulk follow is hundreds, and the caller is a request
    # handler waiting to answer with a job id — sending them individually put
    # that many sequential round trips in front of the response, one of them
    # (`bulk_reset_and_queue_sync`) while still holding the route's session.
    await asyncio.to_thread(_send_batch, lane, payloads)

    # Best-effort: a lost ring costs latency, not the work — the worker's
    # periodic sweep still finds the messages. Never a local drain, however
    # convenient: see `SYNC_LANE_WAKE_CHANNEL`.
    try:
        await asyncio.to_thread(
            pg_notify.publish, SYNC_LANE_WAKE_CHANNEL, {"lane": lane}
        )
    except Exception:  # noqa: BLE001
        logger.warning("failed to ring the sync worker for lane %s", lane)


async def _guarded_drain() -> None:
    try:
        await drain_sync_lanes()
    except Exception:  # noqa: BLE001
        logger.exception("sync lane drain failed")


async def _consume_wakes() -> None:
    queue = pg_notify.listener(SYNC_LANE_WAKE_CHANNEL).subscribe()
    while True:
        await queue.get()
        # Coalesce: `drain_sync_lanes` reads whatever is due across every lane,
        # so N rings that arrive together are one drain, not N. Draining
        # sequentially here also means this consumer never overlaps itself.
        await _guarded_drain()


_lane_consumer = pg_notify.NotificationConsumer(lambda: _consume_wakes())


def start_lane_consumer() -> None:
    """Drain the lanes whenever an enqueue rings. Worker process only.

    Calling this in the API process would put the scraping back where ticket 10
    took it from, so `app/main.py` deliberately does not.
    """
    _lane_consumer.start()


def stop_lane_consumer() -> None:
    _lane_consumer.stop()
    # Cancelling the consumer abandons whatever it had claimed; hand those back
    # so a restart resumes instead of waiting out the visibility timeout.
    _release_claimed_messages()


def _recompute_job_status(job: SyncJobState) -> str | None:
    """The job's terminal status, or `None` while any Channel is still going.

    Same rule `run_sync_job` applied when it owned the whole batch: any success
    makes the job a success, because a fifty-Channel sync where forty-nine
    worked is not a failed sync.
    """
    if job.cancel_event.is_set():
        return "cancelled"
    if any(ch.status not in _TERMINAL_CHANNEL_STATUSES for ch in job.channels.values()):
        return None
    if any(ch.status == "success" for ch in job.channels.values()):
        return "completed"
    if all(ch.status == "skipped" for ch in job.channels.values()):
        return "completed"
    if any(ch.status == "cancelled" for ch in job.channels.values()):
        return "cancelled"
    return "failed"


async def _finalize_if_complete(job: SyncJobState) -> None:
    """Write the terminal row once every Channel of this job has finished.

    Imported lazily below for the reason `sync_orchestrator` already imports
    `CHECK_SOURCE` lazily: `auto_sync` imports this module to enqueue, so a
    module-level import back into it is a cycle at startup.
    """
    if job.status in _TERMINAL_JOB_STATUSES:
        return
    final = _recompute_job_status(job)
    if final is None:
        return
    job.status = final
    job.finished_at = int(time.time() * 1000)
    await persist_job(job)

    from app.jobs.auto_sync import CHECK_SOURCE, record_auto_sync_outcome

    if job.source == CHECK_SOURCE:
        # The scheduler's consecutive-failure counter and its auto-pause used to
        # be computed inline in `run_auto_sync`, which could only work while
        # that function awaited the whole sync. It no longer does.
        await asyncio.to_thread(record_auto_sync_outcome, job)

    deactivate_job(job.job_id)


async def _run_channel(
    job: SyncJobState,
    channel_id: str,
    user_id: uuid.UUID | None,
    gate: asyncio.Semaphore,
) -> None:
    from app.services.sync_orchestrator import sync_single_channel

    ch_state = job.channels.get(channel_id)
    if ch_state is None:
        logger.warning(
            "job %s has no channel %s; nothing to sync", job.job_id, channel_id
        )
        return

    # This process is the one running it, and `claim_job` is the only thing
    # that says so: `create_job` ran wherever the request landed. Until this
    # call the job is a mirror here, taking notifications from whoever else has
    # it — after it, this process's copy is authoritative.
    claim_job(job)
    if job.status == "pending":
        job.status = "running"
        await touch_job(job)

    async with gate:
        if job.cancel_event.is_set():
            ch_state.status = "cancelled"
            await touch_job(job, ch_state)
        else:
            await sync_single_channel(job, ch_state, user_id=user_id)
    await _finalize_if_complete(job)


async def _run_whole_job(job: SyncJobState, user_id: uuid.UUID | None) -> None:
    """The pre-ticket-10 path, for messages already on a lane at deploy time."""
    from app.services.sync_orchestrator import run_sync_job

    claim_job(job)
    await run_sync_job(job, user_id)


async def _process_message(msg: pgmq.PgmqMessage, gate: asyncio.Semaphore) -> None:
    job_id = msg.message.get("jobId")
    if not job_id:
        logger.warning("sync message %s has no jobId; archiving", msg.msg_id)
        return

    job = get_job(job_id)
    if job is None or job.status in _TERMINAL_JOB_STATUSES:
        # Already resolved (or the row is gone) — e.g. `reconcile_interrupted_jobs`
        # reached it first after a restart.
        return

    channel_id = msg.message.get("channelId")
    key = (job_id, channel_id)
    if key in _in_flight:
        logger.info(
            "sync message %s redelivered while %s is still running here; "
            "archiving without reprocessing",
            msg.msg_id,
            key,
        )
        return

    user_id_str = msg.message.get("userId")
    user_id = uuid.UUID(user_id_str) if user_id_str else None

    _in_flight.add(key)
    try:
        if not channel_id:
            # Pre-ticket-10 message. `run_sync_job` opens and charges its own
            # meter, so this path must not open a second one around it — that
            # would bill the same Requests twice.
            await _run_whole_job(job, user_id)
            return
        # One meter per message: the Requests this Channel actually made,
        # accumulating into the same daily row as its siblings. Charged from a
        # `finally` so a Channel that dies part-way still pays for the pages it
        # fetched, which is the argument `run_sync_job` already made.
        with metered() as meter:
            try:
                await _run_channel(job, channel_id, user_id, gate)
            finally:
                await asyncio.to_thread(
                    charge_sync_job, user_id, job.sync_mode, meter.telegram_requests
                )
    finally:
        _in_flight.discard(key)


async def _fail_exhausted(msg: pgmq.PgmqMessage) -> None:
    logger.error(
        "sync message %s exceeded %s redeliveries; archiving",
        msg.msg_id,
        settings.SYNC_QUEUE_MAX_READ_COUNT,
    )
    job_id = msg.message.get("jobId")
    if not job_id:
        return
    job = get_job(job_id)
    if job is None or job.status in _TERMINAL_JOB_STATUSES:
        return

    channel_id = msg.message.get("channelId")
    if channel_id is None:
        # A pre-ticket-10 message stood for the whole job, so exhausting it does
        # fail every Channel. A per-Channel message naming a Channel this job
        # does not have is a different thing entirely, and failing its 49
        # siblings for it is exactly the blast radius per-Channel messages exist
        # to remove.
        targets = list(job.channels.values())
    elif channel_id in job.channels:
        targets = [job.channels[channel_id]]
    else:
        logger.warning(
            "sync message %s names channel %s, absent from job %s; failing nothing",
            msg.msg_id,
            channel_id,
            job_id,
        )
        return
    for ch in targets:
        if ch.status in ("pending", "running"):
            ch.status = "failed"
            ch.error = "Exceeded redelivery limit"
    # Only the Channels this message owned failed; the job is terminal when its
    # last Channel is, which may be now or may be another message from now.
    await persist_job(job)
    await _finalize_if_complete(job)


def _release_claimed_messages() -> None:
    """Hand back every message this worker claimed but did not finish.

    Called on shutdown. `pgmq.read` made these invisible for
    `visibility_timeout_seconds()` — about 2.4 hours — so without this a
    restart parks whatever was mid-flight for that long, and
    `reconcile_interrupted_jobs` marks the rows `failed` on the next boot. By
    the time the message reappears `_process_message` sees a terminal job and
    archives it without syncing anything, so the work is simply lost.

    In production that is one deploy's worth. In dev it is **every file save**,
    because `compose.override.yml` restarts the worker on change.

    Best-effort by construction: a failure here leaves the old behaviour, which
    is what this is improving on rather than depending on.
    """
    if not _claimed_messages:
        return
    try:
        with Session(engine) as session:
            for lane, msg_id in list(_claimed_messages):
                pgmq.set_vt(session, lane, msg_id, 0)
            session.commit()
        logger.info(
            "released %s claimed sync message(s) back to their lanes",
            len(_claimed_messages),
        )
    except Exception:  # noqa: BLE001
        logger.warning("could not release claimed sync messages on shutdown")
    finally:
        _claimed_messages.clear()


async def _handle_one(lane: str, msg: pgmq.PgmqMessage, gate: asyncio.Semaphore) -> str:
    """Process (or exhaust) one claimed message. Returns an outcome tag."""
    _claimed_messages.add((lane, msg.msg_id))
    try:
        return await _handle_one_inner(lane, msg, gate)
    finally:
        _claimed_messages.discard((lane, msg.msg_id))


async def _handle_one_inner(
    lane: str, msg: pgmq.PgmqMessage, gate: asyncio.Semaphore
) -> str:
    if msg.read_ct > settings.SYNC_QUEUE_MAX_READ_COUNT:
        await _fail_exhausted(msg)
        await asyncio.to_thread(_archive, lane, msg.msg_id)
        return "exhausted"
    try:
        await _process_message(msg, gate)
    except Exception:
        # Do not archive: leave it on the queue so PGMQ redelivers it once
        # `vt` lapses, up to `SYNC_QUEUE_MAX_READ_COUNT` reads.
        logger.exception("sync message %s crashed mid-run", msg.msg_id)
        # Release the job's claim on this process — but only once *no sibling
        # message of the same job is still running here*.
        #
        # `claim_job` put the job in `_active_jobs` and only
        # `_finalize_if_complete` takes it out, so a crash outside
        # `sync_single_channel`'s own handler (a database blip in `claim_job` or
        # `touch_job`) would otherwise leave it there with Channels unfinished:
        # `has_active_sync_job()` answers True and auto-sync skips every tick
        # until the ~2.4h visibility timeout lapses.
        #
        # Releasing it unconditionally is worse, though, and a message now owns
        # one Channel out of possibly fifty. Dropping the whole job while nine
        # siblings are mid-scrape means the next message for it finds nothing in
        # `_active_jobs`, rebuilds a **second** `SyncJobState` from a row that
        # lags by `SYNC_JOB_PERSIST_INTERVAL_MS`, and that copy waits forever for
        # Channels whose messages were already archived. The job never finishes
        # and the next auto-sync tick starts one competing with it.
        job_id = msg.message.get("jobId")
        if isinstance(job_id, str) and not any(
            in_flight_job == job_id for in_flight_job, _ in _in_flight
        ):
            deactivate_job(job_id)
        return "crashed"
    await asyncio.to_thread(_archive, lane, msg.msg_id)
    return "processed"


async def drain_sync_lanes() -> dict[str, int]:
    """Read and process everything currently due, lane by lane.

    Lanes are drained in `DRAIN_ORDER` — single, then bulk, then automatic —
    but a lane's own batch runs concurrently, because serializing a batch would
    silently un-parallelize what used to be one `asyncio.create_task` per
    request. The real limiter downstream is the worker's concurrency gate,
    resolved once here rather than per Channel: it reads settings and the proxy
    pool, and that is a query nobody needs fifty times a drain.

    **Each lane is drained until it is empty, not one batch and done.** An
    enqueue rings once per *job*, and `_read_batch` claims at most
    `SYNC_QUEUE_BATCH_SIZE`. A single batch per ring therefore left a
    50-Channel bulk reset with 40 messages waiting on 30-second sweeps — about
    two minutes of doing nothing, and a bulk follow of 300 handles idling for a
    quarter of an hour. Nothing failed; it was just slow in a way no log line
    would explain.
    """
    gate = await _gate()
    processed = 0
    exhausted = 0
    for lane in DRAIN_ORDER:
        while True:
            messages = await asyncio.to_thread(_read_batch, lane)
            if not messages:
                break
            outcomes = await asyncio.gather(
                *(_handle_one(lane, msg, gate) for msg in messages)
            )
            processed += outcomes.count("processed")
            exhausted += outcomes.count("exhausted")
            if len(messages) < _batch_size():
                break
    return {"processed": processed, "exhausted": exhausted}


async def job_sync_queue() -> dict[str, Any]:
    """Periodic backstop sweep — registered directly in `scheduler.py`.

    Not a toggleable entry in `JOB_IDS`/the Jobs UI: disabling it would strand
    every queued sync silently, which is not a choice an operator should be one
    checkbox away from, unlike pausing auto-sync.
    """
    return await drain_sync_lanes()
