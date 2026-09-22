"""The harvest sweep: handles enter the Directory on their own (ticket 04, IDEA-011 D16).

Before this, the deployment only ever looked at handles somebody's Discovery
report had named. Everything else a Post referenced — every forward, every
mention, every `t.me` link — stayed invisible until an Account happened to run a
scan over the right Scope, so "what Channels do we know exist" had no answer
that did not depend on who had been clicking.

This reads the reference graph instead and puts what it names into the
Directory queue. Every Reference target with no Directory entry is new work.

## It reads References, not Posts (DDS-02)

Until DDS-02 the sweep walked the stored Posts itself, with its own progress
flag (`Post.harvested`), and pulled handles out of them with
`discover.post_references`. The reference-extraction walk (CRG-01) reads the
same Posts with a sibling extractor that `test_post_references.py` holds to the
same handles, and writes them to `tg_post_references`. So the graph already
held every handle the harvest walk found, and the harvest was a second
extraction feeding one queue.

It also held more. A Directory probe mines its preview page's samples for
References (CRG-02), and those samples come from Channels nobody follows. The
Post walk could never see them, so the Directory stopped one hop from the
follows while the graph recorded the next hop and nothing queued it. Reading
the graph makes the crawl recursive: a queued handle is probed, its samples
name more handles, the next tick queues those. The existing refresh re-probes
every live entry, so each refresh brings in what that Channel cited since.
`DIRECTORY_FOLLOW_SAMPLE_REFERENCES` switches the sample source off, which
queues exactly what the Post walk used to. `docs/migration/ADR-020-*.md`
records the trade: a Post whose Channel has no chat id is deferred by
extraction, and so are its handles now.

There are no marks and no cursor. The query is an anti-join against the
Directory, so a target the ceiling turned away is simply still unknown on the
next tick, and a caught-up tick finds nothing.

## A sweep, not a write on the sync path

Extracting at ingest was the obvious alternative and is the wrong shape twice
over. It would put a Directory write inside the walk an Account is waiting on,
and it would leave the deployment with no throttle at all: the rate of new
handles would be the rate of new Posts, which is not a number anybody chose.
As a sweep there is one place to turn down (the backlog ceiling) and nothing an
Account waits on.

## What it refuses to enqueue

Handles somebody follows, because sync already fetches those Channels' metadata
on every run and `record_sync_metadata` (ticket 03) writes it into the Directory
for free. Probing them here would be the same page fetched twice by two routes,
and the sync route is both cheaper and more frequent.

Handles the Directory already holds a row for, whatever the verdict. A pending
row is already queued and a conclusive one is already answered, so re-finding
either is not new work, and the budget has to count *new* handles or a graph
full of References to known handles would exhaust it while throttling nothing.

Anything at all, once the pending backlog is at the ceiling. See
`run_directory_harvest_sweep`.

## Where the work goes

Nowhere, directly. The sweep writes `tg_channel_directory` rows and stops; the
existing probe sweep is what puts them on `discover_probe_background`, which
`LaneScheduler` serves strictly after every sync lane. That layering is the
reason this job needs no lane, no Slot and no proxy of its own — and it means
the ordering guarantee ticket 36 established did not have to be restated here.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.async_db import run_db
from app.services.channel_directory import (
    HARVEST_PRIORITY,
    enqueue_handles,
    queue_counts,
)
from app.services.post_references import extract_batch, unknown_targets

logger = logging.getLogger(__name__)

#: Scheduler job id. Registered under the ordinary job machinery so that
#: enable/disable, manual trigger and last-run status all come for free — and so
#: "stop crawling" is durable server state rather than an env var and a redeploy.
DIRECTORY_HARVEST_JOB_ID = "directory_harvest"

#: One sweep at a time, for the reason `discover_probe._sweep_lock` is held:
#: APScheduler's `max_instances=1` covers the scheduled trigger but not
#: `POST /jobs/directory_harvest/trigger`, which calls the runner directly. Two
#: overlapping ticks would run two extraction walks over the same Posts and
#: both read the same unknown targets before either had queued them.
_sweep_lock = asyncio.Lock()


def is_harvest_running() -> bool:
    """Whether a sweep is in flight, answerable **from the API process**.

    Deliberately not `_sweep_lock.locked()`, which is the obvious implementation
    and is always `False` where this is called from. The lock is an
    `asyncio.Lock` in the process that runs the job, and the scheduler runs only
    in the worker (`app/worker.py`); the API answering
    `GET /data/discover/probe/queue` holds its own untouched copy of this module,
    so it would report "idle" throughout every live harvest.

    `lastStatus` crosses that boundary already: `_run_guarded` announces it over
    `SCHEDULER_STATUS_CHANNEL` and the API folds every announcement into
    `_job_status`, which is the same path `GET /jobs/status` reads. So the signal
    was there and only the wrong source was being consulted.

    The lock stays exactly where it is and keeps doing its own job, which is
    mutual exclusion inside the worker — `_harvest` still takes it directly.
    This function is the *report*, and a report has to answer in the process
    somebody asks it.
    """
    from app.jobs.scheduler import get_job_status

    status = get_job_status().get(DIRECTORY_HARVEST_JOB_ID) or {}
    return bool(status.get("lastStatus") == "running")


def _harvest(pending: int) -> dict[str, Any]:
    """Queue the Reference targets the Directory does not hold yet (DDS-02).

    **The budget is what is left under the ceiling**, not a setting of its own.
    `DIRECTORY_HARVEST_BACKLOG_CEILING` already names how deep the queue the
    probe lane drains may get; a separate batch size was a second number that
    could disagree with it, and on staging it did (1000 against a ceiling of
    600), so a tick starting at 599 pending ended at 1599. Derived, the two
    cannot be set into that disagreement.

    There are no marks and so nothing to lose. A target the budget did not
    reach is still unknown on the next tick, because the Reference that names
    it outlives this one.
    """
    batch = settings.DIRECTORY_HARVEST_BACKLOG_CEILING - pending
    with Session(engine) as session:
        fresh = unknown_targets(
            session,
            limit=batch,
            followed_sources_only=not settings.DIRECTORY_FOLLOW_SAMPLE_REFERENCES,
        )
        queued = enqueue_handles(session, fresh, priority=HARVEST_PRIORITY)
    return {"queued": queued}


def _pending() -> int:
    """Handles with no verdict yet — the backlog the probe lane has to chew."""
    with Session(engine) as session:
        counts = queue_counts(session)
        return counts["queued"] + counts["retrying"]


def _extract_references() -> dict[str, int]:
    """One reference-extraction walk (CRG-01).

    Part of this tick rather than a job of its own, because the enqueue reads
    what it writes: running it first is what puts a new Post's handles in the
    queue on the same tick, where a second scheduler entry would be a second
    interval to keep in step with this one.

    It is deliberately **not** gated on the probe backlog the way the harvest
    below is. That ceiling exists because the sweep's handles go into a queue
    something else has to drain; References go into a table nothing drains, so
    a deep probe backlog is no reason to stop filling the graph.
    """
    with Session(engine) as session:
        counts = extract_batch(session, limit=settings.POST_REFERENCE_SCAN_LIMIT)
    return {
        "referencesScanned": counts.scanned,
        "referencesWritten": counts.written,
        "referencesSkipped": counts.skipped,
        "referenceDeferringChannels": counts.deferring_channels,
    }


async def run_directory_harvest_sweep() -> dict[str, Any]:
    """Extract one batch of References and queue the targets nobody has seen.

    Returns a summary dict, which the scheduler surfaces as the job's `detail`.
    It reports what was **queued**, not what was found: the probe lane decides
    when a queued handle is actually fetched, and this function is finished long
    before any verdict is.

    Two steps share the tick. The reference-extraction walk (CRG-01) runs first
    and unconditionally, because the early return below is about the probe queue
    being full and that says nothing about the graph. The enqueue runs whether
    or not extraction succeeded, because the graph already holds References it
    can use: a sample's are written at probe time.
    """
    if _sweep_lock.locked():
        return {"skipped": True, "reason": "harvest already running"}

    async with _sweep_lock:
        try:
            references = await run_db(_extract_references)
        except Exception:
            # The two walks are independent, and this is what makes that true
            # rather than merely stated. Without it any fault in the newer of
            # the two — a lock timeout on its bulk UPDATE, a constraint
            # surprise, a settings row somebody hand-edited — would abort the
            # tick before the Directory harvest below ever ran, and the symptom
            # would be handles quietly not being queued any more.
            logger.exception("Reference extraction failed; harvest continues")
            references = {"referencesFailed": 1}

        # **Nothing is harvested while the queue is already deeper than the lane
        # can chew.** The two ends of this pipe are paced by different things:
        # the sweep adds on a timer, and the probe lane drains only when no sync
        # wants a Slot, behind a per-proxy wait that widens under pressure.
        # Nothing made those rates agree, so on a busy deployment the backlog
        # grew monotonically — and because every harvested row sorts ahead of
        # every `REFRESH_PRIORITY` row, ticket 03's staleness refresh would then
        # never be dequeued at all. Silently: the only signal is `refreshDue`
        # climbing.
        #
        # The ceiling is on the **backlog** rather than on the enqueue rate,
        # because the backlog is the thing that has to stay bounded and the
        # drain rate is not a number this process knows. Gating on it makes the
        # sweep self-limiting against however fast the lane actually goes, the
        # same shape as the probe sweep gating on its lane being empty.
        pending = await run_db(_pending)
        if pending >= settings.DIRECTORY_HARVEST_BACKLOG_CEILING:
            return {
                **references,
                "skipped": True,
                "reason": "probe backlog at the ceiling",
                "pending": pending,
            }

        found = await run_db(_harvest, pending)
        return {**references, **found, "pending": pending}
