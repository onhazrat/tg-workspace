"""The sync tier: scheduler, queue consumer, and nothing that serves HTTP.

Ticket 10. `python -m app.worker`, one replica, same image as the API.

**Why a second process rather than a second thread.** The thing being fixed is
that deploying or restarting the API aborted whatever sync was mid-flight —
`run_sync_job` lived in the web process, so `fastapi run` reloading took the
scrape with it. A thread inside the same container dies with the same signal. It
has to be a process with its own lifecycle, which is a compose service.

**Two tiers with opposite scaling rules**, which is the shape
`docs/scaling-to-multiple-workers.md` argues for: the API tier grows with users
and is stateless; the sync tier stays at one replica because it is bounded by
how fast this deployment may politely hit `t.me` through a fixed proxy set.
Doubling users does not double that budget. So this file must never learn to
serve a request, and the API must never learn to scrape.

**What lives here.** The APScheduler instance (every job in `JOB_IDS`, including
auto-sync), and the lane consumer that drains `DRAIN_ORDER`. Both used to run in
the API process; `app/main.py` now starts neither.

**What still runs in the API process.** `reconcile_interrupted_jobs` does *not*
move here, it moves to being this process's job alone — see below. The progress
subscriber runs in both, for opposite reasons (serving SSE there, hearing
cancellations here).

**Startup order matters and is not obvious.** `reconcile_interrupted_jobs` marks
every non-terminal `tg_sync_jobs` row failed, on the reasoning that in-memory
progress cannot survive a restart. That reasoning is *this* process's: after
ticket 10 the API restarting says nothing about whether a sync is running. If
the API kept calling it, an ordinary deploy of the web tier would fail every
sync the worker was in the middle of. It therefore runs here, before the
scheduler starts, and only here.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from concurrent.futures import ThreadPoolExecutor

from sqlmodel import Session

from app.core.config import settings
from app.core.db import db_pool_capacity, engine, init_db
from app.core.startup_checks import run_startup_checks
from app.jobs.scheduler import (
    start_job_trigger_consumer,
    start_scheduler,
    stop_job_trigger_consumer,
    stop_scheduler,
)
from app.jobs.sync_queue import (
    queued_job_ids,
    start_lane_consumer,
    stop_lane_consumer,
)
from app.services.bulk_follow import (
    reconcile_interrupted_follow_jobs,
    start_follow_job_consumer,
    stop_follow_job_consumer,
)
from app.services.scraper_jobs import (
    reconcile_interrupted_jobs,
    start_progress_subscriber,
    stop_progress_subscriber,
)

logger = logging.getLogger(__name__)


#: Threads over and above the connection pool, for the `to_thread` calls that
#: open no `Session` at all — `pg_notify` sends, file writes, the Tor control
#: socket. Small on purpose: threads past the connection count are not more
#: parallelism, they are the same queue one layer down.
_NON_DB_THREAD_HEADROOM = 4


def _size_the_thread_pool() -> None:
    """Give `asyncio.to_thread` as many threads as there are connections.

    Almost every `to_thread` call in this process opens a `Session` — reading a
    lane, charging the ledger, persisting job progress — so the thread pool and
    the database pool are two halves of one number. The default pool is
    `min(32, cpu_count + 4)`, which on the two-core box this deployment runs on
    is **six**. Six threads cannot use thirty connections, so raising
    `DB_POOL_SIZE` alone would have moved the queue from the database pool to
    the executor and changed nothing an operator could see (ADR-012).

    Sized *from* the connection capacity rather than to a literal, because more
    threads than connections is not more parallelism — it is the same queue one
    layer down, minus the ability to say which layer it is in. The headroom is
    for the `to_thread` calls that do no database work at all.
    """
    # Derived in the argument rather than through a local, so that the guard in
    # `tests/deployment/test_pool_sizing.py` reads the number that is actually
    # installed. Its first version read the function's source text, and stayed
    # green against a hard-coded 34 because the log line below still named
    # `db_pool_capacity`.
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(
            max_workers=db_pool_capacity() + _NON_DB_THREAD_HEADROOM,
            thread_name_prefix="worker-db",
        )
    )
    logger.info(
        "thread pool sized for %d database connections",
        db_pool_capacity(),
    )


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    run_startup_checks()
    _size_the_thread_pool()

    with Session(engine) as session:
        # `init_db` is idempotent and both processes call it. The worker may
        # legitimately come up first (compose starts them together), and a
        # scheduler running against a database with no bootstrap superuser and
        # no seeded roles fails on a foreign key rather than on anything that
        # names the problem.
        init_db(session)
        # This process's in-memory progress is the only copy, so a non-terminal
        # row belongs to a dead worker — *unless* its messages are still on a
        # lane, which after ticket 10 is the normal state of a job the API
        # queued while this process was restarting. `queued_job_ids` is read
        # first, and those jobs are left alone.
        reconcile_interrupted_jobs(session, still_queued=queued_job_ids())

    # No `still_queued` counterpart: a follow job has no queue behind it, so a
    # non-terminal row is always a dead process's. See the function's docstring.
    interrupted_follows = reconcile_interrupted_follow_jobs()
    if interrupted_follows:
        logger.info("failed %d interrupted follow jobs", interrupted_follows)

    start_progress_subscriber()
    start_lane_consumer()
    start_follow_job_consumer()
    start_job_trigger_consumer()
    start_scheduler()
    logger.info(
        "Sync worker started (scheduler + queue consumer, environment=%s)",
        settings.ENVIRONMENT,
    )

    # `loop.add_signal_handler`, not `signal.signal`: a C-level handler runs
    # between bytecodes on the main thread with no loop context, so setting an
    # `asyncio.Event` from one is not guaranteed to wake anything waiting on
    # it. The loop's own handler is scheduled as a callback and is safe.
    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown.set)

    await shutdown.wait()

    logger.info("Sync worker shutting down")
    stop_scheduler()
    stop_job_trigger_consumer()
    stop_follow_job_consumer()
    stop_lane_consumer()
    stop_progress_subscriber()


if __name__ == "__main__":
    asyncio.run(main())
