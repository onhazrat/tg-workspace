#!/usr/bin/env python3
"""Relabel Channels and Directory entries the old Language rule left `NULL`.

    uv run python backend/scripts/relabel_languages.py --dry-run
    uv run python backend/scripts/relabel_languages.py

ADR-021's revision lets a Channel be Undetermined (`und`) or have No words
(`zxx`) where the old rule answered `NULL`. A code is decided exactly as before,
so only the `NULL` rows can change; this re-derives those, each Channel from its
stored Posts through `relabel_channels` and each Directory entry from its stored
samples, and sends no Telegram Request. A row still `NULL` afterwards has
nothing read yet.

Walks each table by key and commits per batch, so an interrupted run resumes
and a re-run changes nothing. `--dry-run` reports how many rows would change.
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

from sqlalchemy import exists
from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import Channel, DirectoryEntry, DirectorySample
from app.services.channel_directory_samples import samples_by_handle
from app.services.channels import relabel_channels
from app.services.directory_statistics import compute_sample_statistics
from app.services.sync_meta import touch_sync

logger = logging.getLogger("relabel_languages")

DEFAULT_BATCH_SIZE = 500


def _finish(session: Session, *, dry_run: bool) -> None:
    if dry_run:
        session.rollback()
    else:
        session.commit()


def _relabel_channels(session: Session, *, dry_run: bool, batch_size: int) -> int:
    changed = 0
    after = ""
    while names := list(
        session.exec(
            select(Channel.name)
            .where(col(Channel.language).is_(None), col(Channel.name) > after)
            .order_by(col(Channel.name))
            .limit(batch_size)
        ).all()
    ):
        after = names[-1]
        changed += relabel_channels(session, names, announce=False)
        _finish(session, dry_run=dry_run)
    if changed and not dry_run:
        touch_sync(session, "channels")
    return changed


def _relabel_entries(session: Session, *, dry_run: bool, batch_size: int) -> int:
    changed = 0
    after = ""
    while entries := list(
        session.exec(
            select(DirectoryEntry)
            .where(
                col(DirectoryEntry.language).is_(None),
                col(DirectoryEntry.handle) > after,
                # Only an entry with samples can gain a Language here.
                exists().where(col(DirectorySample.handle) == DirectoryEntry.handle),
            )
            .order_by(col(DirectoryEntry.handle))
            .limit(batch_size)
        ).all()
    ):
        after = entries[-1].handle
        samples = samples_by_handle(session, [entry.handle for entry in entries])
        for entry in entries:
            # A sample is always read, so an entry with samples always has one.
            entry.language = compute_sample_statistics(samples[entry.handle]).language
            session.add(entry)
            changed += 1
        _finish(session, dry_run=dry_run)
        logger.info("tg_channel_directory: %d entries changed so far", changed)
    return changed


def relabel(*, dry_run: bool, batch_size: int) -> tuple[int, int]:
    """Channels and Directory entries whose Language changes; written unless `dry_run`."""
    with Session(engine) as session:
        channels = _relabel_channels(session, dry_run=dry_run, batch_size=batch_size)
        entries = _relabel_entries(session, dry_run=dry_run, batch_size=batch_size)
    return channels, entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    channels, entries = relabel(dry_run=args.dry_run, batch_size=args.batch_size)
    prefix = "[dry-run] would relabel" if args.dry_run else "relabelled"
    logger.info("%s %d Channels and %d Directory entries", prefix, channels, entries)


if __name__ == "__main__":
    main()
