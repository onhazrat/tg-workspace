#!/usr/bin/env python3
"""Move each stored Post's View count and reaction chips into their columns (REACH-01).

    uv run python backend/scripts/move_post_counters_to_columns.py --dry-run
    uv run python backend/scripts/move_post_counters_to_columns.py

Before ADR-024 a Post's `viewsCount` and `reactionCounts` lived in its media
JSON, beside the `reactionsCount` total. This copies the two counters into
`views_count` and `reaction_counts`, sets `views_observed_at` to the Post's
`retrieved_at` (exact, because nothing refreshed a Post before ADR-024), and
strips all three keys from media. A column already set is kept, because the
write path only sets one from a newer observation.

Until this has run the readers fall back to the media keys, so it can run at
any time after the deploy. A script rather than the migration for ADR-023's
reason: it rewrites the TOASTed media of every Post. It walks `tg_posts` by
primary key and commits per batch, so an interrupted run resumes where it
stopped and a re-run finds nothing to do. Directory samples keep their
counters in media and are not touched.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

import sqlalchemy as sa

from app.core.db import engine

logger = logging.getLogger("move_post_counters_to_columns")

DEFAULT_BATCH_SIZE = 5_000

_PENDING = (
    "((views_observed_at IS NULL AND retrieved_at IS NOT NULL) "
    "OR (media IS NOT NULL AND json_typeof(media) = 'object' "
    "AND media::jsonb ?| array['viewsCount', 'reactionCounts', 'reactionsCount']))"
)

_MOVE = f"""
UPDATE tg_posts SET
    views_count = COALESCE(views_count, CASE
        WHEN json_typeof(media) = 'object'
         AND json_typeof(media -> 'viewsCount') = 'number'
        THEN (media ->> 'viewsCount')::numeric::integer END),
    reaction_counts = COALESCE(reaction_counts, CASE
        WHEN json_typeof(media) = 'object'
         AND json_typeof(media -> 'reactionCounts') = 'array'
        THEN (media -> 'reactionCounts')::jsonb END),
    views_observed_at = COALESCE(views_observed_at, retrieved_at),
    media = CASE WHEN json_typeof(media) = 'object'
        THEN (media::jsonb - 'viewsCount' - 'reactionCounts' - 'reactionsCount')::json
        ELSE media END
WHERE id BETWEEN :lo AND :hi AND {_PENDING}
"""


def move(*, dry_run: bool, batch_size: int) -> int:
    """Posts still to move; moved unless `dry_run`."""
    if dry_run:
        with engine.connect() as conn:
            return int(
                conn.execute(
                    sa.text(f"SELECT count(*) FROM tg_posts WHERE {_PENDING}")
                ).scalar_one()
            )
    moved = 0
    last: Any = None
    while True:
        walk = "WHERE id > :last" if last is not None else ""
        with engine.begin() as conn:
            ids = (
                conn.execute(
                    sa.text(f"SELECT id FROM tg_posts {walk} ORDER BY id LIMIT :n"),
                    {"last": last, "n": batch_size},
                )
                .scalars()
                .all()
            )
            if not ids:
                return moved
            last = ids[-1]
            moved += conn.execute(sa.text(_MOVE), {"lo": ids[0], "hi": last}).rowcount
        logger.info("tg_posts: %d rows moved so far", moved)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    count = move(dry_run=args.dry_run, batch_size=args.batch_size)
    prefix = "[dry-run] would move" if args.dry_run else "moved"
    logger.info("%s %d rows in tg_posts", prefix, count)


if __name__ == "__main__":
    main()
