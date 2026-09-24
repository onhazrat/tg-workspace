#!/usr/bin/env python3
"""Drop the `views` and `reactions` display strings from stored media (ADR-023).

    uv run python backend/scripts/strip_media_display_counters.py --dry-run
    uv run python backend/scripts/strip_media_display_counters.py

Post media used to carry each count twice: Telegram's text (`"views": "3.86K"`,
`"reactions": "🔥 25 👍 3"`) and the number (`viewsCount`, `reactionCounts`).
New rows carry only the numbers. Nothing reads the strings any more, so a row
this has not reached yet is correct, just larger; the script is housekeeping
and can run at any time after the deploy.

A script rather than the migration because it rewrites about 1.1 million
TOASTed JSON values on staging, which inside prestart would hold the deploy for
an unknown time with nothing reporting progress. It walks each table by primary
key and commits per batch, so an interrupted run resumes where it stopped and a
re-run finds nothing to do.
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

logger = logging.getLogger("strip_media_display_counters")

DEFAULT_BATCH_SIZE = 5_000

_HAS_STRINGS = (
    "media IS NOT NULL AND json_typeof(media) = 'object' "
    "AND media::jsonb ?| array['views', 'reactions']"
)

#: Table -> its primary key columns, walked in order.
MEDIA_TABLES: dict[str, tuple[str, ...]] = {
    "tg_posts": ("id",),
    "tg_channel_directory_samples": ("handle", "post_id"),
}

#: A Summary keeps copies of the Posts it cited, media included. 16 rows on
#: staging, so one statement.
_CITED_HAS_STRINGS = """
json_typeof(cited_posts) = 'array'
AND jsonb_path_exists(
    cited_posts::jsonb, '$[*].media ? (exists(@.views) || exists(@.reactions))'
)
"""
_CITED_POSTS = f"""
UPDATE tg_summary_payloads SET cited_posts = (
    SELECT json_agg(
        CASE WHEN jsonb_typeof(e -> 'media') = 'object'
            THEN jsonb_set(e, '{{media}}', (e -> 'media') - 'views' - 'reactions')
            ELSE e END
        ORDER BY ord)
    FROM jsonb_array_elements(cited_posts::jsonb) WITH ORDINALITY AS x(e, ord)
)
WHERE {_CITED_HAS_STRINGS}"""


def _strip_table(table: str, keys: tuple[str, ...], batch_size: int) -> int:
    key_list = ", ".join(keys)
    after = ", ".join(f":k{i}" for i in range(len(keys)))
    changed = 0
    last: tuple[Any, ...] | None = None
    while True:
        walk = f"WHERE ({key_list}) > ({after})" if last is not None else ""
        params: dict[str, Any] = {f"k{i}": v for i, v in enumerate(last or ())}
        with engine.begin() as conn:
            batch = conn.execute(
                sa.text(
                    f"SELECT {key_list} FROM {table} {walk} "
                    f"ORDER BY {key_list} LIMIT :n"
                ),
                {**params, "n": batch_size},
            ).all()
            if not batch:
                return changed
            last = tuple(batch[-1])
            bounds = {f"k{i}": v for i, v in enumerate(batch[0])}
            bounds |= {f"e{i}": v for i, v in enumerate(last)}
            lo = ", ".join(f":k{i}" for i in range(len(keys)))
            hi = ", ".join(f":e{i}" for i in range(len(keys)))
            changed += conn.execute(
                sa.text(
                    f"UPDATE {table} SET media = "
                    "(media::jsonb - 'views' - 'reactions')::json "
                    f"WHERE ({key_list}) BETWEEN ({lo}) AND ({hi}) AND {_HAS_STRINGS}"
                ),
                bounds,
            ).rowcount
        logger.info("%s: %d rows stripped so far", table, changed)


def strip(*, dry_run: bool, batch_size: int) -> dict[str, int]:
    """Rows holding a display string per table; stripped unless `dry_run`."""
    if dry_run:
        with engine.connect() as conn:
            counts = {
                table: conn.execute(
                    sa.text(f"SELECT count(*) FROM {table} WHERE {_HAS_STRINGS}")
                ).scalar_one()
                for table in MEDIA_TABLES
            }
            counts["tg_summary_payloads"] = conn.execute(
                sa.text(
                    f"SELECT count(*) FROM tg_summary_payloads WHERE {_CITED_HAS_STRINGS}"
                )
            ).scalar_one()
        return counts
    counts = {
        table: _strip_table(table, keys, batch_size)
        for table, keys in MEDIA_TABLES.items()
    }
    with engine.begin() as conn:
        counts["tg_summary_payloads"] = conn.execute(sa.text(_CITED_POSTS)).rowcount
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    counts = strip(dry_run=args.dry_run, batch_size=args.batch_size)
    prefix = "[dry-run] would strip" if args.dry_run else "stripped"
    for table, count in counts.items():
        logger.info("%s %d rows in %s", prefix, count, table)


if __name__ == "__main__":
    main()
