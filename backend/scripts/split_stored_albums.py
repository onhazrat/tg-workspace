#!/usr/bin/env python3
"""Split the Albums stored as one Post before ALB-01 into their Posts (ALB-02).

    uv run python backend/scripts/split_stored_albums.py --dry-run
    uv run python backend/scripts/split_stored_albums.py

The dry run counts the Albums within retention still stored as one Post and
fetches nothing. The run re-walks the pages holding them through the sync's
own page fetch, charged to a follower's auto-sync Budget (the Operator's
when they follow the Channel) and held to a sync's limits: the ceiling, the
Channel's sync claim and the page cap per run. It reports how many Albums it
split and how many it left as one Post: the page failed, no longer shows the
whole Album with its thumbnails, or a limit stopped the walk. Channels nobody
follows are not walked; retention removes them. A disabled auto Request kind
refuses the run before any page.

It is resumable and idempotent: a split Album carries its membership and is
no longer selected, so a second run walks only what the first one left. The
walk lives in `services/sync_orchestrator.split_stored_albums`; this is the
command line around it.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from app.core.request_recording import RequestKindDisabled
from app.services.sync_orchestrator import split_stored_albums

logger = logging.getLogger("split_stored_albums")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count the Albums to split, without fetching or writing.",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    try:
        report = asyncio.run(split_stored_albums(dry_run=args.dry_run))
    except RequestKindDisabled as exc:
        logger.error("refused: %s", exc)
        sys.exit(1)
    logger.info(
        "%salbums=%d split=%d left=%d",
        "[dry-run] " if args.dry_run else "",
        report.albums,
        report.split,
        report.left,
    )


if __name__ == "__main__":
    main()
