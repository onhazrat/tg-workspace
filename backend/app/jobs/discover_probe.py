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

**An ordering, not a number** (ticket 36, ADR-012 D9). This used to gather each
batch behind an `asyncio.Semaphore(2)` of its own, chosen to stay below
`bulk_follow`'s on the reasoning that a sweep finishing a minute later matters
far less than a sync stalling behind it. That reasoning was right and the
mechanism was wrong twice over: two concurrent fetches outside the Partition
are a second scraping budget nothing counts, and a fetch that holds no Slot
binds to no proxy, so each probe picked whichever lane was least loaded — the
hopping the Partition exists to remove, in the one job that runs unprompted.

So this tick only *enqueues*. The messages drain from
`discover_probe_background`, which `LaneScheduler` serves strictly after every
sync lane, so a probe starts only when nothing else wants a Slot. `_sweep_lock`
still makes an overlapping tick a no-op, though it matters far less now that
the tick's work is one `send_batch`.

**And it enqueues nothing while the lane still holds anything.** Selecting work
and doing it are separate now, so the lane is the only record of what is already
outstanding; a tick that topped it up would re-select the handles sitting on it.
Emptiness is the gate. A `retry_after` lease was tried first and was the wrong
shape: a queued message is claimed by nobody, so nothing could renew it, and a
probe starved behind sync work for longer than the lease came back as a
duplicate.
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
from app.services.pgmq import queue_length
from app.services.scraper import get_channel_info
from app.services.sync_lanes import DISCOVER_PROBE_LANE
from app.services.telegram_web import TelegramWebViewUnavailable

logger = logging.getLogger(__name__)

#: Scheduler job id. Registering under the ordinary job machinery is most of the
#: point: enable/disable, manual trigger and last-run status all come for free,
#: and "pause probing" becomes durable server state rather than a browser ref.
DISCOVER_PROBE_JOB_ID = "discover_probe"

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


def _lane_depth() -> int:
    """Messages on the probe lane, due or in flight."""
    with Session(engine) as session:
        return queue_length(session, DISCOVER_PROBE_LANE)


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


async def probe_one_handle(handle: str) -> str:
    """Probe one handle, reading the network settings for itself.

    The entry point the lane consumer calls (ticket 36, ADR-012). The sweep
    used to load the settings once and hand them to every probe in the batch;
    a batch is now N independent messages that may be drained minutes apart, so
    each reads them at the moment it runs. One extra settings read per probe,
    against a fetch that takes seconds — and it means an operator's proxy edit
    reaches the queued backlog instead of being fixed at enqueue time.

    Swallows its own failures. A probe that raises would leave the message on
    the lane to be redelivered up to `SYNC_QUEUE_MAX_READ_COUNT` times, which
    is the wrong shape for this: the handle stays in `tg_discover_probes` and a
    later sweep re-enqueues it, so the retry lives in the backlog table rather
    than in the queue's redelivery count.
    """
    (
        proxies,
        proxy_concurrency,
        tor_auto_rotate,
        tor_rotation_threshold,
    ) = await run_db(_load_network)
    try:
        return await _probe_one(
            handle,
            proxies=proxies,
            proxy_concurrency=proxy_concurrency,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Discover probe failed for @%s", handle)
        return "unknown"


async def run_discover_probe_sweep() -> dict[str, Any]:
    """Queue one batch of handles for probing.

    Returns a summary dict, which the scheduler surfaces as the job's `detail`.
    It reports what was **enqueued** rather than what was found: since ADR-012
    the fetches happen in the lane consumer, so this function is finished long
    before the verdicts are. The verdicts themselves are rows the report read
    already joins, which is why that was never the interesting number.
    """
    if _sweep_lock.locked():
        return {"skipped": True, "reason": "sweep already running"}

    async with _sweep_lock:
        # **Nothing is enqueued while the lane still holds anything.**
        #
        # `dequeue_handles` is a pure read: a handle keeps `status='unknown'`
        # until a verdict lands, and the verdict now arrives from the consumer
        # long after this tick has returned. So the lane's own contents are the
        # only record of what is already outstanding, and topping it up would
        # re-select the handles sitting on it.
        #
        # A `retry_after` lease was the first answer and was the wrong one. It
        # had no holder — a queued message is claimed by nobody — so nothing
        # could renew it, and a probe starved behind sync work for longer than
        # the lease was enqueued again. It also gave `retry_after` two meanings
        # depending on which writer set it. Gating on emptiness needs no second
        # copy of "what is outstanding" and cannot go stale.
        #
        # `queue_length` counts due **and** in-flight messages: a claimed one
        # stays in `q_` with a future `vt`, so a probe being fetched right now
        # keeps this above zero.
        #
        # The cost is a duty cycle. The lane drains, then waits up to
        # `DISCOVER_PROBE_JOB_INTERVAL_SECONDS` for the next tick to refill it,
        # so a large first-run backlog clears in roughly twice the time. That is
        # the tick interval's to fix if it ever matters, and probing is the
        # lowest-priority work on the deployment by construction.
        if await run_db(_lane_depth) > 0:
            return {"skipped": True, "reason": "lane still draining"}

        handles = await run_db(_dequeue, settings.DISCOVER_PROBE_BATCH_SIZE)
        if not handles:
            return {"skipped": True, "reason": "queue empty"}

        # **Enqueued, not fetched here** (ticket 36, ADR-012 D9). This used to
        # gather the batch behind an `asyncio.Semaphore(2)` of its own: a
        # second scraping budget nothing counted, and fetches that took no Slot
        # and so bound to no proxy — the walk-hopping defect the Partition
        # exists to remove, in the one job that runs unprompted.
        #
        # The messages drain from `discover_probe_background`, strictly after
        # every sync lane, so a probe starts only when nothing else wants a
        # Slot. That is the pacing the old semaphore was approximating by being
        # small, expressed as an ordering instead of a number.
        # Imported here rather than at the top: `sync_queue` reaches back into
        # this module for `probe_one_handle` when it drains one, and a pair of
        # top-level imports would be a cycle. This direction is the lazy one
        # because it runs once per tick, where the consumer's runs per message.
        from app.jobs.sync_queue import enqueue_discover_probes

        enqueued = await enqueue_discover_probes(handles)

        return {
            "enqueued": enqueued,
            "remaining": await run_db(_remaining),
        }
