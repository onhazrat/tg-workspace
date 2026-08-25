"""Consumes `manual_single_normal` in-process (ticket 09 — the first lane).

A manual single sync (`sync_mode == "individual"`, one Channel, `Budget.
MANUAL_SINGLE`) now travels through a real PGMQ queue instead of an
`asyncio.create_task` fired straight from the request handler. The job row and
its SSE stream (`app/services/scraper_jobs.py`, `GET
/jobs/sync/{id}/events`) are unchanged — this only changes what schedules
`run_sync_job`, not what reports its progress, so the browser sees the same
protocol it always has (just, correctly, extra latency between "enqueued" and
"running" while the message sits on the lane).

**Two paths drain the lane, and both are safe to run concurrently.**
`enqueue_manual_single_sync` fires an immediate best-effort drain right after
sending, so the common case (this process, not crashed, nothing else
mid-drain) sees no added latency at all. `job_manual_single_queue` is the
periodic backstop registered in `scheduler.py` — it is what actually makes the
queue durable: a kick that dies, a redelivery after a crash, a message that
arrives while the consumer is mid-drain of an earlier batch, all get picked up
here instead of waiting forever. `pgmq.read`'s `FOR UPDATE SKIP LOCKED` is what
lets the two race without either double-claiming a message.

**Still in the web process.** Ticket 10 moves this consumer into its own
process so an API restart no longer aborts an in-flight sync; until then this
carries the same restart risk `run_sync_job` always did. Two things follow
from that risk today:

* `reconcile_interrupted_jobs` (`scraper_jobs.py`) runs at startup and marks
  every non-terminal `tg_sync_jobs` row `failed`, on the assumption that
  in-memory state does not survive a restart. A message that was mid-flight
  during that restart is still on the queue and will be redelivered once its
  VT lapses — `_process_message` below checks the job's status first and
  archives without reprocessing if it is already terminal, so a redelivered
  message cannot resurrect a job the client already saw finish.
* Nothing yet enforces one sync per Channel at a time outside process memory
  (ticket 11). Two individual syncs enqueued for the same Channel run
  concurrently exactly as they would have before this ticket.

**Redelivery while still genuinely running, in this same process.** VT is
sized from the no-backfill case (see `visibility_timeout_seconds`), so a
Channel that needs backfill can still be mid-`run_sync_job` when its message
is redelivered — the job's status is `running`, not terminal, so the
terminal-status check above does not catch it. `_in_flight_job_ids` is the
guard for that: it is process-local (matches everything else here being
process-local until ticket 10), and it is what stops the redelivered copy
from calling `run_sync_job` a second time on the same `SyncJobState` while
the first call is still in `asyncio.gather` over its channels — the exact
double-scrape/double-charge decision 32 sizes the VT to avoid, for the one
case sizing the VT cannot avoid it.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services import pgmq
from app.services.scraper_jobs import get_job, persist_job
from app.services.sync_lanes import MANUAL_SINGLE_NORMAL_LANE
from app.services.sync_orchestrator import run_sync_job

logger = logging.getLogger(__name__)

_TERMINAL_JOB_STATUSES = frozenset({"completed", "failed", "cancelled"})

#: Strong references for the post-enqueue kick's fire-and-forget task.
#: `asyncio.create_task` documents this exact hazard: nothing else holds a
#: reference to the task object, so the event loop is free to garbage-collect
#: it *mid-execution* — silently abandoning a drain after it claimed a
#: message (bumping `read_ct`/`vt`) but before `_archive` ran. The periodic
#: sweep would eventually redeliver it, but only after the full VT, which is
#: why this was worth a real fix rather than a documented gap.
_pending_kicks: set[asyncio.Task[None]] = set()

#: Job ids with a `run_sync_job` call in flight *in this process*, right now.
#: Guards against a redelivered message reprocessing a job that is still
#: genuinely running (see the module docstring's "Redelivery while still
#: genuinely running" section) — the terminal-status check alone only
#: catches a job that has already finished, not one still in progress past
#: its VT.
_in_flight_job_ids: set[str] = set()


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
    """Worst case for one manual single-Channel sync that needs no backfill:
    one `get_channel_info` call plus one `_scrape_page_with_retry` cycle
    (`sync_orchestrator.py`) — its own outer retries (`SYNC_MAX_RETRIES`,
    `SYNC_RETRY_BACKOFF_BASE_MS`) wrapping `fetch_with_retry` again.

    Not a bound on total sync time: a Channel that still needs backfill
    (`needs_backfill` in `sync_orchestrator.py`) keeps paginating until it
    reaches the retention cutoff, and that has no hard cap today whether or
    not a queue sits in front of it. `visibility_timeout_seconds` below is
    sized from the *no-backfill* worst case and documents that gap rather than
    pretending to close it — closing it is a scheduling problem (ticket 11's
    claim, or a heartbeat-style VT extension), not a bigger constant.
    """
    fetch = _worst_case_fetch_seconds()
    page_retries = settings.SYNC_MAX_RETRIES
    page_backoff_ms: int = sum(
        (2**i) * settings.SYNC_RETRY_BACKOFF_BASE_MS for i in range(1, page_retries + 1)
    )
    worst_page = (page_retries + 1) * fetch + page_backoff_ms / 1000
    return fetch + worst_page  # get_channel_info + the one page


def visibility_timeout_seconds() -> int:
    """PGMQ VT for `manual_single_normal`.

    Decision 32 of `docs/multi-user-tenancy-plan.md`: "Visibility timeout ~=
    2x worst case per queue ... A bulk sync exceeding its VT would silently
    double-scrape and double-charge." Derived from the retry/timeout settings
    above rather than a literal, so it moves if they do instead of quietly
    going stale. At current defaults this is ~2.4 hours — generous on
    purpose: VT only bounds how long a genuinely crashed worker's message sits
    before redelivery, not how long the SSE stream takes to show progress.
    """
    return int(2 * _worst_case_channel_sync_seconds())


def _send(job_id: str, user_id: uuid.UUID | None) -> int:
    with Session(engine) as session:
        msg_id = pgmq.send(
            session,
            MANUAL_SINGLE_NORMAL_LANE,
            {"jobId": job_id, "userId": str(user_id) if user_id else None},
        )
        session.commit()
        return msg_id


def _read_batch() -> list[pgmq.PgmqMessage]:
    with Session(engine) as session:
        messages = pgmq.read(
            session,
            MANUAL_SINGLE_NORMAL_LANE,
            vt_seconds=visibility_timeout_seconds(),
            qty=settings.MANUAL_SINGLE_QUEUE_BATCH_SIZE,
        )
        # `pgmq.read`'s claim *is* an UPDATE (bumping `vt`/`read_ct`) — closing
        # the session without committing rolls it back, which would silently
        # hand the same message to a second concurrent drain (the
        # post-enqueue kick racing the periodic sweep) despite `FOR UPDATE
        # SKIP LOCKED`, since an uncommitted claim releases its lock without
        # leaving any trace that it happened.
        session.commit()
        return messages


def _archive(msg_id: int) -> None:
    with Session(engine) as session:
        pgmq.archive(session, MANUAL_SINGLE_NORMAL_LANE, msg_id)
        session.commit()


async def enqueue_manual_single_sync(job_id: str, user_id: uuid.UUID | None) -> None:
    """Enqueue one manual single sync and kick an immediate drain attempt.

    Called from `POST /jobs/sync` once the job row already exists (`
    create_job`), in place of the old `asyncio.create_task(run_sync_job(...))`
    — everything downstream of "a message is due" is unchanged.
    """
    await asyncio.to_thread(_send, job_id, user_id)
    # Best-effort: a failure here is not fatal, `job_manual_single_queue`'s
    # periodic sweep (scheduler.py) will still pick the message up. The task
    # is held in `_pending_kicks` (and dropped on completion) so nothing
    # garbage-collects it mid-drain — see that set's docstring.
    task = asyncio.create_task(_guarded_drain())
    _pending_kicks.add(task)
    task.add_done_callback(_pending_kicks.discard)


async def _guarded_drain() -> None:
    try:
        await drain_manual_single_lane()
    except Exception:  # noqa: BLE001
        logger.exception("manual_single_normal post-enqueue drain failed")


async def _process_message(msg: pgmq.PgmqMessage) -> None:
    job_id = msg.message.get("jobId")
    if not job_id:
        logger.warning(
            "manual_single_normal message %s has no jobId; archiving", msg.msg_id
        )
        return

    job = get_job(job_id)
    if job is None or job.status in _TERMINAL_JOB_STATUSES:
        # Already resolved (or the row is gone) — e.g. `reconcile_interrupted_jobs`
        # reached it first after a restart. See the module docstring.
        return
    if job_id in _in_flight_job_ids:
        # Redelivered while a call to `run_sync_job` for this exact job is
        # still running in this process — see the module docstring. Archiving
        # this copy is correct either way: the in-flight call is the one
        # actually driving the job to completion, and letting this copy
        # start a second `run_sync_job` is the double-scrape decision 32
        # sizes the VT to avoid.
        logger.info(
            "manual_single_normal message %s redelivered while job %s is "
            "still running in this process; archiving without reprocessing",
            msg.msg_id,
            job_id,
        )
        return

    user_id_str = msg.message.get("userId")
    user_id = uuid.UUID(user_id_str) if user_id_str else None
    _in_flight_job_ids.add(job_id)
    try:
        await run_sync_job(job, user_id)
    finally:
        _in_flight_job_ids.discard(job_id)


async def _fail_exhausted(msg: pgmq.PgmqMessage) -> None:
    logger.error(
        "manual_single_normal message %s exceeded %s redeliveries; archiving",
        msg.msg_id,
        settings.MANUAL_SINGLE_QUEUE_MAX_READ_COUNT,
    )
    job_id = msg.message.get("jobId")
    if not job_id:
        return
    job = get_job(job_id)
    if job is None or job.status in _TERMINAL_JOB_STATUSES:
        return
    job.status = "failed"
    job.finished_at = job.finished_at or int(time.time() * 1000)
    for ch in job.channels.values():
        if ch.status in ("pending", "running"):
            ch.status = "failed"
            ch.error = "Exceeded redelivery limit on manual_single_normal"
    await persist_job(job)


async def _handle_one(msg: pgmq.PgmqMessage) -> str:
    """Process (or exhaust) one claimed message. Returns an outcome tag.

    Left as its own coroutine, run concurrently across a batch by
    `drain_manual_single_lane` — a plain sequential loop here would serialize
    every message a single drain call claims, silently un-parallelizing what
    used to be one `asyncio.create_task` per request. `MANUAL_SINGLE_QUEUE_
    BATCH_SIZE`'s own docstring already assumes concurrency across a batch is
    safe (the proxy pool is the real limiter downstream); this is what makes
    that true rather than aspirational.
    """
    if msg.read_ct > settings.MANUAL_SINGLE_QUEUE_MAX_READ_COUNT:
        await _fail_exhausted(msg)
        await asyncio.to_thread(_archive, msg.msg_id)
        return "exhausted"
    try:
        await _process_message(msg)
    except Exception:
        # Do not archive: leave it on the queue so PGMQ redelivers it once
        # `vt` lapses, up to `MANUAL_SINGLE_QUEUE_MAX_READ_COUNT` reads.
        logger.exception("manual_single_normal message %s crashed mid-run", msg.msg_id)
        return "crashed"
    await asyncio.to_thread(_archive, msg.msg_id)
    return "processed"


async def drain_manual_single_lane() -> dict[str, int]:
    """Read and process everything currently due. Returns counts for tests."""
    messages = await asyncio.to_thread(_read_batch)
    outcomes = await asyncio.gather(*(_handle_one(msg) for msg in messages))
    return {
        "processed": outcomes.count("processed"),
        "exhausted": outcomes.count("exhausted"),
    }


async def job_manual_single_queue() -> dict[str, Any]:
    """Periodic backstop sweep — registered directly in `scheduler.py`.

    Not a toggleable entry in `JOB_IDS`/the Jobs UI: disabling it would strand
    every manual single sync silently, which is not a choice an operator
    should be one checkbox away from, unlike pausing auto-sync.
    """
    return await drain_manual_single_lane()
