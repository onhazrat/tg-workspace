"""Background sweep that probes Discover candidate handles (IDEA-011 D9).

Structurally a sibling of `bulk_follow`: an in-memory job, a semaphore over the
same proxy lanes, one `get_channel_info` per handle. The difference is what it
writes — a row in `tg_discover_probes` rather than a followed channel — and
that it is started automatically rather than by an explicit click, so it has to
be much more careful about what it costs.

Three things keep that cost bounded:

* **The cache is checked before the queue is built.** `handles_needing_probe`
  drops anything already resolved, so the expense is paid once per handle
  across every report ever generated, not once per report. The first sweep on
  a fresh install is the only expensive one.
* **The queue is rank-ordered.** Callers pass candidates strongest-first, so the
  rows the operator is actually reading resolve within seconds instead of after
  the long single-reference tail.
* **Concurrency is lower than bulk follow's.** This job runs unprompted and
  competes with scraping for the same lanes; a sweep finishing a minute later
  matters far less than a sync stalling behind it.

Unlike the sync and follow jobs there is no SSE stream. The durable result is
the probe table, which the report read already joins, so progress is a count
the client polls while the sweep runs — a second event-stream implementation
would carry no payload the report refetch does not already deliver.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.services.async_db import run_db
from app.services.discover_probes import handles_needing_probe, record_probe_result
from app.services.network_settings import (
    load_network_settings,
    resolve_proxies,
    resolve_proxy_concurrency,
)
from app.services.scraper import get_channel_info
from app.services.telegram_web import TelegramWebViewUnavailable

logger = logging.getLogger(__name__)

#: Deliberately below `FOLLOW_SCRAPE_CONCURRENCY` (4) — see the module docstring.
PROBE_SCRAPE_CONCURRENCY = 2

#: Ceiling on one sweep, so a very wide report cannot queue thousands of
#: fetches. The remainder is picked up by the next sweep, which starts from
#: whatever is still unprobed, so nothing is lost — it just arrives later.
MAX_HANDLES_PER_SWEEP = 400

_TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


@dataclass
class ProbeJobState:
    probe_job_id: str
    handles: list[str] = field(default_factory=list)
    status: str = "pending"
    completed: int = 0
    resolved: int = 0
    unavailable: int = 0
    failed: int = 0
    created_at: int = field(default_factory=lambda: int(time.time() * 1000))
    finished_at: int | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    user_id: uuid.UUID | None = None

    def to_camel(self) -> dict[str, Any]:
        return {
            "probeJobId": self.probe_job_id,
            "status": self.status,
            "total": len(self.handles),
            "completed": self.completed,
            "resolved": self.resolved,
            "unavailable": self.unavailable,
            "failed": self.failed,
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
        }


_active_jobs: dict[str, ProbeJobState] = {}
#: One sweep at a time. A second concurrent sweep would mostly re-probe the
#: same handles (the cache check happens at queue-build time, before the first
#: has written anything) while doubling the load on the proxy pool.
_running_job_id: str | None = None


def get_probe_job(probe_job_id: str) -> ProbeJobState | None:
    return _active_jobs.get(probe_job_id)


def active_probe_job() -> ProbeJobState | None:
    if _running_job_id is None:
        return None
    job = _active_jobs.get(_running_job_id)
    if job is None or job.status in _TERMINAL_STATUSES:
        return None
    return job


def clear_probe_jobs_for_tests() -> None:
    global _running_job_id
    _active_jobs.clear()
    _running_job_id = None


def _load_network(
    user_id: uuid.UUID | None,
) -> tuple[list[str], tuple[int, dict[str, int]], bool, int]:
    with Session(engine) as session:
        network = load_network_settings(session, user_id)
        return (
            resolve_proxies(network),
            resolve_proxy_concurrency(network),
            bool(network.get("torAutoRotate")),
            int(network.get("torRotationThreshold") or 10),
        )


def _pending_handles(handles: list[str]) -> list[str]:
    with Session(engine) as session:
        return handles_needing_probe(session, handles)[:MAX_HANDLES_PER_SWEEP]


def _store_result(
    handle: str, info: dict[str, Any] | None, error: str | None
) -> dict[str, Any]:
    with Session(engine) as session:
        return record_probe_result(session, handle, info, error=error)


async def create_probe_job(
    *, handles: list[str], user_id: uuid.UUID | None
) -> ProbeJobState | None:
    """Queue a sweep, or return `None` when there is nothing left to probe.

    `None` rather than an empty job so the caller can distinguish "everything is
    already known" from "a sweep is running" — the UI shows progress only for
    the latter, and an empty job would flash a 0/0 progress bar on every report
    whose handles are all cached.
    """
    global _running_job_id
    running = active_probe_job()
    if running is not None:
        return running

    pending = await run_db(_pending_handles, handles)
    if not pending:
        return None

    job = ProbeJobState(
        probe_job_id=str(uuid.uuid4()), handles=pending, user_id=user_id
    )
    _active_jobs[job.probe_job_id] = job
    _running_job_id = job.probe_job_id
    return job


async def cancel_probe_job(probe_job_id: str) -> ProbeJobState | None:
    job = get_probe_job(probe_job_id)
    if job is None:
        return None
    job.cancel_event.set()
    if job.status in ("pending", "running"):
        job.status = "cancelled"
        job.finished_at = int(time.time() * 1000)
    return job


async def _probe_one(
    job: ProbeJobState,
    handle: str,
    *,
    proxies: list[str],
    proxy_concurrency: tuple[int, dict[str, int]],
    tor_auto_rotate: bool,
    tor_rotation_threshold: int,
) -> None:
    if job.cancel_event.is_set():
        return

    info: dict[str, Any] | None = None
    error: str | None = None
    try:
        info = await get_channel_info(
            handle,
            proxies=proxies or None,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )
    except TelegramWebViewUnavailable as exc:
        # Telegram itself said the handle has no readable web view. That is an
        # answer, not a failure, so it is recorded as a verdict.
        info = {"isTelegramPage": True, "isUnavailableOnWebView": True}
        error = str(exc)
    except Exception as exc:  # noqa: BLE001
        error = str(exc)

    result = await run_db(_store_result, handle, info, error)

    job.completed += 1
    if result["status"] == "ok":
        job.resolved += 1
    elif result["status"] == "unavailable":
        job.unavailable += 1
    else:
        job.failed += 1


async def run_probe_job(job: ProbeJobState) -> None:
    global _running_job_id
    job.status = "running"
    (
        proxies,
        proxy_concurrency,
        tor_auto_rotate,
        tor_rotation_threshold,
    ) = await run_db(_load_network, job.user_id)
    sem = asyncio.Semaphore(PROBE_SCRAPE_CONCURRENCY)

    async def _run_one(handle: str) -> None:
        async with sem:
            try:
                await _probe_one(
                    job,
                    handle,
                    proxies=proxies,
                    proxy_concurrency=proxy_concurrency,
                    tor_auto_rotate=tor_auto_rotate,
                    tor_rotation_threshold=tor_rotation_threshold,
                )
            except Exception:  # noqa: BLE001
                # A probe that blows up must not take the sweep with it: the
                # handle simply stays unprobed and is retried by a later sweep.
                logger.exception("Discover probe failed for @%s", handle)
                job.completed += 1
                job.failed += 1

    try:
        await asyncio.gather(*[_run_one(h) for h in job.handles])
        if job.cancel_event.is_set():
            job.status = "cancelled"
        else:
            job.status = "completed"
    finally:
        job.finished_at = int(time.time() * 1000)
        if _running_job_id == job.probe_job_id:
            _running_job_id = None
