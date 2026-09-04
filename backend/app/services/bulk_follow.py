"""Discover bulk-follow job: scrape+create channels, then chain one sync job."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlmodel import Session

from app.core import pg_notify
from app.core.config import settings
from app.core.db import engine
from app.core.request_meter import metered
from app.jobs.settings import (
    compute_effective_global_start_time_ms,
    load_retention_policy,
    load_sync_settings,
)
from app.models_tg import FollowJob
from app.services.async_db import run_db
from app.services.follow_jobs import (
    FOLLOW_JOB_EVENTS_CHANNEL,
    FOLLOW_JOB_TRIGGER_CHANNEL,
    create_row,
    is_cancelled,
    read_row,
    reconcile_interrupted,
    request_cancel,
    write_progress,
)
from app.services.followed_channels import (
    channel_exists,
    create_followed_channel,
    normalize_channel_name,
)
from app.services.network_settings import (
    load_network_settings,
    resolve_proxy_concurrency,
)
from app.services.proxy_pool import (
    SLOT_WAIT_SECONDS,
    SyncSlot,
    bound_to,
    get_partition,
)
from app.services.quota import (
    Budget,
    QuotaCeilingReached,
    assert_within_ceiling,
    charge_sync_job,
)
from app.services.scraper import get_channel_info
from app.services.telegram_web import (
    TelegramWebViewUnavailable,
    telegram_web_view_channel_url,
)

logger = logging.getLogger(__name__)

FOLLOW_JOB_SOURCE = "Discover bulk follow"
_TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})
_TERMINAL_CHANNEL_STATUSES = frozenset(
    {"added", "unavailable", "skipped", "error", "cancelled"}
)

FollowResultStatus = Literal[
    "pending", "running", "added", "unavailable", "skipped", "error", "cancelled"
]


@dataclass
class FollowChannelResult:
    name: str
    status: FollowResultStatus = "pending"
    reason: str | None = None
    error: str | None = None

    def to_camel(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "status": self.status}
        if self.reason is not None:
            out["reason"] = self.reason
        if self.error is not None:
            out["error"] = self.error
        return out


@dataclass
class FollowJobState:
    """The runner's working copy of a `tg_follow_jobs` row.

    Still a dataclass, and no longer the **only** copy: ticket 36 made the row
    the durable one (ADR-012 D7), because the runner moved to the worker and
    the API can no longer see this object at all. What lives here is the state
    a fan-out mutates per handle, flushed back on a throttle — rewriting the
    whole `results` array to record one handle is the write pattern
    `scraper_jobs._should_flush_db` exists to bound.
    """

    follow_job_id: str
    #: Who started this follow job. Declared here beside the other required
    #: field rather than left where it was, because a dataclass cannot put an
    #: undefaulted attribute after a defaulted one — and giving it a default is
    #: the thing being removed. Not optional: the sync this chains creates a
    #: `USER_OWNED` SyncJob, and the one route that builds a follow job already
    #: holds an authenticated `current_user.id`, so the `str(x) if x else None`
    #: it replaces was a `None` no caller could reach (ticket 21).
    user_id: str
    source: str = FOLLOW_JOB_SOURCE
    status: str = "pending"
    results: list[FollowChannelResult] = field(default_factory=list)
    sync_job_id: str | None = None
    created_at: int = field(default_factory=lambda: int(time.time() * 1000))
    finished_at: int | None = None
    #: Process-local, and **not** the answer on its own since ticket 36. The
    #: cancel arrives in the *API* process, which sets `cancel_requested` on
    #: the row; the worker reads that between handles and sets this. An
    #: `asyncio.Event` cannot cross a process boundary, and it was the whole
    #: cancellation mechanism until the runner moved.
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    proxies: list[str] = field(default_factory=list)
    tor_auto_rotate: bool = False
    tor_rotation_threshold: int = 10
    discovered_via_by_name: dict[str, dict[str, Any] | None] = field(
        default_factory=dict
    )
    _update_condition: asyncio.Condition = field(
        default_factory=asyncio.Condition, repr=False
    )
    _update_seq: int = field(default=0, repr=False)
    _last_flush_ms: float = field(default=0.0, repr=False)
    _cancel_checked_at: float = field(default=0.0, repr=False)

    def _counts(self) -> dict[str, int]:
        added = skipped = unavailable = failed = completed = 0
        for r in self.results:
            if r.status in _TERMINAL_CHANNEL_STATUSES:
                completed += 1
            if r.status == "added":
                added += 1
            elif r.status == "skipped":
                skipped += 1
            elif r.status == "unavailable":
                unavailable += 1
            elif r.status == "error":
                failed += 1
        return {
            "total": len(self.results),
            "completed": completed,
            "added": added,
            "skipped": skipped,
            "unavailable": unavailable,
            "failed": failed,
        }

    def to_camel(self) -> dict[str, Any]:
        counts = self._counts()
        return {
            "followJobId": self.follow_job_id,
            "status": self.status,
            "source": self.source,
            "total": counts["total"],
            "completed": counts["completed"],
            "added": counts["added"],
            "skipped": counts["skipped"],
            "unavailable": counts["unavailable"],
            "failed": counts["failed"],
            "results": [r.to_camel() for r in self.results],
            "syncJobId": self.sync_job_id,
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
        }


_active_jobs: dict[str, FollowJobState] = {}
_jobs_lock = asyncio.Lock()
_create_lock = asyncio.Lock()


async def _notify_job_update(job: FollowJobState) -> None:
    async with job._update_condition:
        job._update_seq += 1
        job._update_condition.notify_all()


def _flush(snapshot: dict[str, Any]) -> None:
    """Write one already-taken snapshot. **Takes no live job object.**

    It used to take the `FollowJobState` and build `results` inside the thread,
    which reads a list the fan-out is concurrently mutating — every other task
    in the batch is setting `result.status` on entries of it. Nothing would
    corrupt, but the row could record a handle as `running` that had finished
    before the write, and the next flush is the only thing that would correct
    it. Taking the snapshot on the event loop makes the row a consistent moment
    rather than a smear across one.
    """
    with Session(engine) as session:
        write_progress(session, **snapshot)


def _snapshot(job: FollowJobState) -> dict[str, Any]:
    return {
        "follow_job_id": job.follow_job_id,
        "status": job.status,
        "results": [r.to_camel() for r in job.results],
        "sync_job_id": job.sync_job_id,
        "finished_at": job.finished_at,
    }


def _should_flush(job: FollowJobState) -> bool:
    """Terminal states immediately, progress on the interval.

    `scraper_jobs._should_flush_db`'s rule, and its measurement: recording one
    handle rewrites the whole `results` array, so a 300-handle follow that
    flushed per handle would issue 300 full-array writes. A watcher does not wait
    for the flush — the notification below goes out either way — so the row's
    cadence is a crash-recovery cadence and nothing else.
    """
    if job.status in _TERMINAL_STATUSES:
        return True
    now_ms = time.time() * 1000
    if now_ms - job._last_flush_ms < settings.SYNC_JOB_PERSIST_INTERVAL_MS:
        return False
    job._last_flush_ms = now_ms
    return True


async def touch_follow_job(job: FollowJobState) -> None:
    """Record progress: memory, the row on a throttle, and a ring for the API.

    The ring carries no state (`{"followJobId": ...}`) and the API re-reads the
    row, which is `_publish_progress`'s shape inverted for a reason: a follow
    job's payload is the whole results array, and at 300 handles that is past
    `pg_notify`'s 8000-byte cap. The row is a few milliseconds behind at worst
    and is the copy that survives a restart.
    """
    async with _jobs_lock:
        if job.status in _TERMINAL_STATUSES:
            # **Dropped once terminal**, because the worker is long-lived now
            # and this dict used to be pruned only by `clear_follow_jobs_for_tests`.
            # One entry per bulk follow, held for the life of the process, is
            # the unbounded-cache shape `scraper_jobs._get_cancel_event` already
            # documents. Safe to drop: `get_follow_job` falls back to the row,
            # which is the durable copy and is written immediately for a
            # terminal state.
            _active_jobs.pop(job.follow_job_id, None)
        else:
            _active_jobs[job.follow_job_id] = job
    if _should_flush(job):
        await run_db(_flush, _snapshot(job))
    await _notify_job_update(job)
    try:
        await asyncio.to_thread(
            pg_notify.publish,
            FOLLOW_JOB_EVENTS_CHANNEL,
            {"followJobId": job.follow_job_id, "status": job.status},
        )
    except Exception:  # noqa: BLE001
        # Best-effort, like every other progress ring: a lost notification
        # costs the watcher a slower poll, never the work.
        logger.warning("failed to ring follow job %s", job.follow_job_id)


async def wait_follow_job_update(
    job: FollowJobState, *, seen_seq: int, timeout_s: float
) -> int:
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


def _state_from_row(row: FollowJob) -> FollowJobState:
    """Rebuild a working copy from the row, for a process that has none."""
    options = row.options or {}
    state = FollowJobState(
        follow_job_id=row.id,
        user_id=str(row.user_id),
        source=row.source,
        status=row.status,
        results=[
            FollowChannelResult(
                name=str(entry.get("name", "")),
                status=entry.get("status", "pending"),
                reason=entry.get("reason"),
                error=entry.get("error"),
            )
            for entry in (row.results or [])
        ],
        sync_job_id=row.sync_job_id,
        created_at=row.created_at,
        finished_at=row.finished_at,
        proxies=list(options.get("proxies") or []),
        tor_auto_rotate=bool(options.get("torAutoRotate")),
        tor_rotation_threshold=int(options.get("torRotationThreshold") or 10),
        discovered_via_by_name=dict(options.get("discoveredViaByName") or {}),
    )
    if row.cancel_requested:
        state.cancel_event.set()
    return state


def _read_state(follow_job_id: str) -> FollowJobState | None:
    """Read the row and project it to a plain state object **inside** the session.

    Not `session.expunge(row)` and a detached ORM object, which is what this
    was first: `commit()` expires every attribute, so the first read outside
    the block raises `DetachedInstanceError`. Projecting to plain values before
    the session closes is the rule this repo already states for the cost
    reason — a session held open across awaited work pins the xmin horizon —
    and it is the same rule.
    """
    with Session(engine) as session:
        row = read_row(session, follow_job_id)
        return None if row is None else _state_from_row(row)


def get_follow_job(follow_job_id: str) -> FollowJobState | None:
    """The job, from this process's memory or from the row.

    **The row is the fallback that makes the API work at all** since ticket 36.
    The runner lives in the worker, so `_active_jobs` is empty in every API
    replica and the three bulk-follow routes would answer 404 for every job
    that exists. The worker keeps its own entry because that is the copy being
    mutated; every other process rebuilds one per read.
    """
    live = _active_jobs.get(follow_job_id)
    if live is not None:
        return live
    return _read_state(follow_job_id)


async def create_follow_job(
    *,
    channels: list[dict[str, Any]],
    user_id: str,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int = 10,
) -> FollowJobState:
    """Normalize + dedupe input and create an in-memory follow job."""
    seen: set[str] = set()
    results: list[FollowChannelResult] = []
    via_by_name: dict[str, dict[str, Any] | None] = {}

    for entry in channels:
        raw_name = entry.get("name") or ""
        clean = normalize_channel_name(str(raw_name))
        if not clean or clean.lower() in seen:
            continue
        seen.add(clean.lower())
        via = entry.get("discovered_via") or entry.get("discoveredVia")
        via_by_name[clean] = via if isinstance(via, dict) else None
        results.append(FollowChannelResult(name=clean))

    job = FollowJobState(
        follow_job_id=str(uuid.uuid4()),
        results=results,
        user_id=user_id,
        proxies=list(proxies or []),
        tor_auto_rotate=tor_auto_rotate,
        tor_rotation_threshold=tor_rotation_threshold,
        discovered_via_by_name=via_by_name,
    )
    # The row first, then anything that could make somebody look for it. This
    # runs in the API process, which will not run the job — the worker reads
    # the row off the trigger below, so a row that does not exist yet is a
    # trigger for a job nobody can find.
    await run_db(_create_row_for, job)
    # **Deliberately not put in `_active_jobs`.** This runs in the API process
    # and the runner is in the worker, so the entry here would never be updated
    # by anything — and `get_follow_job` prefers memory over the row, so every
    # `GET` and every SSE wakeup in this replica would answer `pending` with
    # every handle `pending`, for ever, and the stream would never emit
    # `[DONE]`. Only the process that *mutates* a job may cache it.
    #
    # Caught in review. The tests missed it because each one calls
    # `clear_follow_jobs_for_tests()` to fake the process boundary, which
    # emptied the very dict that was wrong.
    await _notify_job_update(job)
    return job


def _create_row_for(job: FollowJobState) -> None:
    with Session(engine) as session:
        create_row(
            session,
            follow_job_id=job.follow_job_id,
            user_id=uuid.UUID(job.user_id),
            source=job.source,
            results=[r.to_camel() for r in job.results],
            options={
                "proxies": job.proxies,
                "torAutoRotate": job.tor_auto_rotate,
                "torRotationThreshold": job.tor_rotation_threshold,
                "discoveredViaByName": job.discovered_via_by_name,
            },
            created_at=job.created_at,
        )


async def request_follow_job_run(follow_job_id: str) -> None:
    """Ask the worker to run this follow job.

    `scheduler.request_job_run`'s shape, minus the wait: the API has already
    answered with a job id and the browser watches the SSE stream, so there is
    nothing here to wait for. Best-effort like every other ring — a lost one
    leaves the row `pending`, which `reconcile_interrupted` fails at the next
    worker boot rather than leaving as a spinner nobody resolves.
    """
    try:
        await asyncio.to_thread(
            pg_notify.publish,
            FOLLOW_JOB_TRIGGER_CHANNEL,
            {"followJobId": follow_job_id},
        )
    except Exception:  # noqa: BLE001
        logger.warning("failed to ask the worker to run follow job %s", follow_job_id)


async def cancel_follow_job(follow_job_id: str) -> FollowJobState | None:
    """Cancel, from whichever process the request landed in.

    **The row is what carries this across the boundary** (ticket 36). The
    cancel arrives in the API and the runner is in the worker, so setting an
    `asyncio.Event` here reaches nobody — `request_cancel` writes the flag and
    the terminal state, and the ring makes the running worker notice within a
    handle instead of at the next one it happens to check.

    The local `cancel_event` is still set, because in the worker's own process
    this *is* the running job's state object and the fan-out reads it directly.
    """
    cancelled = await run_db(_request_cancel_state, follow_job_id)
    if cancelled is None:
        return None

    live = _active_jobs.get(follow_job_id)
    if live is not None:
        live.cancel_event.set()
        live.status = cancelled.status
        live.finished_at = cancelled.finished_at
        for r in live.results:
            if r.status in ("pending", "running"):
                r.status = "cancelled"
        await _notify_job_update(live)

    try:
        await asyncio.to_thread(
            pg_notify.publish,
            FOLLOW_JOB_EVENTS_CHANNEL,
            {"followJobId": follow_job_id, "status": cancelled.status},
        )
    except Exception:  # noqa: BLE001
        logger.warning("failed to ring the cancel of follow job %s", follow_job_id)
    return cancelled


def _request_cancel_state(follow_job_id: str) -> FollowJobState | None:
    with Session(engine) as session:
        row = request_cancel(session, follow_job_id)
        return None if row is None else _state_from_row(row)


def clear_follow_jobs_for_tests() -> None:
    _active_jobs.clear()


def _load_effective_start_time(user_id: uuid.UUID | None) -> int:
    # The parameter was unused until ticket 06 — the start-time mode it feeds
    # lived in a single global blob, so whose follow this was made no
    # difference. Now it does: `globalStartTimeMode`/`Value` are per-User.
    with Session(engine) as session:
        sync_settings = load_sync_settings(session, user_id=user_id)
        retention_settings = load_retention_policy(session)
        return compute_effective_global_start_time_ms(sync_settings, retention_settings)


def _load_proxy_concurrency(
    user_id: uuid.UUID | None,
) -> tuple[int, dict[str, int]] | None:
    if user_id is None:
        return None
    with Session(engine) as session:
        network = load_network_settings(session)
        return resolve_proxy_concurrency(network)


#: How stale the worker's view of `cancel_requested` may be, in seconds.
#:
#: Small, because a person pressed Cancel and is watching; not zero, because
#: the alternative is a `Session` per checkpoint per handle. See `_cancelled`.
_CANCEL_POLL_SECONDS = 1.0


async def _cancelled(job: FollowJobState) -> bool:
    """Whether this job has been cancelled, **including from another process**.

    The local event is checked first because it is free and, once set, stays
    set. The row is what a cancel arriving in an API replica writes, and this
    is the only place the worker can see it — an `asyncio.Event` does not cross
    a process boundary, which is the whole reason `cancel_requested` is a
    column.

    **Polled on a clock, not per call** (found in review). There are three
    checkpoints inside `_process_one_channel` and a follow runs to hundreds of
    handles, so a fresh `Session` at each was up to nine hundred round trips
    across the whole partition — to read a flag that changes at most once. The
    poll bounds how *stale* the answer can be, which is the only thing that
    matters: a cancel takes effect at the next checkpoint either way.
    """
    if job.cancel_event.is_set():
        return True
    now = time.time()
    if now - job._cancel_checked_at < _CANCEL_POLL_SECONDS:
        return False
    job._cancel_checked_at = now
    if await run_db(_cancel_requested, job.follow_job_id):
        job.cancel_event.set()
        return True
    return False


def _cancel_requested(follow_job_id: str) -> bool:
    with Session(engine) as session:
        return is_cancelled(session, follow_job_id)


async def _process_one_channel(
    job: FollowJobState,
    result: FollowChannelResult,
    *,
    user_uuid: uuid.UUID,
    effective_start_time: int,
    proxy_concurrency: tuple[int, dict[str, int]] | None,
) -> None:
    if await _cancelled(job):
        result.status = "cancelled"
        await touch_follow_job(job)
        return

    exists = await run_db(channel_exists, result.name)
    if exists:
        result.status = "skipped"
        result.reason = "already_followed"
        await touch_follow_job(job)
        return

    result.status = "running"
    await touch_follow_job(job)

    if await _cancelled(job):
        result.status = "cancelled"
        await touch_follow_job(job)
        return

    display_name = result.name
    photo_url: str | None = None
    is_unavailable = False
    telemetry = None
    try:
        info = await get_channel_info(
            result.name,
            proxies=job.proxies or None,
            tor_auto_rotate=job.tor_auto_rotate,
            tor_rotation_threshold=job.tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )
        display_name = info.get("displayName") or result.name
        photo_url = info.get("photoUrl")
        is_unavailable = bool(info.get("isUnavailableOnWebView"))
        telemetry = info.get("telemetry")
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if isinstance(exc, TelegramWebViewUnavailable):
            is_unavailable = True
        else:
            result.status = "error"
            result.error = msg
            await touch_follow_job(job)
            return

    if await _cancelled(job):
        result.status = "cancelled"
        await touch_follow_job(job)
        return

    discovered_via = job.discovered_via_by_name.get(result.name)
    # Serialize creates: concurrent touch_sync / group ensure races under load.
    async with _create_lock:
        created = await run_db(
            create_followed_channel,
            result.name,
            display_name=display_name,
            photo_url=photo_url,
            is_unavailable=is_unavailable,
            discovered_via=discovered_via,
            user_id=user_uuid,
            effective_start_time=effective_start_time,
            telemetry_url=telegram_web_view_channel_url(result.name),
            telemetry=telemetry,
        )
    if not created:
        result.status = "skipped"
        result.reason = "already_followed"
    elif is_unavailable:
        result.status = "unavailable"
    else:
        result.status = "added"
    await touch_follow_job(job)


async def _chain_sync_job(
    job: FollowJobState, syncable_names: list[str], user_uuid: uuid.UUID | None
) -> None:
    if not syncable_names:
        return
    from app.jobs.sync_queue import enqueue_sync_job
    from app.services.scraper_jobs import create_job

    entries = [(name, name) for name in syncable_names]
    sync_job = await create_job(
        channel_entries=entries,
        source=FOLLOW_JOB_SOURCE,
        user_id=job.user_id,
        sync_mode="bulk",
    )
    job.sync_job_id = sync_job.job_id
    # Ticket 10: the chained *sync* is enqueued onto `manual_bulk_normal`, one
    # message per Channel, rather than run here. The probe phase above it runs
    # in this same worker process since ticket 36 — off a `pg_notify` trigger
    # and on Slots out of the Partition — so neither half is in the API any
    # more, and neither is lost to an API restart.
    await enqueue_sync_job(sync_job, user_uuid)


async def _consume_follow_triggers() -> None:
    queue = pg_notify.listener(FOLLOW_JOB_TRIGGER_CHANNEL).subscribe()
    while True:
        payload = await queue.get()
        follow_job_id = payload.get("followJobId")
        if not isinstance(follow_job_id, str) or not follow_job_id:
            continue
        # A task per job rather than sequentially, because a follow job runs
        # for as long as its handles take and the next one must not wait behind
        # it. They contend on the Partition, which is the one budget that
        # should decide how much of this deployment is scraping at once.
        task = asyncio.create_task(_guarded_follow_run(follow_job_id))
        _running_follow_tasks.add(task)
        task.add_done_callback(_running_follow_tasks.discard)


async def _guarded_follow_run(follow_job_id: str) -> None:
    try:
        await run_follow_job_by_id(follow_job_id)
    except Exception:  # noqa: BLE001
        logger.exception("follow job %s crashed", follow_job_id)


#: Strong references to the running follow tasks. Without them the event loop
#: is the only holder and a task can be garbage collected mid-run — the
#: `asyncio.create_task` footgun, and one that shows up as a follow that just
#: stops.
_running_follow_tasks: set[asyncio.Task[None]] = set()

_follow_trigger_consumer = pg_notify.NotificationConsumer(_consume_follow_triggers)


def start_follow_job_consumer() -> None:
    """Worker side: run a follow job when the API asks for one."""
    _follow_trigger_consumer.start()


def stop_follow_job_consumer() -> None:
    _follow_trigger_consumer.stop()


def reconcile_interrupted_follow_jobs() -> int:
    """Fail every non-terminal follow row at boot. Returns how many.

    `reconcile_interrupted_jobs`' reasoning, without its one exception. A sync
    job's messages are durably queued, so a non-terminal sync row may be
    *waiting*; a follow job has no queue — the worker runs it straight off the
    trigger — so a non-terminal row at boot belongs to a process that is gone,
    and leaving it `running` is a spinner nobody resolves.
    """
    with Session(engine) as session:
        return reconcile_interrupted(session)


async def run_follow_job_by_id(follow_job_id: str) -> None:
    """Load the row and run it. The worker's entry point (ticket 36).

    Refuses a job that is already terminal, which is what makes the trigger
    safe to redeliver: a ring the worker missed is followed by
    `reconcile_interrupted` at its next boot, and a ring it receives twice must
    not run the batch twice.
    """
    job = await run_db(_read_state, follow_job_id)
    if job is None:
        logger.warning("follow job %s was triggered but has no row", follow_job_id)
        return
    if job.status in _TERMINAL_STATUSES:
        return
    async with _jobs_lock:
        _active_jobs[job.follow_job_id] = job
    await run_follow_job(job)


async def run_follow_job(job: FollowJobState) -> None:
    """Probe every handle in the batch, then chain a sync for the ones added.

    Metered and charged to `manual_bulk` (ticket 08). The probe phase is one
    `t.me` fetch per handle and a batch runs to hundreds, so leaving it out
    would hide the largest single manual source of Requests from the very view
    that reports what each account consumed.

    The sync this chains is charged **separately and not twice**, but no longer
    for the reason this used to give. It said the sync runs under `run_sync_job`,
    which opens its own nested meter — since ticket 10 the sync is not run here
    at all: it is enqueued, and the worker meters each message on its own. The
    conclusion survives, the mechanism changed, and a docstring describing a
    mechanism that no longer exists is how a true statement becomes a false
    invariant.

    **The `manual_bulk` ceiling is checked once, before the first probe**
    (ticket 24). The probe phase is on no lane, so ticket 23's ladder cannot
    reach it and an account over its bulk allowance still probes at full speed;
    a ceiling can refuse it, because a refusal needs no lane. Once at the top
    rather than per handle because the whole batch is one metered block charged
    to one Budget, and a batch of hundreds of probes is exactly the runaway the
    ceiling exists for — the chained sync it would have queued is refused
    separately, by `enqueue_sync_job`.
    """
    with metered() as meter:
        job.status = "running"
        await touch_follow_job(job)

        # `uuid.UUID(job.user_id) if job.user_id else None` until ticket 21.
        # `FollowJobState.user_id` is now a required `str`, so the else branch
        # was dead by construction and alive in the type — which is what let a
        # `None` reach `create_followed_channel` through `run_db`, whose
        # `Callable[..., T]` signature checks nothing. Same shape as the
        # auto-follow hole `/code-review` found in `sync_orchestrator.py`.
        user_uuid = uuid.UUID(job.user_id)
        try:
            await run_db(assert_within_ceiling, user_uuid, Budget.MANUAL_BULK)
        except QuotaCeilingReached:
            for result in job.results:
                result.status = "error"
                result.error = "Daily manual_bulk request ceiling reached"
            job.status = "failed"
            job.finished_at = int(time.time() * 1000)
            await touch_follow_job(job)
            return
        effective_start_time = await run_db(_load_effective_start_time, user_uuid)
        proxy_concurrency = await run_db(_load_proxy_concurrency, user_uuid)
        # **Slots out of the one Partition, not a semaphore of this job's own**
        # (ADR-012). `FOLLOW_SCRAPE_CONCURRENCY` was four concurrent probes
        # that nothing counted and nothing bound to a proxy — the same defect
        # as `run_sync_job`'s semaphore and the Discover sweep's, reached from
        # a third direction. It could not have been fixed where this used to
        # run: the API process builds no Partition, deliberately, because
        # per-proxy limits are per-process and a second one would double the
        # rate every proxy sees.
        partition = await get_partition()

        async def _run_one(result: FollowChannelResult) -> None:
            slot = SyncSlot(partition)
            if not await slot.acquire_within(SLOT_WAIT_SECONDS):
                # See `SLOT_WAIT_SECONDS`: with every proxy parked an unbounded
                # wait leaves all three hundred tasks here for ever, the row
                # `running`, and the `finally` that charges the ledger never
                # reached.
                result.status = "error"
                result.error = "No healthy proxy was available"
                await touch_follow_job(job)
                return
            try:
                with bound_to(slot):
                    await _process_one_channel(
                        job,
                        result,
                        user_uuid=user_uuid,
                        effective_start_time=effective_start_time,
                        proxy_concurrency=proxy_concurrency,
                    )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Bulk follow failed for @%s", result.name)
                if result.status not in _TERMINAL_CHANNEL_STATUSES:
                    result.status = "error"
                    result.error = str(exc)
                    await touch_follow_job(job)
            finally:
                slot.release()

        try:
            await asyncio.gather(*[_run_one(r) for r in job.results])

            if job.cancel_event.is_set():
                job.status = "cancelled"
                for r in job.results:
                    if r.status in ("pending", "running"):
                        r.status = "cancelled"
            else:
                syncable_names = [r.name for r in job.results if r.status == "added"]
                try:
                    await _chain_sync_job(job, syncable_names, user_uuid)
                except QuotaCeilingReached:
                    # Expected, not a fault: the probes ran and the follows
                    # landed, and the account hit its `manual_bulk` ceiling
                    # before the sync could be queued. A traceback at error
                    # level here would report a refusal as a crash — the same
                    # distinction `bulk_channels` and `auto_sync` make.
                    logger.info(
                        "Follow job %s: at the manual_bulk ceiling, sync not queued",
                        job.follow_job_id,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "Failed to chain sync job after follow job %s",
                        job.follow_job_id,
                    )
                if any(r.status == "error" for r in job.results) and not any(
                    r.status in ("added", "unavailable", "skipped") for r in job.results
                ):
                    job.status = "failed"
                else:
                    job.status = "completed"

            job.finished_at = int(time.time() * 1000)
            await touch_follow_job(job)
        finally:
            # `finally` for the reason `run_sync_job` gives: the probes were
            # made whether or not the batch finished tidily.
            await run_db(charge_sync_job, user_uuid, "bulk", meter.telegram_requests)
