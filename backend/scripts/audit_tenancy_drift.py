#!/usr/bin/env python3
"""Report ownership drift, read-only (ticket 04, plan step A1).

    uv run python backend/scripts/audit_tenancy_drift.py
    uv run python backend/scripts/audit_tenancy_drift.py --strict   # exit 1 on drift

The gate for every later step of the tenancy programme. Ticket 21 flips
enforcement on for real, and the failure mode there is not a crash — it is rows
quietly becoming invisible to the account that owns them, or visible to one that
does not. Both are indistinguishable from "it works" on a green suite that never
asked which rows existed. So this counts the four shapes of drift that would
cause it, against a live database, before anything is enforced:

* **NULL owners.** A row written before the `user_id` stamp existed. Under
  enforcement `scoped_select` filters these out of their own owner's results —
  `assert_owner` is explicit that NULL fails closed.
* **Orphan owners.** A `user_id` naming an account that no longer exists. The
  TG tables have no foreign key to `user.id`, so a deleted account leaves its
  rows behind pointing at nothing; nothing has ever noticed.
* **Channels nobody follows.** After the backfill this should be zero. Until
  ticket 05 splits unfollow from delete there is no legitimate way to reach it,
  so a non-zero count means the backfill has not run or a creation path skipped
  its dual-write.
* **Unowned settings.** `tg_app_settings` rows with no owner, which ticket 06
  splits into a global table and a per-user one. A key that is genuinely global
  is not drift — it is why that ticket exists — so this counts them and does not
  judge them.

Read-only by construction: it opens one session, runs `SELECT COUNT(*)` and
nothing else, and never commits.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session, SQLModel, col, func, select

from app.core.db import engine
from app.models import User
from app.models_tg import AppSetting, Channel
from app.services.follows import (
    channel_ids_without_follows,
    count_follows,
    orphan_follow_channel_ids,
)
from app.services.tenancy import OWNER_COLUMN, SCOPES


def _owner_column_models() -> list[type[SQLModel]]:
    """Every classified table that stamps an owner, in a stable order.

    Driven off `SCOPES` rather than a list of its own, so a table added to the
    seam is audited without anyone remembering to add it here. Follow-scoped
    tables are included deliberately: their `user_id` columns are dropped in
    ticket 22, and until then a NULL there is still worth counting — it is how
    you tell whether anything still depends on the stamp.
    """
    models = [m for m in SCOPES if hasattr(m, OWNER_COLUMN)]
    return sorted(models, key=lambda m: str(m.__tablename__))


def _count(session: Session, statement) -> int:
    return session.exec(statement).one()


def audit(*, verbose: bool = False) -> dict[str, int]:
    """Count drift. Returns a flat dict; prints a report."""
    findings: dict[str, int] = {}

    with Session(engine) as session:
        known_users = select(col(User.id))

        print("== owners ==")
        for model in _owner_column_models():
            table = str(model.__tablename__)
            owner = getattr(model, OWNER_COLUMN)

            nulls = _count(
                session,
                select(func.count()).select_from(model).where(col(owner).is_(None)),
            )
            orphans = _count(
                session,
                select(func.count())
                .select_from(model)
                .where(col(owner).is_not(None), col(owner).notin_(known_users)),
            )

            if nulls:
                findings[f"{table}.null_owner"] = nulls
            if orphans:
                findings[f"{table}.orphan_owner"] = orphans
            if verbose or nulls or orphans:
                print(f"  {table}: null={nulls} orphan={orphans}")

        print("== follows ==")
        channels = _count(session, select(func.count()).select_from(Channel))
        follows = count_follows(session)
        unfollowed = channel_ids_without_follows(session)
        orphan_follows = orphan_follow_channel_ids(session)

        print(f"  channels={channels} follows={follows}")
        print(f"  channels_with_no_follow={len(unfollowed)}")
        if unfollowed:
            findings["channels_with_no_follow"] = len(unfollowed)
            print(f"    e.g. {unfollowed[:10]}")
        if orphan_follows:
            # The foreign key makes this impossible, so a hit here means the
            # constraint is missing on this database.
            findings["follows_pointing_at_a_missing_channel"] = len(orphan_follows)
            print(f"  follows_pointing_at_a_missing_channel={len(orphan_follows)}")

        print("== settings ==")
        unowned = _count(
            session,
            select(func.count())
            .select_from(AppSetting)
            .where(col(AppSetting.user_id).is_(None)),
        )
        print(f"  tg_app_settings with no owner={unowned}  (ticket 06 splits these)")
        if unowned:
            findings["settings_with_no_owner"] = unowned

    print("== summary ==")
    if findings:
        for key in sorted(findings):
            print(f"  {key}={findings[key]}")
    else:
        print("  no drift")
    return findings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print every table, including the ones with no drift.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit 1 when any drift is found, for use as a gate.",
    )
    args = parser.parse_args()

    findings = audit(verbose=args.verbose)
    if args.strict and findings:
        sys.exit(1)


if __name__ == "__main__":
    main()
