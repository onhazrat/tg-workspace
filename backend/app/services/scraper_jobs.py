"""Persistent sync job registry (Phase 4.5 — DECISION #9)."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, cast

from sqlalchemy import true as sa_true
from sqlalchemy import update as sa_update
from sqlmodel import Session, col, delete, select

from app.core import pg_notify
from app.core.config import settings
from app.core.db import engine
from app.models_tg import SyncJob as SyncJobRow
from app.models_tg import utc_now
from app.services.channel_setting_groups import SyncOperationMode
from app.services.tenancy import scoped_select, tenancy_enforced

#: The one `LISTEN`/`NOTIFY` channel every sync job's progress travels on
#: (ticket 10). One channel rather than one per job: `LISTEN` is per-connection,
#: so per-job channels would mean either a connection per watcher or a
#: `LISTEN`/`UNLISTEN` race on a shared one. See `core/pg_notify.py`.
SYNC_JOB_PROGRESS_CHANNEL = "sync_job_progress"

_cancel_events: dict[str, asyncio.Event] = {}
_active_jobs: dict[str, SyncJobState] = {}
_jobs_lock = asyncio.Lock()

#: Jobs this process is *watching* but not running — the SSE mirror (ticket 10).
#: Deliberately not `_active_jobs`: that dict means "this process is running
#: it", which is what `has_active_sync_job` answers from, and folding watched
#: jobs into it would tell the worker's scheduler that a sync is in flight
#: because a browser happened to open a progress stream.
_mirrored_jobs: dict[str, SyncJobState] = {}

logger = logging.getLogger(__name__)

#: Rows per delete transaction in `prune_finished_jobs`. Bounds transaction
#: length, not memory — see that function.
SYNC_JOB_DELETE_BATCH = 1000

_TERMINAL_JOB_STATUSES = frozenset({"completed", "failed", "cancelled"})


@dataclass
class ChannelSyncState:
    channel_id: str
    channel_name: str
    status: str = "pending"
    posts_fetched: int = 0
    new_latest_id: int | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_camel(self) -> dict[str, Any]:
        return {
            "channelId": self.channel_id,
            "channelName": self.channel_name,
            "status": self.status,
            "postsFetched": self.posts_fetched,
            "newLatestId": self.new_latest_id,
            "error": self.error,
            "metadata": self.metadata,
        }


@dataclass
class SyncJobState:
    job_id: str
    source: str
    status: str = "pending"
    channels: dict[str, ChannelSyncState] = field(default_factory=dict)
    created_at: int = field(default_factory=lambda: int(time.time() * 1000))
    finished_at: int | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    user_id: str | None = None
    sync_mode: SyncOperationMode = "auto"
    _update_condition: asyncio.Condition = field(
        default_factory=asyncio.Condition, repr=False
    )
    _update_seq: int = field(default=0, repr=False)
    _flushed_job_status: str = field(default="", repr=False)
    _last_persist_at_ms: float = field(default=0.0, repr=False)
    #: Mirror bookkeeping (ticket 10), meaningless for a job this process runs.
    #: `_mirror_synced_at_ms` is the last read of the row, `_mirror_notified_at_ms`
    #: the last notification applied — `get_job` re-reads the row only when both
    #: have gone quiet, so a stream fed by notifications does not pay for a query
    #: per second, and one whose notifications are lost still recovers.
    _mirror_synced_at_ms: float = field(default=0.0, repr=False)
    _mirror_notified_at_ms: float = field(default=0.0, repr=False)
    #: Publish throttling — the last Channel statuses this job announced, and
    #: when it last announced anything. See `_should_publish`.
    _published_channel_statuses: dict[str, str] = field(
        default_factory=dict, repr=False
    )
    _published_job_status: str = field(default="", repr=False)
    _last_published_at_ms: float = field(default=0.0, repr=False)

    def to_camel(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "status": self.status,
            "source": self.source,
            "channels": [ch.to_camel() for ch in self.channels.values()],
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
        }


def _channels_to_json(channels: dict[str, ChannelSyncState]) -> list[dict[str, Any]]:
    return [ch.to_camel() for ch in channels.values()]


def _channels_from_json(data: list[dict[str, Any]]) -> dict[str, ChannelSyncState]:
    result: dict[str, ChannelSyncState] = {}
    for ch in data:
        cid = ch["channelId"]
        result[cid] = ChannelSyncState(
            channel_id=cid,
            channel_name=ch["channelName"],
            status=ch.get("status", "pending"),
            posts_fetched=ch.get("postsFetched", 0),
            new_latest_id=ch.get("newLatestId"),
            error=ch.get("error"),
            metadata=ch.get("metadata") or {},
        )
    return result


def _mark_flushed(job: SyncJobState) -> None:
    job._flushed_job_status = job.status
    job._last_persist_at_ms = time.monotonic() * 1000


def _should_flush_db(job: SyncJobState) -> bool:
    """Whether to write the row now, or let the next status change carry it.

    A *per-channel status change* used to force a flush, and `_persist_job`
    rewrites the entire channel array to record one entry — so a job covering
    2,077 channels rewrote a 2,077-element JSON document on every one of its
    ~6,000 transitions. Measured on staging: **94,994 `UPDATE tg_sync_jobs SET
    channels=<json>` in 10 hours, 7.5 minutes of database time and 270k block
    reads**, quadratic in job size, and a whole-table job is the normal case for
    this deployment.

    The row is not the live read path. `get_job` serves `_active_jobs` from
    memory and only falls back to the row when the process no longer holds the
    job, so what the row buys is crash recovery — for which the interval that
    already governs `postsFetched` staleness is the right granularity for
    statuses too.

    Terminal statuses and job-level transitions still flush immediately, so the
    final state of a job is never left to a timer.
    """
    if job.status in _TERMINAL_JOB_STATUSES:
        return True
    if job.status != job._flushed_job_status:
        return True
    elapsed_ms = time.monotonic() * 1000 - job._last_persist_at_ms
    return elapsed_ms >= settings.SYNC_JOB_PERSIST_INTERVAL_MS


def _get_cancel_event(job_id: str) -> asyncio.Event:
    """The job's cancellation flag, created on first mention.

    Bounded like `_mirrored_jobs`, and for the same reason: `deactivate_job` is
    the only thing that prunes this, and after ticket 10 it runs only in the
    worker. The API adds an entry for every distinct job id it hydrates from a
    row — every `GET /jobs/sync/{id}`, every stream, and every
    `runtime-config` read that falls back to `_running_job_from_row` — and
    never removes one. Evicting an old flag is safe: the next mention recreates
    it, and a *cancelled* job is recognised from `row.status` rather than from
    whatever this dict remembers.
    """
    if job_id not in _cancel_events:
        _cancel_events[job_id] = asyncio.Event()
        while len(_cancel_events) > MAX_TRACKED_CANCEL_EVENTS:
            oldest = next(iter(_cancel_events))
            if oldest == job_id:
                break
            _cancel_events.pop(oldest)
    return _cancel_events[job_id]


def _row_to_state(row: SyncJobRow) -> SyncJobState:
    cancel_event = _get_cancel_event(row.id)
    if row.status == "cancelled":
        cancel_event.set()
    job = SyncJobState(
        job_id=row.id,
        source=row.source,
        status=row.status,
        channels=_channels_from_json(row.channels),
        created_at=row.created_at,
        finished_at=row.finished_at,
        cancel_event=cancel_event,
        user_id=str(row.user_id) if row.user_id else None,
        sync_mode=cast(SyncOperationMode, row.sync_mode or "auto"),
    )
    _mark_flushed(job)
    return job


def _persist_job(job: SyncJobState) -> None:
    with Session(engine) as session:
        row = session.get(SyncJobRow, job.job_id)
        if row is None:
            uid = uuid.UUID(job.user_id) if job.user_id else None
            row = SyncJobRow(
                id=job.job_id,
                user_id=uid,
                status=job.status,
                source=job.source,
                sync_mode=job.sync_mode,
                channels=_channels_to_json(job.channels),
                created_at=job.created_at,
                finished_at=job.finished_at,
            )
        else:
            row.status = job.status
            row.channels = _channels_to_json(job.channels)
            row.finished_at = job.finished_at
            row.updated_at = utc_now()
        session.add(row)
        session.commit()


async def _notify_job_update(job: SyncJobState) -> None:
    async with job._update_condition:
        job._update_seq += 1
        job._update_condition.notify_all()


#: How many watched-but-not-run jobs this process keeps mirrored. Evicting one
#: costs a row read to rebuild it, never correctness, so a modest cap is free
#: insurance against the mirror becoming a leak: `GET /jobs/sync/{id}` seeds an
#: entry for any job id a client asks about, and nothing about a finished job
#: makes it fall out on its own.
MAX_MIRRORED_JOBS = 256

#: Same bound, same reason, for the cancellation flags. See `_get_cancel_event`.
MAX_TRACKED_CANCEL_EVENTS = 256


def _remember(job: SyncJobState) -> None:
    """Keep this process's reference to `job` current, without claiming it.

    Ownership is decided once, by `claim_job`, and never by a progress update.
    That distinction is the whole cross-process design: `_active_jobs` means
    "this process is running it", so `get_job` serves it verbatim and
    `apply_progress_event` ignores notifications about it as its own echo. When
    `create_job` and `persist_job` wrote to `_active_jobs` unconditionally, the
    API process claimed every job it created — and then served a stream stuck at
    `pending` forever, discarding every delta the worker sent, because it
    believed it was the one running the sync.
    """
    if job.job_id in _active_jobs:
        _active_jobs[job.job_id] = job
        return
    # Popped before reinserting, so a job that is still being updated moves to
    # the end. Plain assignment leaves a `dict` key where it first went in, so
    # the eviction below would be oldest-*created* rather than
    # least-recently-used — and would drop the job someone is actively watching
    # in favour of an idle one that happened to arrive later.
    _mirrored_jobs.pop(job.job_id, None)
    _mirrored_jobs[job.job_id] = job
    while len(_mirrored_jobs) > MAX_MIRRORED_JOBS:
        _mirrored_jobs.pop(next(iter(_mirrored_jobs)))


def claim_job(job: SyncJobState) -> None:
    """Declare that *this* process is running this job.

    Called by the queue consumer as it starts a Channel, which is the only
    moment anything knows the answer — the enqueueing process does not, and
    guessing is what made the API believe it owned every sync it created.
    """
    _mirrored_jobs.pop(job.job_id, None)
    _active_jobs[job.job_id] = job


def _should_publish(job: SyncJobState, changed: ChannelSyncState | None) -> bool:
    """Whether this update is worth a `NOTIFY`.

    A *status* transition always is — that is what a watcher renders and what
    `_sync_status_changed` decides to send on. Everything else is progress
    counting, and `_walk_channel_pages` calls `touch_job` **once per scraped
    page**: publishing all of it means thousands of round trips during a deep
    backfill, each a pooled connection and a thread hop. That is the same shape
    as the 94,994 row writes `_should_flush_db` exists to avoid, and it would
    have been reintroduced one layer up.

    So counters ride the SSE cadence the browser is throttled to anyway.
    """
    if job.status != job._published_job_status:
        return True
    if changed is not None and (
        job._published_channel_statuses.get(changed.channel_id) != changed.status
    ):
        return True
    elapsed = time.monotonic() * 1000 - job._last_published_at_ms
    return elapsed >= settings.SYNC_JOB_SSE_THROTTLE_MS


async def _publish_progress(
    job: SyncJobState, changed: ChannelSyncState | None
) -> None:
    """Tell other processes this job moved (ticket 10).

    **The delta rides along, rather than only the job id.** The scaling doc's
    step 1 says "send the job id, let the reader fetch state", written when the
    reader was assumed to re-read the row — but the row is exactly what is
    throttled to `SYNC_JOB_PERSIST_INTERVAL_MS`, so a wakeup that forces a row
    read buys a faster poll of stale data and nothing else. One channel's state
    is a few hundred bytes against `pg_notify`'s 8000-byte cap, and it costs no
    table write, so the watcher gets the transition at the moment it happens
    while the row keeps its 5-second crash-recovery cadence.

    Making the *row* fresher instead was never an option: `_persist_job`
    rewrites the whole `channels` array to record one entry, which is the
    94,994-UPDATE measurement `_should_flush_db` exists to avoid.

    `changed` is `None` for a job-level transition, which the reader answers by
    re-reading the row — correct but slow, and the reason every per-channel
    call site passes its `ch_state`.

    Best-effort by construction: a failure to notify must never fail a sync, and
    the durable copy is the row either way.
    """
    if not _should_publish(job, changed):
        return
    payload: dict[str, Any] = {
        "jobId": job.job_id,
        "jobStatus": job.status,
        "finishedAt": job.finished_at,
    }
    if changed is not None:
        payload["channel"] = changed.to_camel()
        job._published_channel_statuses[changed.channel_id] = changed.status
    job._published_job_status = job.status
    job._last_published_at_ms = time.monotonic() * 1000
    try:
        await asyncio.to_thread(pg_notify.publish, SYNC_JOB_PROGRESS_CHANNEL, payload)
    except Exception:  # noqa: BLE001
        logger.warning("failed to publish progress for job %s", job.job_id)


async def touch_job(job: SyncJobState, changed: ChannelSyncState | None = None) -> None:
    """Update in-memory job state, notify SSE subscribers, flush DB when needed.

    `changed` names the Channel whose state just moved, so the notification can
    carry it — see `_publish_progress`. It is optional because one call site
    (`run_sync_job`'s job-level "running") genuinely has no channel in hand, not
    because it is safe to omit: leaving it off downgrades a live transition to a
    row read on every process that is not this one.
    """
    should_flush = False
    async with _jobs_lock:
        _remember(job)
        should_flush = _should_flush_db(job)

    if should_flush:
        await asyncio.to_thread(_persist_job, job)
        async with _jobs_lock:
            _mark_flushed(job)

    await _notify_job_update(job)
    await _publish_progress(job, changed)


async def persist_job(
    job: SyncJobState, changed: ChannelSyncState | None = None
) -> None:
    """Force a DB flush (job create, cancel, terminal)."""
    await asyncio.to_thread(_persist_job, job)
    async with _jobs_lock:
        _mark_flushed(job)
        _remember(job)
    await _notify_job_update(job)
    await _publish_progress(job, changed)


async def wait_job_update(job: SyncJobState, *, seen_seq: int, timeout_s: float) -> int:
    """Wait until the job is updated or timeout. Returns the current update seq."""
    async with job._update_condition:
        if job._update_seq > seen_seq:
            return job._update_seq
        try:
            await asyncio.wait_for(
                job._update_condition.wait_for(lambda: job._update_seq > seen_seq),
                timeout=timeout_s,
            )
        except TimeoutError:
            pass
        return job._update_seq


async def create_job(
    *,
    channel_entries: list[tuple[str, str]],
    source: str,
    user_id: str,
    channel_meta_by_id: dict[str, dict[str, Any]] | None = None,
    sync_mode: SyncOperationMode = "auto",
) -> SyncJobState:
    """Create a sync job owned by `user_id`.

    **`user_id` is required with no default**, which is ticket 21 closing the
    sharpest of the unowned-row producers. `SyncJob` is `USER_OWNED`, and this
    parameter defaulted to `None` while `_persist_job` wrote it straight through
    as the row's owner — so the scheduler minted a job nobody owns on every
    tick, indefinitely, rather than leaving a fixed legacy set a backfill could
    settle. Ticket 35 pinned the consequence: `activeSyncJob` reports nothing
    for an auto-sync once the flag flips.

    The callers that could reach the default were the two scheduler paths, and
    both now resolve a real account or decline to run. Every other caller was
    already passing `str(current_user.id)` behind an authenticated dependency,
    so the default was unreachable there and only ever served the two that
    should not have had it.
    """
    job_id = str(uuid.uuid4())
    channels = {
        cid: ChannelSyncState(
            channel_id=cid,
            channel_name=name,
            metadata=(channel_meta_by_id or {}).get(cid, {}),
        )
        for cid, name in channel_entries
    }
    job = SyncJobState(
        job_id=job_id,
        source=source,
        channels=channels,
        user_id=user_id,
        sync_mode=sync_mode,
        cancel_event=_get_cancel_event(job_id),
    )
    # Deliberately *not* claimed. `create_job` runs wherever the request landed
    # — `POST /jobs/sync` is the API process — and after ticket 10 that is
    # almost never the process that will run it. See `claim_job`.
    await persist_job(job)
    return job


#: Channel states that cannot legitimately move backwards. A row read is
#: allowed to advance a mirror, never to un-finish a Channel someone already
#: watched finish — see `_apply_row`.
_TERMINAL_CHANNEL_STATUSES = frozenset({"success", "failed", "skipped", "cancelled"})


def _apply_row(job: SyncJobState, row: SyncJobRow) -> None:
    """Re-sync a mirror from its row, in place and without regressing it.

    **In place** because `wait_job_update` holds a reference to this exact
    object's `_update_condition`: building a fresh `SyncJobState` on every
    refresh would leave every waiter blocked on a condition nothing will ever
    notify again, and the stream would simply stop with no error.

    **Without regressing** because the row lags the notifications by up to
    `SYNC_JOB_PERSIST_INTERVAL_MS`. A refresh that overwrote a Channel the
    mirror already saw succeed with the `running` the row still holds would make
    the progress bar walk backwards — visible, alarming, and entirely an
    artefact of two sources of truth disagreeing about *when*, not *what*.
    """
    job.status = row.status
    job.finished_at = row.finished_at
    job.created_at = row.created_at
    for channel_id, incoming in _channels_from_json(row.channels).items():
        existing = job.channels.get(channel_id)
        if existing is not None and existing.status in _TERMINAL_CHANNEL_STATUSES:
            continue
        job.channels[channel_id] = incoming
    job._mirror_synced_at_ms = time.monotonic() * 1000


def get_job(job_id: str) -> SyncJobState | None:
    """The job's live state, wherever it is running.

    Three cases, in order: this process runs it (`_active_jobs`, authoritative);
    this process is watching it and has heard from it recently (the mirror); or
    the row, which is also what seeds a new mirror.

    The mirror is what stops `GET /jobs/sync/{id}/events` from becoming a
    once-a-second query per open stream now that the sync runs elsewhere — and
    what stops it serving 5-second-old state between those queries.
    """
    if job_id in _active_jobs:
        return _active_jobs[job_id]

    mirror = _mirrored_jobs.get(job_id)
    if mirror is not None:
        quiet_ms = time.monotonic() * 1000 - max(
            mirror._mirror_synced_at_ms, mirror._mirror_notified_at_ms
        )
        if quiet_ms < settings.SYNC_JOB_PERSIST_INTERVAL_MS:
            return mirror

    with Session(engine) as session:
        row = session.get(SyncJobRow, job_id)
        if row is None:
            _mirrored_jobs.pop(job_id, None)
            return None
        if mirror is None:
            mirror = _row_to_state(row)
            mirror._mirror_synced_at_ms = time.monotonic() * 1000
            _remember(mirror)
        else:
            _apply_row(mirror, row)
        return mirror


async def apply_progress_event(event: dict[str, Any]) -> None:
    """Fold one cross-process progress notification into local state.

    Two very different jobs, and the distinction is which dict holds the job:

    * **A job this process runs** (`_active_jobs`) is authoritative about its own
      progress, so its state is never overwritten from a notification — it would
      be overwriting itself with an echo. The one thing it does take is a
      *cancellation*, because that decision is made in the API process and the
      `asyncio.Event` the sync polls lives here. Without this, `POST
      /jobs/sync/{id}/cancel` writes `cancelled` to a row the worker never reads
      and the sync runs happily to completion.
    * **A job this process watches** (`_mirrored_jobs`) takes the delta and wakes
      its stream.

    A notification for a job this process has never heard of is dropped: nobody
    is watching it here, and materialising a mirror for it would mean every
    process accumulating state for every sync in the deployment.
    """
    job_id = event.get("jobId")
    if not isinstance(job_id, str):
        return

    running_here = _active_jobs.get(job_id)
    if running_here is not None:
        if event.get("jobStatus") == "cancelled":
            running_here.cancel_event.set()
        return

    job = _mirrored_jobs.get(job_id)
    if job is None:
        return

    status = event.get("jobStatus")
    if isinstance(status, str):
        job.status = status
    if status == "cancelled":
        # Also on the mirror branch. The worker seeds a job into `_mirrored_jobs`
        # via `get_job` *before* `claim_job` promotes it, so a cancel landing in
        # that window would otherwise set the status and leave `cancel_event`
        # clear — and `_run_channel`'s check would wave the scrape through.
        job.cancel_event.set()
    if "finishedAt" in event:
        job.finished_at = event["finishedAt"]

    channel = event.get("channel")
    if isinstance(channel, dict):
        job.channels.update(_channels_from_json([channel]))
        job._mirror_notified_at_ms = time.monotonic() * 1000
    else:
        # A job-level transition carries no channel, so the mirror cannot know
        # which Channel moved. Expire it so the next `get_job` re-reads the row
        # rather than serving a snapshot that is now missing a change.
        #
        # **Both clocks, not just one.** `get_job` waits for `max(synced,
        # notified)` to go quiet, so refreshing `notified` here — as this did —
        # kept the stale mirror alive for the full interval and made the expiry
        # dead code. `_fail_exhausted` is the path that exposes it: it flips
        # several Channels to `failed` and persists with no `changed`, so the
        # stream would emit a terminal snapshot whose Channels still read
        # `running`, then `[DONE]`. The browser's final render would be wrong
        # permanently, and nothing would ever correct it.
        job._mirror_synced_at_ms = 0.0
        job._mirror_notified_at_ms = 0.0

    await _notify_job_update(job)


async def _consume_progress() -> None:
    queue = pg_notify.listener(SYNC_JOB_PROGRESS_CHANNEL).subscribe()
    while True:
        event = await queue.get()
        try:
            await apply_progress_event(event)
        except Exception:  # noqa: BLE001
            logger.exception("failed to apply a sync progress notification")


_progress_consumer = pg_notify.NotificationConsumer(lambda: _consume_progress())


def start_progress_subscriber() -> None:
    """Begin folding other processes' sync progress into local state.

    Started by both entrypoints, for opposite reasons: the API process needs it
    to serve SSE for a job the worker is running, and the worker needs it to
    hear a cancellation the API process issued.
    """
    _progress_consumer.start()


def stop_progress_subscriber() -> None:
    _progress_consumer.stop()


async def cancel_job(job_id: str) -> SyncJobState | None:
    job = get_job(job_id)
    if job is None:
        return None
    job.cancel_event.set()
    if job.status in ("pending", "running"):
        job.status = "cancelled"
        job.finished_at = int(time.time() * 1000)
        for ch in job.channels.values():
            if ch.status in ("pending", "running"):
                ch.status = "cancelled"
    await persist_job(job)
    return job


def deactivate_job(job_id: str) -> None:
    """Drop in-memory handles after a job finishes."""
    _active_jobs.pop(job_id, None)
    _mirrored_jobs.pop(job_id, None)
    _cancel_events.pop(job_id, None)


def has_active_sync_job() -> bool:
    """True when a sync job is pending or running — running *or still queued*.

    `run_auto_sync` and `run_auto_summary` skip their tick on this. It used to
    read `_active_jobs` alone, which was complete while `create_job` registered
    every job it made. It no longer does (see `claim_job`), so between enqueue
    and the first message being claimed this dict says nothing — and that gap is
    not always brief. `DRAIN_ORDER` puts the automatic lane last, so a long
    manual bulk keeps auto-sync's messages waiting; every 60-second tick would
    then see "no active job", create another one, and enqueue another N
    messages, without bound, for as long as the worker stayed busy.

    So a queued-but-unclaimed job counts as active. The row check runs only when
    the cheap in-memory answer is negative, and at most once a tick.
    """
    if any(j.status in ("pending", "running") for j in _active_jobs.values()):
        return True

    # Imported lazily: `sync_queue` imports this module.
    from app.jobs.sync_queue import queued_job_ids

    queued = queued_job_ids()
    if not queued:
        return False
    with Session(engine) as session:
        found = session.exec(
            select(SyncJobRow.id)
            .where(
                col(SyncJobRow.status).in_(("pending", "running")),
                col(SyncJobRow.id).in_(tuple(queued)),
            )
            .limit(1)
        ).first()
    return found is not None


def _running_job_from_row(*, user_id: uuid.UUID) -> SyncJobState | None:
    """The caller's oldest non-terminal job row, for a process that runs none.

    `GET /jobs/runtime-config` is served by the API, which after ticket 10 never
    calls `claim_job` — so a summary read only from `_active_jobs` is `None`
    there *always*, and the `activeSyncJob` diagnostics silently disappear at
    exactly the moments they describe something. The row is the cross-process
    answer, at the flush interval's freshness, which is the right granularity
    for a diagnostics panel.

    Scoped in ticket 35. `SyncJob` is `USER_OWNED`, and this read had no owner
    predicate at all — so the panel described whichever sync happened to be
    oldest anywhere in the deployment, including its channel names and counts.
    `user_id` is a required keyword: it took no arguments before, so an optional
    one would leave the only call site passing nothing and still passing.
    """
    with Session(engine) as session:
        row = session.exec(
            scoped_select(
                select(SyncJobRow).where(
                    col(SyncJobRow.status).in_(("pending", "running"))
                ),
                SyncJobRow,
                user_id,
            )
            .order_by(col(SyncJobRow.created_at))
            .limit(1)
        ).first()
        return _row_to_state(row) if row is not None else None


def _job_is_visible_to(job: SyncJobState, user_id: uuid.UUID) -> bool:
    """`scoped_select`'s `USER_OWNED` rule, applied to a dict instead of a table.

    `_active_jobs` is process memory, so the seam cannot reach it — this is the
    one place a `SyncJob` owner filter is spelled out by hand, and it is spelled
    to match what `scoped_select` does to the row two functions below: a no-op
    while the flag is off, `user_id == me` when it is on, and a row with no owner
    excluded under enforcement rather than matched as "mine".

    That last part is on ticket 21's bill and not a decision made here. The
    scheduler still creates `SyncJob` rows with no `user_id`, so under
    enforcement `activeSyncJob` would report nothing for an auto-sync — which is
    the same answer the scoped row read gives, deliberately, because two
    spellings of the rule that disagree about NULL is the drift the seam exists
    to prevent.
    """
    if not tenancy_enforced():
        return True
    return job.user_id is not None and uuid.UUID(job.user_id) == user_id


def get_active_sync_job_summary(
    *,
    allowed_concurrency: int,
    effective_proxy_capacity: int | None = None,
    user_id: uuid.UUID,
) -> dict[str, Any] | None:
    """Snapshot of the caller's in-flight sync job for runtime config.

    Both candidate sources are scoped, not just the row read. `_active_jobs` is
    *preferred* over the row, so scoping only `_running_job_from_row` — the
    function ticket 35 names — would leave the path that actually answers on the
    worker reading across accounts. Guarding the named function and leaving its
    caller unguarded is the shape ticket 33 had to fix in `publish_summary_text`
    and the two auth gates kept re-finding before that.

    The in-memory half is filtered by `_job_is_visible_to`, which restates
    `scoped_select`'s `USER_OWNED` rule rather than borrowing `may_act_on`.
    `may_act_on` does not consult the flag on its non-NULL branch, so using it
    here would narrow a *response* while enforcement is off — the one thing no
    seam adoption may do, and `test_auto_publish_scoping.py`'s caller list says
    so out loud.
    """
    candidates: list[SyncJobState] = [
        job
        for job in _active_jobs.values()
        if job.status in ("pending", "running") and _job_is_visible_to(job, user_id)
    ]
    if not candidates:
        from_row = _running_job_from_row(user_id=user_id)
        candidates = [from_row] if from_row is not None else []

    for job in candidates:
        if job.status not in ("pending", "running"):
            continue
        running_channels = sum(
            1 for ch in job.channels.values() if ch.status == "running"
        )
        pending_channels = sum(
            1 for ch in job.channels.values() if ch.status == "pending"
        )
        return {
            "jobId": job.job_id,
            "status": job.status,
            "source": job.source,
            "channelCount": len(job.channels),
            "runningChannels": running_channels,
            "pendingChannels": pending_channels,
            "allowedConcurrency": allowed_concurrency,
            "concurrencyInUse": min(running_channels, allowed_concurrency),
            "effectiveProxyCapacity": effective_proxy_capacity,
        }
    return None


def reconcile_interrupted_jobs(
    session: Session, *, still_queued: set[str] | None = None
) -> int:
    """Fail every job left mid-flight by a restart, and say so in the row.

    **`still_queued` is what keeps this sound after ticket 10.** The premise
    below — every non-terminal row belongs to a dead process — held while one
    process created and ran every job. The API now creates them on its own
    lifecycle, so a job enqueued seconds before the worker restarts has a real
    row, real messages on a lane, and nothing wrong with it. Failing it also
    makes `_process_message` archive each of its messages as "already
    terminal": a 2,000-Channel `sync_all` interrupted at Channel 50 would lose
    the other 1,950, with the browser told it failed. Pass the ids from
    `sync_queue.queued_job_ids()` so those are left alone; they are waiting,
    which is what a queue is for.

    Job progress lives in `_active_jobs`, which does not survive the process.
    Nothing ever reconciled the rows, so each restart stranded another handful:
    **711 rows in `running` and 48 in `pending`** on staging, the oldest from
    June. They are indistinguishable from live work to anything reading the
    table, and retention cannot expire them either, because deleting by age
    alone would eventually delete a genuinely long-running sync.

    Startup is the right moment precisely because in-memory state is empty:
    every non-terminal row is provably dead, with no need to guess an age
    threshold.

    **Only sound while the sync tier is a single replica.** With more than one
    process running syncs, a starting process would fail jobs another one is
    actively working. `backend/Dockerfile` pins `--workers 1` for this and two
    other reasons (`tests/deployment/test_worker_count.py`); the general answer
    is a claim that expires, which is step 2 of
    `docs/scaling-to-multiple-workers.md`.

    Marked `failed` rather than a new `interrupted` status, and with no reason
    string: `tg_sync_jobs` has no `error` column, and neither a migration to add
    one nor a fourth status value earns its cost here. A status the frontend
    does not know would have to be threaded through `_TERMINAL_SYNC_STATUSES`
    and the generated client, for a row nothing lists.
    """
    now_ms = int(time.time() * 1000)
    result = session.execute(
        sa_update(SyncJobRow)
        .where(
            col(SyncJobRow.status).in_(("pending", "running")),
            # A job with messages still on a lane is **waiting, not dead** —
            # see `still_queued` in the docstring. Without this, restarting the
            # worker fails every sync the API queued while it was down, and then
            # archives their messages as "already terminal" when they arrive.
            col(SyncJobRow.id).notin_(tuple(still_queued))
            if still_queued
            else sa_true(),
        )
        .values(status="failed", finished_at=now_ms, updated_at=utc_now())
    )
    session.commit()
    count = cast(Any, result).rowcount or 0
    if count:
        logger.warning("Marked %s sync job(s) failed: interrupted by a restart", count)
    return count


def prune_finished_jobs(
    session: Session, *, max_age_days: int, batch_size: int = SYNC_JOB_DELETE_BATCH
) -> int:
    """Delete finished job rows past the retention window. 0 disables.

    `tg_sync_jobs` reached **196,047 rows / 153 MB** with no policy at all. It is
    write-heavy and read-almost-never: there is no list endpoint, and the only
    reads are `GET /jobs/sync/{id}` and the SSE reconnect fallback, both for a
    job that is currently running. So the history is a write-only audit trail,
    and that is why the window is a deployment constant rather than an operator
    setting — nothing in the UI browses it.

    **Terminal rows only.** Deleting by age alone would eventually delete a sync
    that is still working, and the row is what a reconnecting client reads.
    Pairs with `reconcile_interrupted_jobs`: without it, a stranded `running`
    row would be immortal.

    No count cap, unlike Discover reports. Jobs are created at most once a
    minute, so an age window bounds the table on its own; reports needed a cap
    because a burst in one afternoon can outrun any age.

    **Deleted in bounded batches, each its own transaction.** Not for memory —
    only ids are selected, so the JSON is never loaded — but for transaction
    length. The first run against a table that never had a policy has ~180k rows
    to clear, and `channels` is TOASTed: `pg_total_relation_size` was **871 MB**
    against a 153 MB heap. One statement over that is a transaction held for as
    long as it takes, and a long transaction pins the xmin horizon so autovacuum
    reclaims nothing — the exact failure that left `tg_sync_meta` with 10 live
    rows and 4,743 dead (`tests/jobs/test_auto_sync_session_scope.py`). Short
    transactions let vacuum keep pace with the deletes instead of waiting behind
    them.
    """
    if max_age_days <= 0:
        return 0

    cutoff = int(time.time() * 1000) - max_age_days * 24 * 60 * 60 * 1000
    deleted = 0
    while True:
        stale = cast(
            list[str],
            session.exec(
                select(SyncJobRow.id)
                .where(
                    col(SyncJobRow.status).in_(tuple(_TERMINAL_JOB_STATUSES)),
                    col(SyncJobRow.created_at) < cutoff,
                )
                .limit(batch_size)
            ).all(),
        )
        if not stale:
            break
        result = session.execute(
            delete(SyncJobRow).where(col(SyncJobRow.id).in_(stale))
        )
        session.commit()
        deleted += cast(Any, result).rowcount or 0

    return deleted


def clear_active_jobs_for_tests() -> None:
    """Simulate backend restart — in-memory state only."""
    _active_jobs.clear()
    _cancel_events.clear()
    _mirrored_jobs.clear()


def clear_jobs_for_tests() -> None:
    """Test helper — reset registry and delete persisted rows."""
    _active_jobs.clear()
    _cancel_events.clear()
    _mirrored_jobs.clear()
    with Session(engine) as session:
        session.exec(delete(SyncJobRow))
        session.commit()
