"""APScheduler background jobs for always-on self-hosted deployment.

Single-instance assumption (ADR-004): one backend container runs one in-process
AsyncIOScheduler. Do not run multiple replicas without external job coordination.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlmodel import Session

from app.core import pg_notify
from app.core.config import settings
from app.core.db import engine
from app.jobs.auto_summary import run_auto_summary
from app.jobs.auto_sync import run_auto_sync
from app.jobs.discover_probe import (
    DISCOVER_PROBE_JOB_ID,
    run_discover_probe_sweep,
)
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import (
    JOB_IDS,
    default_job_enabled,
    is_job_enabled,
    load_jobs_settings,
    set_job_enabled,
)
from app.jobs.sync_queue import job_sync_queue
from app.jobs.translation_batch import run_translation_batch
from app.services.embeddings import backfill_embeddings
from app.services.operator import get_operator_user_id

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

_job_status: dict[str, dict[str, Any]] = {
    job_id: {
        "enabled": default_job_enabled(job_id),
        "lastRun": None,
        "lastStatus": "idle",
        "lastError": None,
        "nextRun": None,
    }
    for job_id in JOB_IDS
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _next_run_ms(job_id: str) -> int | None:
    job = scheduler.get_job(job_id)
    if not job or not job.next_run_time:
        return None
    return int(job.next_run_time.timestamp() * 1000)


def _mark_running(job_id: str) -> None:
    _job_status[job_id]["lastRun"] = _now_ms()
    _job_status[job_id]["lastStatus"] = "running"
    _job_status[job_id]["lastError"] = None


def _mark_ok(job_id: str, detail: Any = None) -> None:
    _job_status[job_id]["lastStatus"] = "ok"
    _job_status[job_id]["lastError"] = None
    _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
    if detail is not None:
        _job_status[job_id]["detail"] = detail


def _mark_error(job_id: str, exc: Exception) -> None:
    _job_status[job_id]["lastStatus"] = "error"
    _job_status[job_id]["lastError"] = str(exc)
    _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
    logger.exception("Job %s failed", job_id)


#: Scheduler state crossing the process split (ticket 10).
#:
#: `_job_status` is filled in by whichever process runs the jobs — after ticket
#: 10, only the worker. `GET /jobs/status` is served by the API, which would
#: otherwise report `lastRun: null, lastStatus: "idle", nextRun: null` for every
#: job forever: not an error, just a Jobs panel that has quietly stopped saying
#: anything. The worker announces each transition here and the API folds it in.
SCHEDULER_STATUS_CHANNEL = "scheduler_job_status"
#: The reverse direction: the API asks the worker to run a job now, because
#: running it locally would put retention, the probe sweep and auto-sync back in
#: the tier this ticket removed them from.
SCHEDULER_TRIGGER_CHANNEL = "scheduler_job_trigger"

#: Identifies announcements this process made, so it can ignore its own.
#:
#: `NOTIFY` is broadcast: a process that both runs jobs and subscribes hears
#: itself. The round trip is slower than the code that produced it, so a stale
#: "running" echo can land *after* the job finished and overwrite the "ok" with
#: it — the status flapping backwards for reasons nothing in the logs explains.
#: The same shape as the `_active_jobs` echo rule for sync progress: whoever
#: runs the work is authoritative about it, and an echo is not news.
_PROCESS_ID = uuid.uuid4().hex


#: Counts announcements per job, so a waiter can tell "the worker answered" from
#: "nothing has happened yet". Kept out of `_job_status` because that dict is
#: serialised into `JobStatusEntry` and is part of the API's response shape.
_announce_seq: dict[str, int] = {}

#: Longest `detail` an announcement carries, comfortably under `pg_notify`'s
#: 8000-byte payload cap with room for the rest of the entry.
_MAX_DETAIL_CHARS = 2000


def _announce(job_id: str) -> None:
    """Publish this job's status entry. Blocking; call through `to_thread`.

    Best-effort, and it swallows its own failures on purpose: this describes a
    job, and the description failing must never be able to fail the job. The
    Jobs panel going momentarily stale is a smaller problem than retention not
    running.
    """
    _announce_seq[job_id] = _announce_seq.get(job_id, 0) + 1
    entry = dict(_job_status[job_id])
    detail = entry.get("detail")
    if detail is not None and len(str(detail)) > _MAX_DETAIL_CHARS:
        # `pg_notify.publish` drops anything over its 8000-byte cap with only a
        # log line, so one fat `detail` would stop the Jobs panel updating for
        # that job — and `request_job_run` would then wait out its full timeout.
        # `detail` is whatever the job returned: `run_auto_summary` puts provider
        # error bodies in it, which are unbounded. Summarised rather than
        # dropped, because "there was a result and it was large" still says
        # something.
        entry["detail"] = {
            "truncated": True,
            "preview": str(detail)[:_MAX_DETAIL_CHARS],
        }
    try:
        pg_notify.publish(
            SCHEDULER_STATUS_CHANNEL,
            {
                "pid": _PROCESS_ID,
                "jobId": job_id,
                "seq": _announce_seq[job_id],
                "entry": entry,
            },
        )
    except Exception:  # noqa: BLE001
        logger.warning("failed to announce status for job %s", job_id)


async def _run_guarded(job_id: str, fn: Callable[[], Awaitable[Any]]) -> None:
    with Session(engine) as session:
        if not is_job_enabled(session, job_id):
            _job_status[job_id]["enabled"] = False
            _job_status[job_id]["lastStatus"] = "disabled"
            _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
            await asyncio.to_thread(_announce, job_id)
            return
        _job_status[job_id]["enabled"] = True

    _mark_running(job_id)
    await asyncio.to_thread(_announce, job_id)
    try:
        result = await fn()
        _mark_ok(job_id, result)
    except Exception as exc:  # noqa: BLE001
        _mark_error(job_id, exc)
    await asyncio.to_thread(_announce, job_id)


async def job_auto_sync() -> None:
    await _run_guarded("auto_sync", run_auto_sync)


async def job_embeddings() -> None:
    async def _run() -> dict[str, Any]:
        with Session(engine) as session:
            # `backfill_embeddings` stamps its `EmbeddingLog` rows with this id,
            # so an unattended run needs a real account to attribute them to.
            # Skipping is the honest answer when there is none: the alternative
            # is what this used to do, which was write the log with no owner —
            # a row that under enforcement is invisible to everybody and swept
            # by no retention window. A deployment with no account has nothing
            # to embed for anyway, since the channel set is resolved per owner.
            #
            # Which account an unattended job acts as is deliberately still the
            # operator here; ticket 21's PR 2 is where that resolution changes.
            actor_id = get_operator_user_id(session)
            if actor_id is None:
                return {"skipped": True, "reason": "no_account_to_attribute_to"}
            return await backfill_embeddings(session, limit=100, user_id=actor_id)

    await _run_guarded("embeddings", _run)


async def job_auto_summary() -> None:
    await _run_guarded("auto_summary", run_auto_summary)


async def job_retention() -> None:
    async def _run() -> dict[str, Any]:
        with Session(engine) as session:
            return run_retention_cleanup(session)

    await _run_guarded("retention", _run)


async def job_translation_batch() -> None:
    await _run_guarded("translation_batch", run_translation_batch)


async def job_discover_probe() -> None:
    await _run_guarded(DISCOVER_PROBE_JOB_ID, run_discover_probe_sweep)


_JOB_RUNNERS: dict[str, Callable[[], Awaitable[None]]] = {
    "auto_sync": job_auto_sync,
    "embeddings": job_embeddings,
    "auto_summary": job_auto_summary,
    "retention": job_retention,
    "translation_batch": job_translation_batch,
    DISCOVER_PROBE_JOB_ID: job_discover_probe,
}


def _refresh_enabled_flags() -> None:
    with Session(engine) as session:
        jobs_cfg = load_jobs_settings(session)
        for job_id in JOB_IDS:
            entry = jobs_cfg.get(job_id, {})
            enabled = (
                bool(entry.get("enabled", default_job_enabled(job_id)))
                if isinstance(entry, dict)
                else default_job_enabled(job_id)
            )
            _job_status[job_id]["enabled"] = enabled
            if scheduler.running:
                # Only meaningful where APScheduler is actually running. In the
                # API process `scheduler.get_job` returns `None` for everything,
                # so recomputing here would overwrite the `nextRun` the worker
                # just announced with a null — the enabled flags come from the
                # database and are the same everywhere, the schedule does not.
                _job_status[job_id]["nextRun"] = _next_run_ms(job_id)


def apply_job_status_event(event: dict[str, Any]) -> None:
    """Fold one scheduler-status notification from the worker into this process."""
    if event.get("pid") == _PROCESS_ID:
        # Our own announcement, arriving after the code that made it. See
        # `_PROCESS_ID`.
        return
    job_id = event.get("jobId")
    entry = event.get("entry")
    if not isinstance(job_id, str) or job_id not in _job_status:
        return
    if isinstance(entry, dict):
        _job_status[job_id].update(entry)
    seq = event.get("seq")
    if isinstance(seq, int):
        _announce_seq[job_id] = seq


async def _consume_job_status() -> None:
    queue = pg_notify.listener(SCHEDULER_STATUS_CHANNEL).subscribe()
    while True:
        event = await queue.get()
        try:
            apply_job_status_event(event)
        except Exception:  # noqa: BLE001
            logger.exception("failed to apply a scheduler status notification")


async def _consume_job_triggers() -> None:
    queue = pg_notify.listener(SCHEDULER_TRIGGER_CHANNEL).subscribe()
    while True:
        event = await queue.get()
        job_id = event.get("jobId")
        runner = _JOB_RUNNERS.get(job_id) if isinstance(job_id, str) else None
        if runner is None:
            continue
        try:
            await runner()
        except Exception:  # noqa: BLE001
            logger.exception("requested run of %s failed", job_id)


_status_consumer = pg_notify.NotificationConsumer(lambda: _consume_job_status())
_trigger_consumer = pg_notify.NotificationConsumer(lambda: _consume_job_triggers())


def start_job_status_subscriber() -> None:
    """API side: keep `_job_status` current from the worker's announcements."""
    _status_consumer.start()


def stop_job_status_subscriber() -> None:
    _status_consumer.stop()


def start_job_trigger_consumer() -> None:
    """Worker side: run a job when the API asks for one."""
    _trigger_consumer.start()


def stop_job_trigger_consumer() -> None:
    _trigger_consumer.stop()


async def request_job_run(job_id: str, timeout_s: float = 30.0) -> dict[str, Any]:
    """Ask the worker to run a job, and wait for it to say it finished.

    `trigger_job` below still runs the job in-process, which is what the worker
    does. This is the API's version: running it there would mean the API tier
    scraping `t.me` for a Discover probe sweep, or sweeping retention — the
    exact work `app/worker.py` exists to own.

    It waits rather than returning immediately because the endpoint's contract
    is the *post-run* status, and the Jobs panel renders what it returns. On
    timeout it answers with whatever it knows, which is the honest result for a
    job that is genuinely still going: the status subscriber keeps updating it
    afterwards either way.
    """
    if job_id not in _JOB_RUNNERS:
        raise ValueError(f"Unknown job: {job_id}")

    before = _announce_seq.get(job_id, 0)
    await asyncio.to_thread(
        pg_notify.publish, SCHEDULER_TRIGGER_CHANNEL, {"jobId": job_id}
    )

    # Waits on the announcement counter, not on `lastRun`. A *disabled* job
    # never sets `lastRun` — `_run_guarded` announces `lastStatus: "disabled"`
    # and returns — so a `lastRun`-based wait polled for the entire timeout and
    # then handed back the same idle status. Pressing "Run now" on a paused job
    # should say "disabled" immediately, not hang for thirty seconds.
    deadline = asyncio.get_running_loop().time() + timeout_s
    while asyncio.get_running_loop().time() < deadline:
        if (
            # `!=`, not `>`. The counter is the *worker's*, copied over on each
            # announcement, and it restarts at 1 when the worker does — so the
            # first "Run now" after a worker restart would compare 1 against a
            # remembered 9, never fire, and block for the whole timeout.
            _announce_seq.get(job_id, 0) != before
            and _job_status[job_id].get("lastStatus") != "running"
        ):
            break
        await asyncio.sleep(0.1)
    return dict(get_job_status()[job_id])


def get_job_status() -> dict[str, Any]:
    _refresh_enabled_flags()
    status = {job_id: dict(data) for job_id, data in _job_status.items()}
    with Session(engine) as session:
        from app.jobs.settings import load_sync_settings

        sync_cfg = load_sync_settings(session)
        if sync_cfg.get("autoSyncPauseUntil"):
            status["auto_sync"]["pauseUntil"] = sync_cfg["autoSyncPauseUntil"]
    return status


async def trigger_job(job_id: str) -> dict[str, Any]:
    runner = _JOB_RUNNERS.get(job_id)
    if not runner:
        raise ValueError(f"Unknown job: {job_id}")
    await runner()
    result: dict[str, Any] = dict(get_job_status()[job_id])
    return result


def set_job_enabled_flag(job_id: str, enabled: bool) -> dict[str, Any]:
    if job_id not in JOB_IDS:
        raise ValueError(f"Unknown job: {job_id}")
    with Session(engine) as session:
        set_job_enabled(session, job_id, enabled)
    ap_job = scheduler.get_job(job_id)
    if ap_job:
        if enabled:
            ap_job.resume()
        else:
            ap_job.pause()
    _job_status[job_id]["enabled"] = enabled
    if scheduler.running:
        # The twin of the guard in `_refresh_enabled_flags`, and its absence
        # here was exactly the "a fix applied to one of two twin modules is half
        # a fix" pattern. In the API process `scheduler.get_job` returns `None`
        # for everything, so this answered `nextRun: null` and overwrote the
        # value the worker had announced — for every job an operator toggles,
        # until that job next runs.
        _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
    result: dict[str, Any] = dict(get_job_status()[job_id])
    return result


def _retention_startup_kwargs() -> dict[str, Any]:
    """First-run timing for the retention job.

    An interval job's first run is otherwise start+interval away, so on a
    frequently-redeployed backend the sweep can be reset before it ever
    fires. A next_run_time makes retention also run shortly after boot; the
    delay lets startup settle first. Returns empty (interval-only) when the
    delay is 0.
    """
    delay = settings.RETENTION_JOB_STARTUP_DELAY_SECONDS
    if delay <= 0:
        return {}
    # Naive local time matches AsyncIOScheduler's default timezone.
    return {"next_run_time": datetime.now() + timedelta(seconds=delay)}


def _retention_job_kwargs() -> dict[str, Any]:
    """add_job kwargs for retention: startup timing plus misfire tolerance.

    The scraping jobs block the event loop for several seconds at a time,
    longer than APScheduler's 1s default grace, so a strict retention run is
    dropped as a misfire (observed on staging: the startup run was "missed by
    5s" and skipped, then deferred a full interval). Retention is a cleanup
    sweep - running late is fine, never running is not - so let it run however
    late, collapsing any catch-up runs into one.
    """
    return {
        "misfire_grace_time": None,
        "coalesce": True,
        **_retention_startup_kwargs(),
    }


def start_scheduler() -> None:
    if scheduler.running:
        return

    scheduler.add_job(
        job_auto_sync,
        "interval",
        seconds=settings.AUTO_SYNC_CHECK_INTERVAL_SECONDS,
        id="auto_sync",
        replace_existing=True,
    )
    scheduler.add_job(
        job_embeddings,
        "interval",
        seconds=settings.EMBEDDINGS_JOB_INTERVAL_SECONDS,
        id="embeddings",
        replace_existing=True,
    )
    scheduler.add_job(
        job_auto_summary,
        "interval",
        seconds=settings.AUTO_SUMMARY_JOB_INTERVAL_SECONDS,
        id="auto_summary",
        replace_existing=True,
    )
    scheduler.add_job(
        job_retention,
        "interval",
        hours=settings.RETENTION_JOB_INTERVAL_HOURS,
        id="retention",
        replace_existing=True,
        **_retention_job_kwargs(),
    )
    scheduler.add_job(
        job_translation_batch,
        "interval",
        seconds=settings.TRANSLATION_BATCH_JOB_INTERVAL_SECONDS,
        id="translation_batch",
        replace_existing=True,
    )
    scheduler.add_job(
        job_discover_probe,
        "interval",
        seconds=settings.DISCOVER_PROBE_JOB_INTERVAL_SECONDS,
        id=DISCOVER_PROBE_JOB_ID,
        replace_existing=True,
        # Same reasoning as retention: a sweep blocks on network fetches for far
        # longer than APScheduler's 1s default grace, so a strict trigger would
        # drop ticks as misfires and defer a full interval. Running late is fine;
        # not running is not.
        misfire_grace_time=None,
        coalesce=True,
    )
    scheduler.add_job(
        job_sync_queue,
        "interval",
        seconds=settings.SYNC_QUEUE_POLL_INTERVAL_SECONDS,
        id="sync_queue",
        replace_existing=True,
        # Not in `JOB_IDS` (see the module docstring): no enable/disable
        # toggle, so no misfire/coalesce tuning either — a drain that
        # overruns its interval is fine to queue up rather than collapse,
        # since unlike retention or the probe sweep this one is short per run.
    )

    with Session(engine) as session:
        jobs_cfg = load_jobs_settings(session)
        for job_id in JOB_IDS:
            entry = jobs_cfg.get(job_id, {})
            if isinstance(entry, dict) and not entry.get(
                "enabled", default_job_enabled(job_id)
            ):
                ap_job = scheduler.get_job(job_id)
                if ap_job:
                    ap_job.pause()
                _job_status[job_id]["enabled"] = False

    scheduler.start()
    _refresh_enabled_flags()
    logger.info("APScheduler started (single-instance in-process job runner)")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
