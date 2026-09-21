#!/usr/bin/env python3
"""Fill the channel reference graph from the corpus already stored (CRG-04).

    uv run python backend/scripts/backfill_post_references.py --dry-run
    uv run python backend/scripts/backfill_post_references.py

**Dry run first, against the real database, and read the counts before
anything else.** A large `deferred` means a population of Channels with no
chat id, which is a finding rather than a script problem: work out which
Channels those are before the grace clock runs down on them, because past the
grace their Posts are skipped for good. `deferringChannels` is that list's
length.

## Why a script rather than a migration or the sweep

Migrations run at prestart with the service down, and a bulk pass over roughly
4.7 million Posts there stalls a deploy for an unknown number of minutes with
nothing reporting progress. Letting the sweep catch up instead takes about a
month: at the shipped scan limit and tick interval it moves on the order of a
hundred thousand Posts a day. The sweep is the right steady-state mechanism
and the wrong catch-up mechanism.

## Stop the worker first, or expect the two walks to fight

`jobs/directory_harvest._extract_references` calls the same `extract_batch`,
over the same pending set, in the same newest-first order, every harvest tick.
Nothing here is incorrect if both run — the uniqueness constraint absorbs the
overlap and each walk marks what it read — but the two re-extract each other's
Posts for nothing and then contend on the `UPDATE`, and whichever commits
second waits out the other's whole batch. At this batch size that stalls the
Directory harvest tick, not just its extraction half.

## It carries no logic of its own

The walk, the extraction, the grace rule and the conflict handling all live in
`services/post_references.py`; this is a loop around `extract_batch` and
nothing else. A backfill holding its own copy of that logic is one that can
disagree with steady state, and the disagreement surfaces months later as a
graph nobody trusts.

`extract_batch` commits per call, so an interrupted run resumes from where it
stopped: the Posts it already marked are no longer selected, and the ones it
had not reached still are. A re-run is safe by construction for the same
reason, with the table's `NULLS NOT DISTINCT` uniqueness absorbing any overlap.

One `Session` per batch rather than one for the run. `extract_batch` loads a
whole page of Posts with their text, and a session held across the loop would
keep every page of them in its identity map — the walk inside
`directory_harvest` calls `expunge_all` between pages for exactly this reason.
A fresh session per batch is the same bound with nothing to remember.
"""

from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session

from app.core.db import engine
from app.services.post_references import extract_batch, pending_counts

logger = logging.getLogger("backfill_post_references")

#: Larger than the sweep's `POST_REFERENCE_SCAN_LIMIT`, which is sized for a
#: tick that shares its interval with the Directory harvest. Nothing shares
#: this run, so the batch is sized by the memory one page of Posts costs.
#:
#: It is **not** bounded by how many References the page yields:
#: `write_references` chunks its own `INSERT` under the wire protocol's bind
#: parameter ceiling, so a batch of unusually link-heavy Posts costs another
#: statement rather than an aborted run.
DEFAULT_BATCH_SIZE = 5_000


@dataclass
class Totals:
    """The run so far.

    `deferring_channels` is a **gauge, not a sum**: every batch reports the
    Channels currently holding a Post back, so adding them up would count the
    same Channel once per batch. It is therefore taken from the call that ends
    the loop — the one reading made after everything the run could mark has
    been marked, so a Channel that only looked stuck has already dropped out
    of it.
    """

    batches: int = 0
    scanned: int = 0
    written: int = 0
    skipped: int = 0
    deferring_channels: int = 0


def backfill(*, dry_run: bool, batch_size: int) -> Totals:
    """Loop `extract_batch` until it finds nothing left to read."""
    if dry_run:
        with Session(engine) as session:
            counts = pending_counts(session)
        logger.info(
            "[dry-run] pending=%d eligible=%d deferred=%d deferringChannels=%d",
            counts.pending,
            counts.eligible,
            counts.deferred,
            counts.deferring_channels,
        )
        # Only the gauge crosses over. `scanned`, `written` and `skipped` stay
        # zero because a dry run has no honest value for them: its `deferred`
        # is Posts the walk would **not read at all**, while the run's
        # `skipped` is Posts it read and gave up on — disjoint populations
        # under one name. An operator who saw `skipped=40000` here and
        # `skipped=120` after the real run would reasonably conclude the run
        # had lost forty thousand Posts. The dry run's numbers are on the line
        # above, which labels each of them.
        return Totals(deferring_channels=counts.deferring_channels)

    totals = Totals()
    while True:
        with Session(engine) as session:
            batch = extract_batch(session, limit=batch_size)
        # `scanned` is the loop's only termination condition, and it is the
        # right one: a page made entirely of out-of-grace Posts still counts
        # as scanned and is still marked, so the walk cannot stall on it.
        if batch.scanned == 0:
            totals.deferring_channels = batch.deferring_channels
            break
        totals.batches += 1
        totals.scanned += batch.scanned
        totals.written += batch.written
        totals.skipped += batch.skipped
        logger.info(
            "batch %d: scanned=%d written=%d skipped=%d deferringChannels=%d",
            totals.batches,
            batch.scanned,
            batch.written,
            batch.skipped,
            batch.deferring_channels,
        )

    logger.info(
        "done: batches=%d scanned=%d written=%d skipped=%d deferringChannels=%d",
        totals.batches,
        totals.scanned,
        totals.written,
        totals.skipped,
        totals.deferring_channels,
    )
    return totals


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what the run would read and defer, without writing.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Posts per transaction (default {DEFAULT_BATCH_SIZE}).",
    )
    args = parser.parse_args()
    if args.batch_size <= 0:
        parser.error("--batch-size must be positive")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    backfill(dry_run=args.dry_run, batch_size=args.batch_size)


if __name__ == "__main__":
    main()
