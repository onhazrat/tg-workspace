"""The harvest sweep: handles enter the Directory on their own (ticket 04, IDEA-011 D16).

Before this, the deployment only ever looked at handles somebody's Discovery
report had named. Everything else a Post referenced — every forward, every
mention, every `t.me` link — stayed invisible until an Account happened to run a
scan over the right Scope, so "what Channels do we know exist" had no answer
that did not depend on who had been clicking.

This walks the stored Posts instead and puts what they reference into the
Directory queue. The extraction is `discover.post_references`, the same function
a report uses, so a forward is a forward here and there; the sweep changes who
asks, not what counts.

## A sweep, not a write on the sync path

Extracting at ingest was the obvious alternative and is the wrong shape twice
over. It would put handle extraction and a Directory write inside the walk an
Account is waiting on, and it would leave the deployment with no throttle at
all — the rate of new handles would be the rate of new Posts, which is not a
number anybody chose. As a sweep there is one place to turn down
(`DIRECTORY_HARVEST_SCAN_LIMIT`) and nothing an Account waits on.

It also reaches Posts that were already stored, which an ingest hook by
construction never would.

## The Post carries whether it has been looked at

`Post.harvested`, and the walk is `WHERE NOT harvested ORDER BY timestamp DESC`
(ticket 05). There is no mark, no cursor and no state in the settings row.

Ticket 04 kept two `Post.timestamp` marks: a tail for new Posts and a wrapping
backfill for the history below it, because a *backward* sync stores Posts with
old timestamps that land beneath a mark which has already passed them. A flag
answers that by construction — an unprocessed Post is unprocessed whenever it
arrived — so the second mark, the wrap, the `until` bound, the separate budget
and the permanent re-lap all went away together.

Newest first, so a Post stored a moment ago is at the front of the unprocessed
set and reaches the Directory on the next tick even while a large backlog is
still draining behind it. That is the property the tail leg existed to buy, and
here one query has it. The partial index `(timestamp DESC) WHERE NOT harvested`
serves it and shrinks toward empty as the corpus is processed, so a caught-up
tick reads nothing and scans an index that holds nothing.

The rows are marked in the same transaction that enqueues their handles. A tick
that dies between the two re-reads those Posts next time rather than losing
their handles for ever.

## What it refuses to enqueue

Handles somebody follows, because sync already fetches those Channels' metadata
on every run and `record_sync_metadata` (ticket 03) writes it into the Directory
for free. Probing them here would be the same page fetched twice by two routes,
and the sync route is both cheaper and more frequent.

Handles the Directory already holds a row for, whatever the verdict. A pending
row is already queued and a conclusive one is already answered, so re-finding
either is not new work — and the budget has to count *new* handles or a stretch
of Posts referencing only known handles would exhaust it while throttling
nothing.

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
    known_handles,
    queue_counts,
)
from app.services.discover import harvest_page
from app.services.follows import followed_channel_names
from app.services.posts import mark_harvested

logger = logging.getLogger(__name__)

#: Posts held in memory at once, which with the per-page expunge in `_harvest`
#: is the memory bound on the whole tick rather than on one query. A constant
#: rather than a setting: it is an implementation fact about how large a page
#: of TOAST-heavy rows may get, and nobody has ever needed to tune it apart
#: from the scan limit.
_PAGE_SIZE = 100

#: Scheduler job id. Registered under the ordinary job machinery so that
#: enable/disable, manual trigger and last-run status all come for free — and so
#: "stop crawling" is durable server state rather than an env var and a redeploy.
DIRECTORY_HARVEST_JOB_ID = "directory_harvest"

#: One sweep at a time, for the reason `discover_probe._sweep_lock` is held:
#: APScheduler's `max_instances=1` covers the scheduled trigger but not
#: `POST /jobs/directory_harvest/trigger`, which calls the runner directly. Two
#: overlapping ticks would read the same unharvested Posts and harvest them
#: twice — the marks are only visible to each other once committed.
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
    """Walk the unharvested Posts, mark them, and queue what they reference.

    **The budget is what is left under the ceiling**, not a setting of its own.
    `DIRECTORY_HARVEST_BACKLOG_CEILING` already names how deep the queue the
    probe lane drains may get; a separate `BATCH_SIZE` was a second number that
    could disagree with it, and on staging it did — 1000 against a ceiling of
    600 checked *before* the walk, so a tick starting at 599 pending ended at
    1599 and overshot by 2.6x the bound that exists to stop ticket 03's refresh
    starving. Derived, the two cannot be set into that disagreement.

    It still overshoots by up to one page's references, because the budget is
    checked **between** pages — ticket 04's behaviour, unchanged. Truncating a
    page to the budget would be worse now than it was then: the Posts in it are
    marked in this same transaction, so a dropped handle is not deferred to the
    next lap, it is gone. A bounded overshoot of `_PAGE_SIZE` Posts' worth of
    handles is the price of that, against a ceiling two orders larger.

    `DIRECTORY_HARVEST_SCAN_LIMIT` is the other half and has to exist
    separately: once the corpus is harvested almost every Post references only
    known handles, so a tick chasing new ones would walk the whole table before
    giving up.

    **One session and one transaction for the walk, the marks and the
    enqueue.** Marking inside the transaction is also what lets the loop make
    progress — the walk has no cursor, so the next page is only a different page
    because the previous one is no longer unharvested. Committing them together
    is what makes a tick that dies mid-walk re-read those Posts rather than lose
    their handles. Every read here is a plain indexed page and the session never
    spans awaited work, which is the rule an `idle in transaction` transaction
    pinning the xmin horizon is the cost of breaking.
    """
    batch = settings.DIRECTORY_HARVEST_BACKLOG_CEILING - pending
    budget = settings.DIRECTORY_HARVEST_SCAN_LIMIT

    fresh: dict[str, None] = {}
    scanned = 0

    with Session(engine) as session:
        # Read once for the whole walk, not once per page. It is a set of a few
        # thousand names at most, against pages of a hundred Posts — and the
        # alternative reads `tg_channels` several times a tick to answer the
        # same question with the same answer.
        followed = {name.lower() for name in followed_channel_names(session)}

        while budget > 0 and len(fresh) < batch:
            page = harvest_page(session, limit=min(_PAGE_SIZE, budget))
            if not page.post_ids:
                break
            mark_harvested(session, page.post_ids)
            # The page is finished with: `harvest_page` already extracted
            # its references and the mark went by primary key. Without this
            # every Post the tick reads stays in the identity map until the
            # commit, so `_PAGE_SIZE` would bound one query and nothing
            # would bound the tick — at a scan limit of 20,000 that is
            # 20,000 fully loaded Posts, `text` included, held at once.
            session.expunge_all()
            scanned += len(page.post_ids)
            budget -= len(page.post_ids)

            candidates = [
                handle
                for handle in page.handles
                if handle not in followed and handle not in fresh
            ]
            if not candidates:
                continue
            # One membership query per page, never one per handle. A page can
            # reference a couple of hundred handles, and asking about them one
            # at a time is the "compute it for everything, read one field"
            # shape from the other direction — a round trip per answer.
            known = known_handles(session, set(candidates))
            for handle in candidates:
                if handle not in known:
                    fresh.setdefault(handle, None)

        queued = enqueue_handles(session, list(fresh), priority=HARVEST_PRIORITY)
        # `enqueue_handles` commits, but returns early without doing so when it
        # was handed nothing. A tick that read five hundred Posts referencing
        # nothing new still did the work, and leaving those marks uncommitted
        # would make the sweep re-read that stretch on every tick for ever.
        session.commit()

    return {"queued": queued, "scanned": scanned}


def _pending() -> int:
    """Handles with no verdict yet — the backlog the probe lane has to chew."""
    with Session(engine) as session:
        counts = queue_counts(session)
        return counts["queued"] + counts["retrying"]


async def run_directory_harvest_sweep() -> dict[str, Any]:
    """Walk one batch of stored Posts and queue the handles they reference.

    Returns a summary dict, which the scheduler surfaces as the job's `detail`.
    It reports what was **queued**, not what was found: the probe lane decides
    when a queued handle is actually fetched, and this function is finished long
    before any verdict is.
    """
    if _sweep_lock.locked():
        return {"skipped": True, "reason": "harvest already running"}

    async with _sweep_lock:
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
                "skipped": True,
                "reason": "probe backlog at the ceiling",
                "pending": pending,
            }

        found = await run_db(_harvest, pending)
        return {**found, "pending": pending}
