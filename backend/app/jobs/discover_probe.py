"""Scheduled drain of the Discover handle-probe queue (IDEA-011 D9).

Fetches `t.me/<handle>` once per candidate handle and records what it found, so
a Discover report arrives already triaged instead of asking the operator to sort
bots, personal accounts and private channels out of it by hand.

## Why this is a scheduled job and not something the client starts

It used to be driven from a React effect: the browser worked out which handles
still lacked a verdict, POSTed them, polled a progress endpoint, and chained the
next batch when one finished. Every part of that was a source of bugs, and one
of them was unfixable in that position — a report wider than one batch stopped
being probed the moment the tab was closed, silently and indefinitely, because
the thing chaining the batches was in the browser.

The decision "which handles still need probing" was always the server's; the
client was re-deriving a worse copy of it from a possibly stale report and asking
the server to re-filter the result. `dequeue_handles` answers it from the queue
alone, so a plain interval job is enough and the client is left with nothing to
orchestrate.

## Pacing

Concurrency stays below `bulk_follow`'s: this runs unprompted and competes for
the same proxy lanes, and a sweep finishing a minute later matters far less than
a sync stalling behind it. A batch commonly outlasts the tick interval, which is
fine — `_sweep_lock` turns the overlapping tick into an immediate no-op, so the
effective pace self-limits to how fast Telegram answers rather than to the
configured interval.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.async_db import run_db
from app.services.discover_probes import (
    dequeue_handles,
    queue_counts,
    record_probe_result,
)
from app.services.network_settings import (
    load_network_settings,
    resolve_proxies,
    resolve_proxy_concurrency,
)
from app.services.scraper import get_channel_info
from app.services.telegram_web import TelegramWebViewUnavailable

logger = logging.getLogger(__name__)

#: Scheduler job id. Registering under the ordinary job machinery is most of the
#: point: enable/disable, manual trigger and last-run status all come for free,
#: and "pause probing" becomes durable server state rather than a browser ref.
DISCOVER_PROBE_JOB_ID = "discover_probe"

#: Deliberately below `FOLLOW_SCRAPE_CONCURRENCY` (4) — see the module docstring.
PROBE_SCRAPE_CONCURRENCY = 2

#: One sweep at a time.
#:
#: Load-bearing rather than defensive. APScheduler's own `max_instances=1` covers
#: the scheduled trigger, but not `POST /jobs/discover_probe/trigger`, which calls
#: the runner directly. Holding the invariant here covers both, and returning
#: immediately when it is held means an overlapping tick is a cheap no-op instead
#: of an APScheduler "maximum number of running instances reached" warning.
_sweep_lock = asyncio.Lock()


def is_sweep_running() -> bool:
    return _sweep_lock.locked()


def _dequeue(limit: int) -> list[str]:
    with Session(engine) as session:
        return dequeue_handles(session, limit=limit)


def _remaining() -> int:
    with Session(engine) as session:
        counts = queue_counts(session)
        return counts["queued"] + counts["retrying"]


def _load_network() -> tuple[list[str], tuple[int, dict[str, int]], bool, int]:
    with Session(engine) as session:
        network = load_network_settings(session)
        return (
            resolve_proxies(network),
            resolve_proxy_concurrency(network),
            bool(network.get("torAutoRotate")),
            int(network.get("torRotationThreshold") or 10),
        )


def _store_result(
    handle: str, info: dict[str, Any] | None, error: str | None
) -> dict[str, Any]:
    with Session(engine) as session:
        return record_probe_result(session, handle, info, error=error)


async def _probe_one(
    handle: str,
    *,
    proxies: list[str],
    proxy_concurrency: tuple[int, dict[str, int]],
    tor_auto_rotate: bool,
    tor_rotation_threshold: int,
) -> str:
    """Fetch one handle and record the outcome. Returns the resulting status."""
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
    return str(result["status"])


async def run_discover_probe_sweep() -> dict[str, Any]:
    """Probe one batch from the queue.

    Returns a summary dict, which the scheduler surfaces as the job's `detail` —
    the only progress reporting this job needs, since the verdicts themselves are
    rows the report read already joins.
    """
    if _sweep_lock.locked():
        return {"skipped": True, "reason": "sweep already running"}

    async with _sweep_lock:
        handles = await run_db(_dequeue, settings.DISCOVER_PROBE_BATCH_SIZE)
        if not handles:
            return {"skipped": True, "reason": "queue empty"}

        (
            proxies,
            proxy_concurrency,
            tor_auto_rotate,
            tor_rotation_threshold,
        ) = await run_db(_load_network)
        sem = asyncio.Semaphore(PROBE_SCRAPE_CONCURRENCY)
        tally = {"ok": 0, "unavailable": 0, "unknown": 0}

        async def _run_one(handle: str) -> None:
            async with sem:
                try:
                    status = await _probe_one(
                        handle,
                        proxies=proxies,
                        proxy_concurrency=proxy_concurrency,
                        tor_auto_rotate=tor_auto_rotate,
                        tor_rotation_threshold=tor_rotation_threshold,
                    )
                except Exception:  # noqa: BLE001
                    # A probe that blows up must not take the batch with it. The
                    # handle stays queued and a later tick retries it; the only
                    # cost of getting here is one wasted fetch.
                    logger.exception("Discover probe failed for @%s", handle)
                    tally["unknown"] += 1
                    return
            tally[status if status in tally else "unknown"] += 1

        await asyncio.gather(*[_run_one(handle) for handle in handles])

        return {
            "probed": len(handles),
            "resolved": tally["ok"],
            "unavailable": tally["unavailable"],
            "failed": tally["unknown"],
            "remaining": await run_db(_remaining),
        }
