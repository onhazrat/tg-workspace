#!/usr/bin/env python3
"""Give every existing Channel a Follow (ticket 04, plan step A1).

    uv run python backend/scripts/backfill_channel_follows.py --dry-run
    uv run python backend/scripts/backfill_channel_follows.py

Owner is the first superuser, through `services/follows.py::resolve_follow_owner`
— the same rule that applies to new writes, so a channel created during the
backfill and one created a minute after it end up owned by the same account.

It used to prefer `Channel.user_id` and fall back to the superuser. Ticket 22
dropped that column: it recorded who scraped a handle first, which was never the
same question as who follows it. Nothing is lost in practice, because ticket 21
closed every path that creates a Channel without a Follow before flipping
enforcement — so a Channel this script still finds unfollowed can only come from
a backup predating ticket 04, which has one account's data in it.

Runs unattended from `prestart.sh` as `--if-needed`, after `initial_data.py`
has created the first superuser this falls back to. An operator can still run it
by hand, with `--dry-run` first; the two modes differ only in whether the
completion marker short-circuits the walk.

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
from app.models_tg import Channel, utc_now
from app.services.channel_setting_groups import ensure_default_group
from app.services.follows import (
    ensure_follow_for_channel,
    follow_exists,
    get_operator_user_id,
    resolve_follow_owner,
)
from app.services.settings_store import get_global_setting, put_global_setting

#: Channels per transaction. Large enough that the run is a handful of round
#: trips on the ~2,000-channel staging database, small enough that no snapshot
#: is held open long.
BATCH_SIZE = 500

#: Global `AppSetting` key recording that this has run to completion.
#:
#: `--if-needed` checks this and nothing else, deliberately. The obvious test —
#: "are there channels with no follow?" — is correct exactly until ticket 05
#: lands, and then it is a data-loss bug: unfollowing is *supposed* to leave a
#: channel with zero followers, so a deploy-time backfill asking that question
#: would hand the channel straight back to the operator who just removed it,
#: some time before retention collects it. A one-shot marker cannot develop
#: that opinion, and it stays correct without anyone remembering to delete this
#: from `prestart.sh` at ticket 05.
#:
#: Global, so it is the half of the settings split that stays in
#: `tg_app_settings` at ticket 06.
COMPLETION_KEY = "follows_backfill"


def already_completed(session: Session) -> bool:
    """Whether a full backfill has been recorded. One primary-key lookup."""
    return bool(get_global_setting(session, COMPLETION_KEY).get("completedAt"))


def backfill(
    *,
    dry_run: bool = False,
    batch_size: int = BATCH_SIZE,
    if_needed: bool = False,
) -> dict[str, int]:
    """Create one Follow per Channel. Returns counts for the operator to read.

    `if_needed=True` is the unattended mode `prestart.sh` uses: it returns
    immediately once the marker is set, so the cost on every later deploy is a
    single primary-key lookup rather than a walk over every channel.
    """
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

        if if_needed and already_completed(session):
            print("follows backfill already completed; nothing to do")
            return stats

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

                # The operator, because ticket 22 dropped `Channel.user_id` and
                # there is nothing else left to ask. That stamp said who scraped
                # a handle first, which was never the same question as who
                # follows it, and it is now gone.
                #
                # This does not change what the script produces on any database
                # that reaches it. Ticket 21 closed every path that creates a
                # Channel without a Follow and then flipped enforcement, so a
                # Channel with no follow is only reachable from a backup taken
                # before ticket 04 — which by definition has one account's data
                # in it. `resolve_follow_owner` is still the call rather than
                # `get_operator_user_id`, so this and the dual-write cannot
                # disagree about who the operator is.
                owner_id = resolve_follow_owner(session, None)
                if owner_id is None:
                    # No account exists to own a follow. `ensure_follow` writes
                    # a real foreign key, so there is nothing to write rather
                    # than a row to write with a NULL owner.
                    print(
                        "ERROR: no account to own the follows — run init_db first",
                        file=sys.stderr,
                    )
                    sys.exit(1)
                stats["reassigned_to_operator"] += 1
                if follow_exists(session, user_id=owner_id, channel_id=channel.id):
                    stats["already_present"] += 1
                    continue

                if dry_run:
                    stats["created"] += 1
                    continue

                # **With the group, not bare.** Before ticket 22
                # `ensure_follow_for_channel` copied the per-User fields off the
                # Channel; those columns are gone, so a bare call now writes
                # `setting_group_id=None` — and this script's only remaining
                # caller is `prestart.sh --if-needed` against a restored
                # pre-ticket-04 backup, where that would leave *every* channel
                # group-less. The scheduler skips a group-less follow silently
                # and the channel page 500s on it, so the whole install would
                # come up syncing nothing.
                if ensure_follow_for_channel(
                    session,
                    channel,
                    user_id=owner_id,
                    values={
                        "setting_group_id": ensure_default_group(
                            session, user_id=owner_id
                        ).id
                    },
                ):
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

        # Only after every batch committed. Marking before the walk finishes
        # would turn a run interrupted halfway into a permanent skip, and the
        # channels it never reached would stay unfollowed forever.
        if not dry_run:
            put_global_setting(
                session,
                COMPLETION_KEY,
                {"completedAt": int(utc_now().timestamp() * 1000)},
            )

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
    parser.add_argument(
        "--if-needed",
        action="store_true",
        help="Do nothing if a full backfill has already been recorded. Used by prestart.sh.",
    )
    args = parser.parse_args()
    backfill(
        dry_run=args.dry_run,
        batch_size=args.batch_size,
        if_needed=args.if_needed,
    )


if __name__ == "__main__":
    main()
