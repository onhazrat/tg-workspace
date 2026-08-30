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
  `assert_owner` is explicit that NULL fails closed. Counted on every table
  that has the column, but **drift only on the `USER_OWNED` ones**: ticket 19
  made sync logs Channel telemetry whose rows carry no owner on purpose, so
  before ticket 21 this reported 5,880 findings on a healthy dev database and
  `--strict` exited 1 on all of them. See `_shared_null_owner_keys`.
* **Orphan owners.** A `user_id` naming an account that no longer exists. The
  TG tables have no foreign key to `user.id`, so a deleted account leaves its
  rows behind pointing at nothing; nothing has ever noticed.
* **Channels nobody follows.** This was drift until ticket 05: with no unfollow,
  the only way to reach zero followers was a backfill that had not run or a
  creation path that skipped its dual-write. Unfollow made it a legitimate
  state — the one retention collects — so it is now reported as a queue depth
  and **not** counted as a finding. A count that stays high across retention
  runs is still worth looking at; a count that is merely non-zero is not.
* **Misfiled settings.** After ticket 06 a key lives in exactly one of the two
  settings tables, and `services/settings_registry.py` says which. The guard in
  `tests/services/test_settings_table_split.py` proves the *code* cannot write
  one to the wrong table; only a live database can say whether a row already
  did, since a row written before the split is invisible to an AST walk. A row
  with no owner is no longer drift at all — `tg_app_settings` is global by
  design, and that column is a stamp ticket 22 drops.

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
from app.models_tg import AppSetting, Channel, UserSetting
from app.services.follows import (
    channel_ids_without_follows,
    count_follows,
    orphan_follow_channel_ids,
)
from app.services.settings_registry import GLOBAL_KEYS, USER_KEYS
from app.services.tenancy import OWNER_COLUMN, SCOPES, Scope


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


#: Reported by the audit but not drift. `channels_awaiting_collection` counts
#: Channels nobody follows, which was impossible before ticket 05 and is now
#: simply retention's queue. It stays in the returned dict so the count is
#: assertable, and out of the strict gate so a healthy database still exits 0 —
#: a key that is merely printed cannot be tested in either direction.
AWAITING_COLLECTION = "channels_awaiting_collection"


def _shared_null_owner_keys() -> frozenset[str]:
    """`<table>.null_owner` keys where a NULL owner is the correct state.

    Ticket 19 made a sync log Channel telemetry: `upsert_sync_log` accepts a
    `user_id` and deliberately does not write it, so **every** row of
    `tg_sync_logs` and `tg_sync_log_payloads` carries NULL by design. The other
    follow-scoped and corpus tables are the same fact from the other side —
    their `user_id` is a "who scraped this first" stamp the seam never filters
    on, and ticket 22 drops it.

    They stay counted and printed, for the reason `_owner_column_models` gives:
    the count is how you tell whether anything still depends on the stamp before
    ticket 22 removes it. What changes here is that they no longer fail
    `--strict`, which is a bug rather than a policy call. This script is the
    pre-flight gate for ticket 21's flip, and on the dev database it reported
    **5,880 findings, every one of them a row behaving exactly as ticket 19
    specified**. A gate that fails on a correct database is a gate nobody runs,
    and the real drift it exists to catch was sitting underneath that noise.

    Derived from `SCOPES` rather than naming the two log tables, the way
    `SHARED_LOG_TYPES` and `owner_backfill_inventory` are: a table reclassified
    in the seam moves in and out of this set on its own, and a hand-written
    second list is the drift this whole programme keeps finding.
    """
    return frozenset(
        f"{model.__tablename__!s}.null_owner"
        for model, scope in SCOPES.items()
        if scope is not Scope.USER_OWNED and hasattr(model, OWNER_COLUMN)
    )


#: A NULL owner is drift only where the seam would have filtered on it — which
#: is exactly the `USER_OWNED` tables. An **orphan** owner stays drift
#: everywhere, including on these tables: a stamp naming a deleted account is
#: wrong whoever reads it, and unlike a NULL it was never intended.
NON_DRIFT_KEYS = frozenset({AWAITING_COLLECTION}) | _shared_null_owner_keys()


def _misfiled_settings_keys(session: Session) -> list[str]:
    """Keys sitting in the table the registry says is not theirs.

    The live-data counterpart of `tests/services/test_settings_table_split.py`.
    The guard proves the *code* cannot write a key to the wrong table; this
    proves no row already did, which the guard cannot see — a row written
    before ticket 06, or by a migration, is invisible to an AST walk.
    """
    stored_global = set(session.exec(select(col(AppSetting.key))).all())
    stored_user = set(session.exec(select(col(UserSetting.key))).all())

    return sorted((stored_global & set(USER_KEYS)) | (stored_user & set(GLOBAL_KEYS)))


def _unclassified_settings_keys(session: Session) -> list[str]:
    """Keys stored in either table that the registry does not name.

    Not necessarily wrong — an operator can `PUT` any key — but it is the
    shape a typo takes, and after the split an unclassified key cannot be read
    back through `home_for` at all.
    """
    known = set(GLOBAL_KEYS) | set(USER_KEYS)
    stored = set(session.exec(select(col(AppSetting.key))).all()) | set(
        session.exec(select(col(UserSetting.key))).all()
    )
    return sorted(stored - known)


def drift_only(findings: dict[str, int]) -> dict[str, int]:
    """The findings that actually mean something is wrong."""
    return {k: v for k, v in findings.items() if k not in NON_DRIFT_KEYS}


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
        # Reported, but not drift since ticket 05 — see the module docstring.
        # `--strict` would otherwise fail on a healthy database in the window
        # between a removal and the next retention run.
        print(
            f"  channels_awaiting_collection={len(unfollowed)}  "
            "(retention collects these)"
        )
        if unfollowed:
            findings[AWAITING_COLLECTION] = len(unfollowed)
            print(f"    e.g. {unfollowed[:10]}")
        if orphan_follows:
            # The foreign key makes this impossible, so a hit here means the
            # constraint is missing on this database.
            findings["follows_pointing_at_a_missing_channel"] = len(orphan_follows)
            print(f"  follows_pointing_at_a_missing_channel={len(orphan_follows)}")

        print("== settings ==")
        misfiled = _misfiled_settings_keys(session)
        print(f"  settings keys in the wrong table={len(misfiled)}")
        if misfiled:
            findings["settings_keys_in_the_wrong_table"] = len(misfiled)
            print(f"    {misfiled}")

        unclassified = _unclassified_settings_keys(session)
        print(f"  settings keys nobody classified={len(unclassified)}")
        if unclassified:
            findings["settings_keys_not_classified"] = len(unclassified)
            print(f"    {unclassified}")

    print("== summary ==")
    drift = drift_only(findings)
    if drift:
        for key in sorted(drift):
            print(f"  {key}={drift[key]}")
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
    if args.strict and drift_only(findings):
        sys.exit(1)


if __name__ == "__main__":
    main()
