#!/usr/bin/env python3
"""Give every existing Channel a Follow (ticket 04, plan step A1).

    uv run python backend/scripts/backfill_channel_follows.py --dry-run
    uv run python backend/scripts/backfill_channel_follows.py

Owner is `Channel.user_id` where it is set, and the first superuser where it is
NULL — the rule `services/follows.py::resolve_follow_owner` applies to new
writes, so a channel created during the backfill and one created a minute after
it end up owned by the same account.

Idempotent by construction rather than by a `--force` flag somebody has to
remember: every write is `ON CONFLICT DO NOTHING`, so running it twice is a
no-op and running it after a partial failure resumes. That matters because this
is a script an operator runs by hand against a live database — `prestart.sh`
runs `alembic upgrade head` unattended, and a data move that needs a dry run
first has no business being in the migration chain.

Batched, and committed per batch. A single transaction over a few thousand
channels would hold its snapshot open for the whole run, and this repo has
already paid for that once: `run_auto_sync` left `tg_sync_meta` with 10 live
rows and 4,743 dead by keeping one transaction open across awaited work.

Verify with the audit, which reports channels still missing a follow:

    uv run python backend/scripts/audit_tenancy_drift.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session, col, func, select

from app.core.db import engine
from app.models_tg import Channel
from app.services.follows import (
    ensure_follow_for_channel,
    follow_exists,
    resolve_follow_owner,
)
from app.services.operator import get_operator_user_id

#: Channels per transaction. Large enough that the run is a handful of round
#: trips on the ~2,000-channel staging database, small enough that no snapshot
#: is held open long.
BATCH_SIZE = 500


def backfill(*, dry_run: bool = False, batch_size: int = BATCH_SIZE) -> dict[str, int]:
    """Create one Follow per Channel. Returns counts for the operator to read."""
    stats = {
        "channels": 0,
        "created": 0,
        "already_present": 0,
        # NULL owners and owners naming a deleted account alike: both are
        # "nobody who exists owns this", and the audit reports them separately.
        "reassigned_to_operator": 0,
    }

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        if operator_id is None:
            print(
                "ERROR: no first superuser — run init_db before backfilling, or "
                "every ownerless channel would have no owner to fall back to.",
                file=sys.stderr,
            )
            sys.exit(1)

        total = session.exec(select(func.count()).select_from(Channel)).one()
        print(f"{'[dry-run] ' if dry_run else ''}{total} channels to consider")

        offset = 0
        while True:
            batch = session.exec(
                select(Channel)
                .order_by(col(Channel.id))
                .offset(offset)
                .limit(batch_size)
            ).all()
            if not batch:
                break

            for channel in batch:
                stats["channels"] += 1

                # `resolve_follow_owner`, not `channel.user_id or operator_id`:
                # the aggregate also redirects an owner naming a deleted
                # account, and probing on the ghost id would look up a key that
                # can never exist. One rule, one place.
                owner_id = resolve_follow_owner(session, channel.user_id)
                if owner_id != channel.user_id:
                    stats["reassigned_to_operator"] += 1
                if follow_exists(session, user_id=owner_id, channel_id=channel.id):
                    stats["already_present"] += 1
                    continue

                if dry_run:
                    stats["created"] += 1
                    continue

                if ensure_follow_for_channel(session, channel, user_id=owner_id):
                    stats["created"] += 1
                else:
                    # Lost a race with the dual-write between the check above
                    # and the insert. The row exists either way, which is all
                    # this script promised.
                    stats["already_present"] += 1

            if not dry_run:
                session.commit()
            offset += batch_size
            print(f"  ...{min(offset, total)}/{total}")

    print(
        f"{'[dry-run] ' if dry_run else ''}"
        f"channels={stats['channels']} follows_created={stats['created']} "
        f"already_present={stats['already_present']} "
        f"reassigned_to_operator={stats['reassigned_to_operator']}"
    )
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be written without writing it.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
        help=f"Channels per transaction (default {BATCH_SIZE}).",
    )
    args = parser.parse_args()
    backfill(dry_run=args.dry_run, batch_size=args.batch_size)


if __name__ == "__main__":
    main()
