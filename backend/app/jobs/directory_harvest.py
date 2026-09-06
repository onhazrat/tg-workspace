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
(`DIRECTORY_HARVEST_BATCH_SIZE`) and nothing an Account waits on.

It also reaches Posts that were already stored, which an ingest hook by
construction never would.

## Two marks, because the walk has two jobs

Both are `Post.timestamp` positions in the `directory_runtime` settings row.

**`harvestTail` is the newest Post walked**, and moving it forward is how new
references are reached promptly. Ascending order makes that leg self-terminating:
once the mark passes the newest Post, the same query returns only what has
arrived since, so following the tail costs one empty indexed query per tick.

**`harvestCursor` is the backfill position in the history below that tail**, and
it wraps to the beginning when it gets there. It is not a fallback: a backward
sync stores Posts with *old* timestamps, which land below a mark that has
already passed them, so a walk that only moved forward would never see a handle
referenced in fetched history.

One mark doing both jobs was the first draft and it was wrong in both
directions. Reaching the end wrapped immediately, so the sweep was a perpetual
full-corpus rescan: on a small corpus every tick re-read everything and found
nothing, and on a large one a Post stored today waited a whole lap — days — to
be looked at. The tail leg is what makes new work prompt; the backfill leg is
what makes old work reachable; and they need separate budgets because only one
of them ever finishes.

## What it refuses to enqueue

Handles somebody follows, because sync already fetches those Channels' metadata
on every run and `record_sync_metadata` (ticket 03) writes it into the Directory
for free. Probing them here would be the same page fetched twice by two routes,
and the sync route is both cheaper and more frequent.

Handles the Directory already holds a row for, whatever the verdict. A pending
row is already queued and a conclusive one is already answered, so re-finding
either is not new work — and the batch has to count *new* handles or a stretch
of Posts referencing only known handles would exhaust it while throttling
nothing. The batch is checked between pages, so a tick can overshoot it by one
page's references; truncating instead would drop handles whose Posts the mark
has already moved past.

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
from app.jobs.settings import (
    HARVEST_START,
    load_harvest_state,
    save_harvest_state,
)
from app.services.async_db import run_db
from app.services.channel_directory import (
    HARVEST_PRIORITY,
    enqueue_handles,
    known_handles,
    queue_counts,
)
from app.services.discover import harvest_page
from app.services.follows import followed_channel_names

logger = logging.getLogger(__name__)

#: Scheduler job id. Registered under the ordinary job machinery so that
#: enable/disable, manual trigger and last-run status all come for free — and so
#: "stop crawling" is durable server state rather than an env var and a redeploy.
DIRECTORY_HARVEST_JOB_ID = "directory_harvest"

#: One sweep at a time, for the reason `discover_probe._sweep_lock` is held:
#: APScheduler's `max_instances=1` covers the scheduled trigger but not
#: `POST /jobs/directory_harvest/trigger`, which calls the runner directly. Two
#: overlapping ticks would read the same marks and harvest the same Posts.
_sweep_lock = asyncio.Lock()


def is_harvest_running() -> bool:
    return _sweep_lock.locked()


def _collect(tail: int, cursor: int) -> dict[str, Any]:
    """Walk from both marks until the batch is full or the scan budget is spent.

    **The tail leg first, and it gets the whole budget it can use.** New Posts
    are the reason the sweep runs often, so reaching them has to cost one
    indexed query in the steady state rather than a lap of the corpus. On a
    fresh install this leg *is* the initial backfill, because the tail starts
    before every Post.

    **Then the backfill leg, on a much smaller budget of its own.** It never
    finishes — it wraps and starts again — so its cost is paid on every tick for
    the life of the install, which is exactly the shape this repo has already
    had to unwind once. `DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT` is how small
    "forever" is allowed to be.

    One session for the whole walk, closed before anything is enqueued. Every
    read here is a plain indexed page and the session never spans awaited work,
    which is the rule an `idle in transaction` transaction pinning the xmin
    horizon is the cost of breaking.
    """
    batch = settings.DIRECTORY_HARVEST_BATCH_SIZE
    page_size = max(1, settings.DIRECTORY_HARVEST_PAGE_SIZE)

    fresh: dict[str, None] = {}
    scanned = 0

    with Session(engine) as session:
        # Read once for the whole walk, not once per page. It is a set of a few
        # thousand names at most, against pages of a hundred Posts — and the
        # alternative reads `tg_channels` several times a tick to answer the
        # same question with the same answer.
        followed = {name.lower() for name in followed_channel_names(session)}

        def _walk(start: int, budget: int, until: int | None) -> tuple[int, bool]:
            """Advance one leg. Returns `(position, reached the end)`.

            The batch is checked **between pages**, so a tick can overshoot it
            by one page's references. Truncating to the batch instead would
            silently drop handles whose Posts the mark has already moved past,
            and they would not come back until the next full lap — trading a
            bounded overshoot for unbounded loss.
            """
            nonlocal scanned
            position = start
            while budget > 0 and len(fresh) < batch:
                page = harvest_page(
                    session, after=position, limit=min(page_size, budget), until=until
                )
                if page.cursor is None:
                    return position, True
                scanned += page.scanned
                budget -= page.scanned
                position = page.cursor

                candidates = [
                    handle
                    for handle in page.handles
                    if handle not in followed and handle not in fresh
                ]
                if not candidates:
                    continue
                # One membership query per page, never one per handle. A page
                # can reference a couple of hundred handles, and asking about
                # them one at a time is the "compute it for everything, read one
                # field" shape from the other direction — a round trip per
                # answer.
                known = known_handles(session, set(candidates))
                for handle in candidates:
                    if handle not in known:
                        fresh.setdefault(handle, None)
            return position, False

        tail, _ = _walk(tail, settings.DIRECTORY_HARVEST_SCAN_LIMIT, None)

        # **Its own budget, not the tail leg's leftovers.** Leftovers were the
        # first spelling and they starve it: on a deployment where new Posts
        # keep exhausting the tail budget the backfill would never run at all,
        # so a handle referenced only in fetched history would never be seen.
        # They also made `until` unreachable — the tail leg always caught up
        # before the backfill got a turn, so the tail was always the newest Post
        # and bounding by it was a no-op nothing could observe.
        #
        # A tick therefore costs at most `SCAN_LIMIT + BACKFILL_SCAN_LIMIT`
        # Posts, which is the number to read as the sweep's price.
        cursor, reached_tail = _walk(
            cursor, settings.DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT, tail
        )
        wrapped = reached_tail
        if reached_tail:
            # The history below the tail is fully walked. Start again from
            # before the first Post rather than parking here, because a backward
            # sync keeps adding to that history and a mark that only moved
            # forward would never see any of it.
            cursor = HARVEST_START

    return {
        "handles": list(fresh),
        "tail": tail,
        "cursor": cursor,
        "scanned": scanned,
        "wrapped": wrapped,
    }


def _enqueue(handles: list[str], *, tail: int, cursor: int) -> int:
    """Queue the batch and record where both legs stopped, in one session.

    The marks are saved whether or not anything was enqueued, because a tick
    that read five hundred Posts referencing nothing new still made progress —
    not saving them would make the sweep re-read that stretch on every tick for
    ever, which is the shape of a job that costs the same every tick and
    achieves nothing.
    """
    with Session(engine) as session:
        queued = enqueue_handles(session, handles, priority=HARVEST_PRIORITY)
        save_harvest_state(session, tail=tail, cursor=cursor)
        return queued


def _state() -> tuple[int, int]:
    with Session(engine) as session:
        return load_harvest_state(session)


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

        tail, cursor = await run_db(_state)
        found = await run_db(_collect, tail, cursor)
        handles: list[str] = found["handles"]
        queued = await run_db(
            _enqueue, handles, tail=found["tail"], cursor=found["cursor"]
        )
        return {
            "queued": queued,
            "scanned": found["scanned"],
            "tail": found["tail"],
            "cursor": found["cursor"],
            "wrapped": found["wrapped"],
            "pending": pending,
        }
