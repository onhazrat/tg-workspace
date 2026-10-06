#!/usr/bin/env python3
"""Fill the Directory's search index, or re-index rows an older recipe built (DIR-04).

    uv run python backend/scripts/backfill_directory_search.py --dry-run
    uv run python backend/scripts/backfill_directory_search.py

The migration creates `tg_channel_directory_search` empty; every writer keeps
it current after that, so this runs once after the deploy that carries DIR-04,
and again whenever `channel_directory.SEARCH_INDEX_VERSION` is raised. It
indexes each listed entry with no document or an older one, walks by handle
and commits per batch, so an interrupted run resumes where it stopped and a
re-run changes nothing. It is safe beside a live deployment: a writer that
rebuilds a row in between leaves it current, and the walk skips it.

`--dry-run` reports how many entries would be indexed.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session

from app.core.db import engine
from app.services.channel_directory import SEARCH_BATCH, index_stale_for_search

logger = logging.getLogger("backfill_directory_search")


def backfill(*, dry_run: bool, batch_size: int) -> int:
    """Entries indexed; written unless `dry_run`."""
    indexed = 0
    after = ""
    started = time.monotonic()
    with Session(engine) as session:
        while handles := index_stale_for_search(session, after=after, limit=batch_size):
            after = handles[-1]
            indexed += len(handles)
            if dry_run:
                session.rollback()
            else:
                session.commit()
            logger.info(
                "tg_channel_directory_search: %d indexed, %.0fs",
                indexed,
                time.monotonic() - started,
            )
    return indexed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=SEARCH_BATCH)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    count = backfill(dry_run=args.dry_run, batch_size=args.batch_size)
    prefix = "[dry-run] would index" if args.dry_run else "indexed"
    logger.info("%s %d Directory entries", prefix, count)


if __name__ == "__main__":
    main()
