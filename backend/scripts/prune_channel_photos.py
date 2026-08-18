#!/usr/bin/env python3
"""Delete cached channel avatars that no channel row references.

The scheduled sweep in `app.jobs.retention` does this on its own; this script is
for clearing a backlog on demand, or for seeing how big one is before it runs.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from sqlmodel import Session, select

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel
from app.services.channel_photos import (
    _photo_dir,
    _stem_of,
    photo_stem,
    prune_orphaned_photos,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delete cached channel avatars no channel references."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Report what would go, delete nothing."
    )
    parser.add_argument(
        "--max-age-days",
        type=int,
        default=settings.CHANNEL_PHOTO_ORPHAN_MAX_AGE_DAYS,
        help=(
            "Only prune orphans untouched for this long "
            f"(default {settings.CHANNEL_PHOTO_ORPHAN_MAX_AGE_DAYS}). Keep this "
            "above the Discover report window: a probed candidate is not a "
            "channel row yet, and a shorter floor strips avatars off reports "
            "still on screen."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.max_age_days <= 0:
        sys.stdout.write("--max-age-days must be > 0; nothing to do.\n")
        return 1

    with Session(engine) as session:
        keep = {photo_stem(cid) for cid in session.exec(select(Channel.id)).all()}

    directory = _photo_dir()
    cutoff = time.time() - args.max_age_days * 24 * 60 * 60
    with os.scandir(directory) as entries:
        files = [(e.name, e.stat().st_mtime) for e in entries if e.is_file()]

    orphans = [name for name, _ in files if _stem_of(name) not in keep]
    prunable = [
        name for name, mtime in files if _stem_of(name) not in keep and mtime < cutoff
    ]

    sys.stdout.write(
        f"{directory}\n"
        f"  files:            {len(files)}\n"
        f"  live channels:    {len(keep)}\n"
        f"  orphaned:         {len(orphans)}\n"
        f"  older than {args.max_age_days}d:  {len(prunable)}\n"
    )

    if args.dry_run:
        sys.stdout.write("Dry run: nothing deleted.\n")
        return 0

    removed = prune_orphaned_photos(keep, max_age_days=args.max_age_days)
    sys.stdout.write(f"Deleted {removed} files.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
