"""Keeping the Request record moving (RQS-01, ADR-035).

Two loops. The flusher runs in **both** processes, because each holds its own
buffer: it writes the buffered Requests every `REQUEST_FLUSH_SECONDS`, and once
more on shutdown. The ledger's `finally` flushes too, so a sync's Requests are
written when its charge is; this loop covers the rest. The rollup runs in the
worker's scheduler every five minutes.

Both call blocking code through a thread, so the event loop never waits on the
database and no session is held across an `await`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from app.services.request_stats import flush_recorded_requests, roll_up_request_totals

logger = logging.getLogger(__name__)

#: How often each process writes the Requests it has buffered. A hard kill
#: loses at most this much, the gap the quota ledger already accepts.
REQUEST_FLUSH_SECONDS = 5
REQUEST_ROLLUP_JOB_ID = "request_rollup"
#: How often the hourly and daily Request totals are rebuilt, so the Requests
#: tab is at most this far behind.
REQUEST_ROLLUP_INTERVAL_SECONDS = 300

_flusher: asyncio.Task[None] | None = None


async def _flush_forever() -> None:
    while True:
        await asyncio.sleep(REQUEST_FLUSH_SECONDS)
        await asyncio.to_thread(flush_recorded_requests)


def start_request_flusher() -> None:
    global _flusher
    if _flusher is None or _flusher.done():
        _flusher = asyncio.get_running_loop().create_task(_flush_forever())


async def stop_request_flusher() -> None:
    """Stop the loop, then write whatever it had not written yet."""
    global _flusher
    if _flusher is not None:
        _flusher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _flusher
        _flusher = None
    await asyncio.to_thread(flush_recorded_requests)


async def run_request_rollup() -> None:
    try:
        await asyncio.to_thread(roll_up_request_totals)
    except Exception:  # noqa: BLE001
        logger.exception("Requests: the rollup failed; the next run retries it")
