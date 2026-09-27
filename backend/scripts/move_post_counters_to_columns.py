#!/usr/bin/env python3
"""Move each stored Post's View count and reaction chips into their columns (REACH-01).

    uv run python backend/scripts/move_post_counters_to_columns.py --dry-run
    uv run python backend/scripts/move_post_counters_to_columns.py
    python scripts/move_post_counters_to_columns.py --if-needed   # prestart.sh

Before ADR-024 a Post's `viewsCount` and `reactionCounts` lived in its media
JSON, beside the `reactionsCount` total. This copies the two counters into
`views_count` and `reaction_counts`, sets `views_observed_at` to the Post's
`retrieved_at` (exact, because nothing refreshed a Post before ADR-024), and
strips all three keys from media. A column already set is kept, because the
write path only sets one from a newer observation.

Since REACH-08 the readers use the columns only, so a deployment that has not
run this shows no View count or reaction chip on its older Posts, and an export
drops them. `prestart.sh` therefore runs it on every deploy with `--if-needed`
(REACH-10), so every deployment converges without an Operator step. A script
rather than the migration for ADR-023's reason: it rewrites the TOASTed media of
every Post. It walks `tg_posts` by primary key and commits per batch, so an
interrupted run resumes where it stopped and a re-run finds nothing to do.
Directory samples keep their counters in media and are not touched.

A run first asks whether any Post is pending at all, and walks only if one is.
That probe can only answer "none" by reading the whole table, 2.4s over 4.7M
Posts on a laptop, so a completed run records `POST_COUNTERS_MOVED_KEY` and
`--if-needed` returns on that one primary-key lookup from then on. Nothing
writes a pending Post any more (the write path strips the keys from media and
stamps the observation time), so the marker cannot go stale.
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
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import utc_now
from app.services.settings_registry import POST_COUNTERS_MOVED_KEY
from app.services.settings_store import get_global_setting, put_global_setting

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


def already_moved() -> bool:
    """Whether a completed run was recorded. One primary-key lookup."""
    with Session(engine) as session:
        return bool(get_global_setting(session, POST_COUNTERS_MOVED_KEY))


def _scalar(sql: str) -> Any:
    with engine.connect() as conn:
        return conn.execute(sa.text(sql)).scalar_one()


def _walk(batch_size: int) -> int:
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


def move(*, dry_run: bool, batch_size: int, if_needed: bool = False) -> int:
    """Posts still to move; moved unless `dry_run`.

    `if_needed` returns 0 once a completed run has been recorded. The marker is
    written only after the walk finishes, so the next deploy resumes an
    interrupted run rather than skipping it for ever.
    """
    if if_needed and already_moved():
        return 0
    if dry_run:
        return int(_scalar(f"SELECT count(*) FROM tg_posts WHERE {_PENDING}"))
    pending = _scalar(f"SELECT EXISTS (SELECT 1 FROM tg_posts WHERE {_PENDING})")
    moved = _walk(batch_size) if pending else 0
    with Session(engine) as session:
        put_global_setting(
            session,
            POST_COUNTERS_MOVED_KEY,
            {"movedAt": int(utc_now().timestamp() * 1000)},
        )
    return moved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument(
        "--if-needed",
        action="store_true",
        help="return at once if a completed run was recorded (prestart.sh)",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    count = move(
        dry_run=args.dry_run, batch_size=args.batch_size, if_needed=args.if_needed
    )
    prefix = "[dry-run] would move" if args.dry_run else "moved"
    logger.info("%s %d rows in tg_posts", prefix, count)


if __name__ == "__main__":
    main()
