"""Postgres `LISTEN`/`NOTIFY` as a process-crossing wakeup (ticket 10).

In `core/` rather than `services/` for the reason `request_meter.py` is:
infrastructure with no domain in it. This module knows about channels, payloads
and one dedicated connection. What a payload *means* is decided by its caller
(`services/scraper_jobs.py` for sync-job progress), which is what keeps the
five-kinds rule in `services/` from having to grow another exception.

**Why this exists at all.** `GET /jobs/sync/{id}/events` blocks on an
`asyncio.Condition` attached to the in-memory job, so it can only see progress
for a job running in its own process. Ticket 10 moves the sync into a worker
process, and the failure mode is not an error — `sync_job_events` already falls
back to `get_job`'s row read, so the stream keeps working and silently starts
serving state throttled to `SYNC_JOB_PERSIST_INTERVAL_MS` (5s). That is the
"progress streaming degrades to a 5-second database poll" that
`docs/scaling-to-multiple-workers.md` warns about, and it is why step 1 of that
plan is a prerequisite of ticket 10 rather than a follow-up to it.

**One connection, one channel, fan-out in Python.** `LISTEN` is per-connection,
not per-subscriber, so a channel per job would mean a connection per watcher (or
a `LISTEN`/`UNLISTEN` on every stream open and close, on a shared connection,
racing every other stream). One long-lived connection listening to one channel,
with the dispatch done here, costs one backend regardless of how many browsers
are watching.

**A dropped connection loses notifications, and that is survivable.** `NOTIFY`
has no replay: a listener that reconnects has missed whatever fired while it was
away. Every consumer of this module must therefore treat a notification as a
*hint to look*, never as the only copy of the fact — sync-job progress is
durable in `tg_sync_jobs` and the stream re-reads it, so a missed delta costs at
most one throttle interval of freshness, not correctness.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Coroutine
from typing import Any

import psycopg
import psycopg.sql
from sqlalchemy import text

from app.core.config import settings
from app.core.db import engine

logger = logging.getLogger(__name__)

#: Postgres refuses a `NOTIFY` payload over 8000 bytes, and it refuses it at
#: *send* time — the transaction errors rather than the notification being
#: silently truncated. Callers send deltas small enough that this never trips;
#: it is checked here anyway so a caller that grows its payload finds out from a
#: log line naming the channel, rather than from an exception raised inside a
#: sync that then looks like a scrape failure.
MAX_PAYLOAD_BYTES = 8000

#: Seconds between reconnect attempts after the listen connection drops.
_RECONNECT_DELAY_SECONDS = 2.0


def _dsn() -> str:
    """A libpq DSN for psycopg, from the SQLAlchemy URL the app already has.

    SQLAlchemy spells the driver into the scheme (`postgresql+psycopg://`);
    psycopg wants it out. Derived rather than assembled from the individual
    `POSTGRES_*` settings so there is exactly one place that decides which
    database this process talks to — the tests override `POSTGRES_DB`, and a
    listener that quietly stayed on the dev database would pass every assertion
    about publishing and receive nothing.
    """
    return str(settings.SQLALCHEMY_DATABASE_URI).replace("+psycopg", "", 1)


def publish(channel: str, payload: dict[str, Any]) -> None:
    """Send one notification. Blocking; call it through `run_db`/`to_thread`.

    Uses `pg_notify(...)` rather than the `NOTIFY` statement because the channel
    and payload are values here, and `NOTIFY` takes neither as a bind parameter.

    Sent on its own AUTOCOMMIT connection, deliberately not on whatever session
    the caller happens to hold. A `NOTIFY` inside a transaction is delivered on
    commit and discarded on rollback, so riding a caller's session would make
    delivery depend on a transaction boundary the caller chose for unrelated
    reasons — including the read-only sessions that never commit at all.
    """
    # `default=str` rather than letting a stray value raise: a payload is
    # assembled from whatever a job returned, and an un-encodable `detail`
    # must not be able to take down the job it is describing.
    encoded = json.dumps(payload, separators=(",", ":"), default=str)
    if len(encoded.encode()) > MAX_PAYLOAD_BYTES:
        logger.warning(
            "notify payload for %r is %s bytes, over the %s-byte cap; dropping it",
            channel,
            len(encoded.encode()),
            MAX_PAYLOAD_BYTES,
        )
        return
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(
            text("SELECT pg_notify(:channel, :payload)"),
            {"channel": channel, "payload": encoded},
        )


class Listener:
    """One `LISTEN` connection for one channel, fanned out to many subscribers.

    Started lazily on the first `subscribe()` and left running: the connection
    is one backend, and tearing it down when the last watcher leaves would mean
    paying the connect cost again for the next one, which on a busy deployment
    is every few seconds.
    """

    def __init__(self, channel: str) -> None:
        self._channel = channel
        self._queues: set[asyncio.Queue[dict[str, Any]]] = set()
        self._task: asyncio.Task[None] | None = None
        self._ready: asyncio.Event = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        # `_ensure_running` first, because it drops every queue belonging to a
        # previous event loop — including, if the order were reversed, this one.
        self._ensure_running()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queues.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._queues.discard(queue)

    async def wait_until_listening(self, timeout_s: float = 5.0) -> bool:
        """Block until the connection has actually issued its `LISTEN`.

        Only tests need this. Without it a test publishes into the gap between
        `subscribe()` returning and the background task connecting, receives
        nothing, and fails for a reason that has nothing to do with what it is
        checking — the classic listener-test flake.
        """
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=timeout_s)
        except TimeoutError:
            return False
        return True

    def _ensure_running(self) -> None:
        """Start the listen task, rebuilding if the event loop changed.

        A `Task` and an `Event` belong to the loop that created them, and this
        object is cached per channel for the life of the process. One loop per
        process makes that a non-issue in the API and the worker — but not in
        the test suite, where each module's `TestClient` runs the app in a new
        loop and gets handed the previous module's `Listener`. Its `_ready` is
        already set and its `_task` is not `done()` (the loop that would have
        finished it is gone), so `subscribe()` returns a queue that nothing will
        ever fill and `wait_until_listening` answers `True` immediately. The
        result is a test that waits for a notification that cannot arrive, in a
        module that passes when run on its own.

        Cheap to check and it removes a whole class of "works alone, hangs in
        the suite", so it is checked rather than documented as a caveat.
        """
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            if self._task is not None:
                self._task.cancel()
            self._loop = loop
            self._task = None
            # Cleared, never replaced. Since 3.10 an `asyncio.Event` holds no
            # loop of its own — it resolves one per `wait()` — so the same
            # object is reusable, and swapping it strands anyone already
            # waiting: `start_progress_subscriber` creates the task that calls
            # this, so a caller can reach `wait_until_listening` first and be
            # left holding an Event nothing will ever set.
            self._ready.clear()
            # The queues do belong to the old loop, and nothing here waits on
            # them any more.
            self._queues.clear()
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run_forever())

    def _dispatch(self, payload: str) -> None:
        try:
            message: dict[str, Any] = json.loads(payload)
        except json.JSONDecodeError:
            logger.warning("unparsable notify payload on %r", self._channel)
            return
        for queue in list(self._queues):
            queue.put_nowait(message)

    async def _run_forever(self) -> None:
        while True:
            try:
                await self._listen_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("listen connection on %r dropped", self._channel)
            self._ready.clear()
            await asyncio.sleep(_RECONNECT_DELAY_SECONDS)

    async def _listen_once(self) -> None:
        conn = await psycopg.AsyncConnection.connect(_dsn(), autocommit=True)
        try:
            await conn.execute(
                psycopg.sql.SQL("LISTEN {}").format(
                    psycopg.sql.Identifier(self._channel)
                )
            )
            self._ready.set()
            async for notification in conn.notifies():
                self._dispatch(notification.payload)
        finally:
            self._ready.clear()
            await conn.close()


class NotificationConsumer:
    """A long-lived task that reads notifications, restartable across loops.

    Both consumers of this module — the sync-progress subscriber and the lane
    consumer — are one module-level `asyncio.Task` started at boot. Kept as a
    bare global, each hits the same trap `Listener._ensure_running` documents:
    a task belonging to a finished event loop is not `done()`, so the obvious
    `if task is None or task.done()` guard silently declines to start it in the
    new loop, and the process ends up with a consumer that exists and consumes
    nothing.

    One loop per process makes that unreachable in the API and the worker, and
    routine in the test suite, where every module's `TestClient` brings a new
    loop. Writing it twice would have been writing the same bug twice.
    """

    def __init__(self, factory: Callable[[], Coroutine[Any, Any, None]]) -> None:
        self._factory = factory
        self._task: asyncio.Task[None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            self.stop()
            self._loop = loop
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._factory())

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None


_listeners: dict[str, Listener] = {}


def listener(channel: str) -> Listener:
    """The process's one `Listener` for `channel`, created on first use."""
    if channel not in _listeners:
        _listeners[channel] = Listener(channel)
    return _listeners[channel]


def reset_listeners_for_tests() -> None:
    """Drop every listener, cancelling its connection task.

    Each test gets its own event loop, and a `Listener` holds an
    `asyncio.Task` and an `asyncio.Event` bound to the loop that created them.
    Reusing one across loops does not fail loudly — it just never fires again.
    """
    for existing in _listeners.values():
        if existing._task is not None:
            existing._task.cancel()
    _listeners.clear()
