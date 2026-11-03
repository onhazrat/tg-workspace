#!/usr/bin/env python3
"""Catch the Directory up with ADR-048: Bio languages, and the profiles HKD-01 dropped.

    uv run python backend/scripts/backfill_bio_language.py --dry-run
    uv run python backend/scripts/backfill_bio_language.py

Two steps, run once after PRF-01 deploys:

1. Every readable Channel (`status = 'ok'`) with no Bio language gets the one
   its stored Bio says, read by the Language rule, with No words for an empty
   Bio: a readable Channel's page always carried its Bio, so an empty one was
   read. Sends no Request.
2. Every group, bot, user and Hidden Channel with no Bio language is Rechecked,
   one Request each, because before PRF-01 its page's Bio and photo were thrown
   away. Every probe since writes a Bio language for these kinds, so an unset
   one means the profile was never read, and a Rechecked entry is `unknown`
   until its answer arrives: a second run selects nothing. Entries of kind
   `unknown` are never selected (ADR-047 deferred them).

Walks by key and commits per batch, so an interrupted run resumes. `--dry-run`
reports both counts and changes nothing.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from sqlalchemy import ColumnElement, or_
from sqlmodel import Session, col, func, select

from app.core.db import engine
from app.models_tg import DirectoryEntry
from app.services.channel_directory import requeue_probes
from app.services.language import read_language

logger = logging.getLogger("backfill_bio_language")

DEFAULT_BATCH_SIZE = 500


def _unread(*where: ColumnElement[bool]) -> list[ColumnElement[bool]]:
    return [col(DirectoryEntry.bio_language).is_(None), *where]


_READABLE = _unread(col(DirectoryEntry.status) == "ok")
_DROPPED = _unread(
    or_(
        col(DirectoryEntry.kind).in_(("group", "bot", "user")),
        col(DirectoryEntry.status) == "hidden",
    )
)


def _count(session: Session, where: list[ColumnElement[bool]]) -> int:
    return session.exec(select(func.count()).where(*where)).one()


def _read_bios(session: Session, batch_size: int) -> int:
    read = 0
    after = ""
    while entries := list(
        session.exec(
            select(DirectoryEntry)
            .where(*_READABLE, col(DirectoryEntry.handle) > after)
            .order_by(col(DirectoryEntry.handle))
            .limit(batch_size)
        ).all()
    ):
        after = entries[-1].handle
        for entry in entries:
            entry.bio_language = read_language(entry.bio)
            session.add(entry)
        read += len(entries)
        session.commit()
        logger.info("Bio languages read so far: %d", read)
    return read


def _recheck(session: Session, batch_size: int) -> int:
    rechecked = 0
    after = ""
    while handles := list(
        session.exec(
            select(DirectoryEntry.handle)
            .where(*_DROPPED, col(DirectoryEntry.handle) > after)
            .order_by(col(DirectoryEntry.handle))
            .limit(batch_size)
        ).all()
    ):
        after = handles[-1]
        rechecked += len(requeue_probes(session, handles))
        logger.info("Rechecked so far: %d", rechecked)
    return rechecked


def backfill(*, dry_run: bool, batch_size: int) -> tuple[int, int]:
    """Bio languages read and entries Rechecked; counted only when `dry_run`."""
    with Session(engine) as session:
        if dry_run:
            return _count(session, _READABLE), _count(session, _DROPPED)
        return _read_bios(session, batch_size), _recheck(session, batch_size)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    read, rechecked = backfill(dry_run=args.dry_run, batch_size=args.batch_size)
    prefix = "[dry-run] would read" if args.dry_run else "read"
    logger.info(
        "%s %d Bio languages and Recheck %d entries (one Request each)",
        prefix,
        read,
        rechecked,
    )


if __name__ == "__main__":
    main()
