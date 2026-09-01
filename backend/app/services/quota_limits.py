"""Aggregate for `tg_quota_limits` — the per-User Budget overrides (ticket 24).

The **only** module that writes this table. `quota.py` reads it, the way
`sync_lanes.py` reads `quota.py`: a limit is a fact an Admin stated about an
account, and the ledger is a fact about what that account then spent.

## Three layers, and the bottom one is code

An allowance or a ceiling resolves most-specific-first: this table, then the
deployment-wide `quota` row in `tg_app_settings`, then the
`QUOTA_DEFAULT_*` settings in `config.py`. The shipped layer stays because the
other two are rows, and every database has neither on the deploy that
introduces them — resolving to zero there would block every account on a
migration.

## Null is "inherit", and that is not the same as zero

Both columns are nullable and an absent row is not a row of zeros. An Admin
capping one account's `manual_bulk` must not thereby freeze its `auto_sync` at
whatever the deployment default happened to be that afternoon, which is what
storing a full copy of the resolved numbers would do.

`Budget` is not imported at module scope: `quota.py` imports this module, so
naming its enum here would close the cycle. The `budget` column is the enum's
string value, which is a persisted format either way.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlmodel import Session, col, select

from app.models_tg import QuotaLimit, utc_now
from app.services.tenancy import scoped_select, unscoped_select


def limits_for_user(session: Session, user_id: uuid.UUID) -> dict[str, QuotaLimit]:
    """This account's override rows, keyed by Budget value. Possibly empty.

    Through the seam rather than a hand-rolled `.where(user_id == ...)`, which
    reaches the same answer under enforcement and fails the guard for the reason
    `test_setting_group_and_job_scoping.py` states: a hand-rolled filter narrows
    in the flag-off state, where the seam promises not to. The row is still
    *selected* by its primary key below, so the flag changes nothing about which
    numbers this account resolves — it changes only whether a caller could ask
    for somebody else's.
    """
    statement = scoped_select(select(QuotaLimit), QuotaLimit, user_id).where(
        QuotaLimit.user_id == user_id
    )
    return {row.budget: row for row in session.exec(statement).all()}


def all_limits(session: Session) -> Sequence[QuotaLimit]:
    """Every account's overrides. The Admin view's payload.

    Ordered so a refresh does not reshuffle, as `quota.usage_rows` is.
    """
    statement = unscoped_select(
        select(QuotaLimit).order_by(col(QuotaLimit.user_id), col(QuotaLimit.budget)),
        reason=(
            "The Admin limits view reports what every account is allowed; "
            "scoping it to the caller would report the Admin's own overrides "
            "and call them the deployment's. Gated on Permission.QUOTA_MANAGE "
            "at the route."
        ),
    )
    return session.exec(statement).all()


def set_limit(
    session: Session,
    user_id: uuid.UUID,
    budget: str,
    *,
    allowance: int | None,
    ceiling: int | None,
) -> None:
    """Store one account's override of one Budget. Commits.

    Both values are written as given, `None` included — passing `None` for a
    column is how an Admin puts that half back on the deployment default, and
    there is no other way to say it. A row where both are `None` is deleted
    rather than kept, because a row that overrides nothing would show up in the
    Admin view as an account with limits set and no limits.
    """
    row = session.get(QuotaLimit, (user_id, budget))
    if allowance is None and ceiling is None:
        if row is not None:
            session.delete(row)
            session.commit()
        return

    if row is None:
        row = QuotaLimit(
            user_id=user_id, budget=budget, allowance=allowance, ceiling=ceiling
        )
    else:
        row.allowance = allowance
        row.ceiling = ceiling
        row.updated_at = utc_now()
    session.add(row)
    session.commit()
