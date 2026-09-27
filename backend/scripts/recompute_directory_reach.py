#!/usr/bin/env python3
"""Recompute every Directory entry's Reach from its stored samples (REACH-04).

    uv run python backend/scripts/recompute_directory_reach.py --dry-run
    uv run python backend/scripts/recompute_directory_reach.py

REACH-04's migration renamed `median_views` to `reach`, so until this runs an
entry still holds the old median of hours-old View counts. This applies the new
rule (`services/reach.py`) to each entry's stored samples, aging each sample
from the moment its probe captured it, under the Reach settings in force now.

An entry that is not `ok` gets no Reach. That is every `unavailable` entry: its
samples were cleared with the verdict, so its old median cannot be recomputed,
and keeping it would show the old definition beside the new one. A read of a
Channel somebody follows answers from its Posts regardless.

Walks `tg_channel_directory` by handle and commits per batch, so an interrupted
run resumes where it stopped and a re-run changes nothing. `--dry-run` reports
how many entries would change.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from datetime import UTC
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session, col, select

from app.core.db import engine
from app.jobs.settings import load_reach_settings
from app.models_tg import DirectoryEntry, DirectorySample
from app.services.reach import Reach, ReachSettings, reach_settings_from, sample_reach

logger = logging.getLogger("recompute_directory_reach")

DEFAULT_BATCH_SIZE = 500


def _reach(
    entry: DirectoryEntry, samples: list[DirectorySample], settings: ReachSettings
) -> Reach:
    if entry.status != "ok" or not samples:
        return Reach()
    probed_at = samples[0].captured_at.replace(tzinfo=UTC)
    return sample_reach(samples, int(probed_at.timestamp() * 1000), settings)


def _batch(session: Session, after: str, size: int) -> list[DirectoryEntry]:
    return list(
        session.exec(
            select(DirectoryEntry)
            .where(col(DirectoryEntry.handle) > after)
            .order_by(col(DirectoryEntry.handle))
            .limit(size)
        ).all()
    )


def recompute(*, dry_run: bool, batch_size: int) -> int:
    """Entries whose Reach changes; written unless `dry_run`."""
    changed = 0
    after = ""
    with Session(engine) as session:
        settings = reach_settings_from(load_reach_settings(session))
        while entries := _batch(session, after, batch_size):
            after = entries[-1].handle
            samples: dict[str, list[DirectorySample]] = defaultdict(list)
            for sample in session.exec(
                select(DirectorySample).where(
                    col(DirectorySample.handle).in_([e.handle for e in entries])
                )
            ):
                samples[sample.handle].append(sample)
            for entry in entries:
                reach = _reach(entry, samples[entry.handle], settings)
                if (entry.reach, entry.reach_estimated) == (
                    reach.value,
                    reach.estimated,
                ):
                    continue
                changed += 1
                entry.reach = reach.value
                entry.reach_estimated = reach.estimated
                session.add(entry)
            if dry_run:
                session.rollback()
            else:
                session.commit()
            logger.info("tg_channel_directory: %d entries changed so far", changed)
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    count = recompute(dry_run=args.dry_run, batch_size=args.batch_size)
    prefix = "[dry-run] would change" if args.dry_run else "changed"
    logger.info("%s Reach on %d Directory entries", prefix, count)


if __name__ == "__main__":
    main()
