"""Reading the quota ledger, and setting the limits it is read against.

Ticket 08 built the "observe" half: an Admin could see what each account spent
and nothing refused anything on the strength of it. Ticket 23 turned the numbers
into a lane. Ticket 24 adds this module's other four routes — the limits an
Admin sets, the ceiling they can lift for a day, and the account's own view of
where it stands.

**Two permissions, deliberately.** `QUOTA_READ_ANY` reads what others spent;
`QUOTA_MANAGE` decides what they may spend. Ticket 07's rule: the routes name a
permission, never a role, so the auditor role the spec keeps in view — read the
ledger, set nothing — becomes an `INSERT` and this file does not change.

`GET /quota/me` is the one route here with no permission at all. It answers for
the caller and for nobody else, which is the same reason `/users/me` needs none.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep, require_permission
from app.core.permissions import Permission
from app.models import User
from app.schemas.common import StatusResponse
from app.schemas.quota import (
    BudgetLimitsPayload,
    LiftCeilingRequest,
    MyBudgetUsage,
    MyQuotaResponse,
    QuotaLimitOverride,
    QuotaLimitsResponse,
    QuotaUsageEntry,
    QuotaUsageResponse,
    SetQuotaLimitsRequest,
)
from app.services.quota import (
    Budget,
    account_budget_states,
    lift_ceiling,
    quota_settings_field,
    resolve_budget_limits,
    stored_default,
    today_utc,
    usage_by_account,
)
from app.services.quota_limits import all_limits, set_limit
from app.services.settings_registry import QUOTA_KEY
from app.services.settings_store import get_global_setting, put_global_setting

router = APIRouter(prefix="/quota", tags=["quota"])

_UNKNOWN_BUDGET = "Unknown budget"
_USER_NOT_FOUND = "User not found"


def _budget_or_422(name: str) -> Budget:
    """Parse a Budget name from a request body, or refuse the whole request.

    422 rather than silently skipping the entry: a body naming `manualBulk`
    instead of `manual_bulk` would otherwise report success and change nothing,
    which is the shape of failure an Admin discovers a week later from a bill.
    """
    try:
        return Budget(name)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"{_UNKNOWN_BUDGET}: {name}"
        ) from exc


def _assert_account_exists(session: SessionDep, user_id: uuid.UUID) -> None:
    """404 for an account that does not exist.

    There is no enumeration to protect here — the caller holds `QUOTA_MANAGE`
    and can already list every account — but writing against a `user_id` naming
    nobody would fail the foreign key with a 500 instead of an answer.
    """
    if session.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail=_USER_NOT_FOUND)


@router.get(
    "/usage",
    dependencies=[Depends(require_permission(Permission.QUOTA_READ_ANY))],
    response_model=QuotaUsageResponse,
)
def read_quota_usage(
    session: SessionDep, day: date | None = None
) -> QuotaUsageResponse:
    """Every account's Request usage on one UTC day, per Budget.

    `day` defaults to today. Absent accounts spent nothing — the ledger only
    holds rows for work that actually happened, so a quiet day is a short list
    rather than a page of zeros.
    """
    ledger_day = day if day is not None else today_utc()
    return QuotaUsageResponse(
        day=ledger_day,
        entries=[
            # Constructed by alias, as `StartSyncJobResponse` is: without the
            # pydantic mypy plugin the field names are not the __init__ names.
            QuotaUsageEntry(
                userId=account.user_id,
                email=account.email,
                autoSync=account.spent[Budget.AUTO_SYNC],
                manualBulk=account.spent[Budget.MANUAL_BULK],
                manualSingle=account.spent[Budget.MANUAL_SINGLE],
                total=account.total,
                autoSyncLifted=account.lifted[Budget.AUTO_SYNC],
                manualBulkLifted=account.lifted[Budget.MANUAL_BULK],
                manualSingleLifted=account.lifted[Budget.MANUAL_SINGLE],
            )
            for account in usage_by_account(session, day=ledger_day)
        ],
    )


@router.get("/me", response_model=MyQuotaResponse)
def read_my_quota(session: SessionDep, current_user: CurrentUser) -> MyQuotaResponse:
    """Where the calling account stands on each Budget today (ticket 24).

    The fourth checkbox: a User sees per-Budget usage, and the browser turns
    `status` into the persistent warning. `status` is computed here rather than
    in the browser because the derivation is three comparisons in which zero
    means opposite things on the two rungs, and getting it wrong client-side
    would show "blocked" to somebody whose work is running.
    """
    return MyQuotaResponse(
        day=today_utc(),
        budgets=[
            MyBudgetUsage(
                budget=state.budget.value,
                allowance=state.limits.allowance,
                ceiling=state.limits.ceiling,
                spent=state.spent,
                status=state.status,
                lifted=state.lifted,
            )
            for state in account_budget_states(session, current_user.id)
        ],
    )


@router.get(
    "/limits",
    dependencies=[Depends(require_permission(Permission.QUOTA_MANAGE))],
    response_model=QuotaLimitsResponse,
)
def read_quota_limits(session: SessionDep) -> QuotaLimitsResponse:
    """The deployment's defaults and every per-account override.

    Both in one response: an override field rendered blank has to say which
    number it inherits, so a screen that fetched them separately would be
    briefly and visibly wrong.

    **Both the resolved defaults and the stored ones**, which is not
    redundancy. The resolved pair is what is in force, `config.py` fallback
    included, and is what a form should show as *placeholder* text. The stored
    pair is what an Admin has actually saved, `null` where they never have, and
    is what the form's input *value* must be. Sending only the resolved numbers
    makes a form seed every box with the shipped value, so the first save writes
    all six into the settings row and `QUOTA_DEFAULT_*` in `.env` goes silently
    dead for that deployment — and "leave it empty to inherit" stops being
    sayable, because no box is ever empty.
    """
    stored = get_global_setting(session, QUOTA_KEY)
    defaults = []
    stored_defaults = []
    for budget in Budget:
        limits = resolve_budget_limits(session, budget, None)
        defaults.append(
            BudgetLimitsPayload(
                budget=budget.value,
                allowance=limits.allowance,
                ceiling=limits.ceiling,
            )
        )
        stored_defaults.append(
            BudgetLimitsPayload(
                budget=budget.value,
                allowance=stored_default(stored, budget, "Requests"),
                ceiling=stored_default(stored, budget, "Ceiling"),
            )
        )

    rows = all_limits(session)
    owner_ids = {row.user_id for row in rows}
    emails: dict[uuid.UUID, str] = (
        {
            user.id: user.email
            for user in session.exec(
                select(User).where(col(User.id).in_(owner_ids))
            ).all()
        }
        if owner_ids
        else {}
    )
    return QuotaLimitsResponse(
        defaults=defaults,
        storedDefaults=stored_defaults,
        overrides=[
            QuotaLimitOverride(
                userId=row.user_id,
                email=emails.get(row.user_id, ""),
                budget=row.budget,
                allowance=row.allowance,
                ceiling=row.ceiling,
            )
            for row in rows
        ],
    )


@router.put(
    "/limits/defaults",
    dependencies=[Depends(require_permission(Permission.QUOTA_MANAGE))],
    response_model=QuotaLimitsResponse,
)
def set_quota_defaults(
    session: SessionDep, body: SetQuotaLimitsRequest
) -> QuotaLimitsResponse:
    """Set the deployment-wide default allowance and ceiling per Budget.

    Written to the global `quota` settings row through `settings_store`, which
    is the sole writer of `tg_app_settings` — a second writer here would be the
    second opinion about where a key belongs that the ticket 06 split exists to
    remove.

    A `null` field clears that default, dropping back to `config.py`. It is
    stored as a null rather than deleted, which `stored_default` reads as
    absent either way.
    """
    payload: dict[str, int | None] = {}
    for entry in body.budgets:
        budget = _budget_or_422(entry.budget)
        payload[quota_settings_field(budget, "Requests")] = entry.allowance
        payload[quota_settings_field(budget, "Ceiling")] = entry.ceiling
    if payload:
        put_global_setting(session, QUOTA_KEY, payload)
    return read_quota_limits(session)


@router.put(
    "/limits/{user_id}",
    dependencies=[Depends(require_permission(Permission.QUOTA_MANAGE))],
    response_model=QuotaLimitsResponse,
)
def set_quota_limits_for_user(
    session: SessionDep, user_id: uuid.UUID, body: SetQuotaLimitsRequest
) -> QuotaLimitsResponse:
    """Override one account's allowance and ceiling on the Budgets named.

    A Budget the body omits keeps whatever override it had, so a screen editing
    one row does not have to echo the other two back to preserve them. Sending
    both numbers as `null` removes the override entirely, which is the only way
    to put an account back on the deployment default.
    """
    _assert_account_exists(session, user_id)
    # **Every name parsed before anything is written.** `set_limit` commits per
    # entry, so validating inside the loop means a body whose second entry is
    # misspelled writes the first and then answers 422 — an Admin sees a
    # rejected request and half of it landed. `_budget_or_422`'s own docstring
    # says it refuses the whole request; this is what makes that true.
    parsed = [
        (_budget_or_422(entry.budget), entry.allowance, entry.ceiling)
        for entry in body.budgets
    ]
    for budget, allowance, ceiling in parsed:
        set_limit(session, user_id, budget.value, allowance=allowance, ceiling=ceiling)
    return read_quota_limits(session)


@router.post(
    "/lifts/{user_id}",
    dependencies=[Depends(require_permission(Permission.QUOTA_MANAGE))],
    response_model=StatusResponse,
)
def lift_quota_ceiling(
    session: SessionDep, user_id: uuid.UUID, body: LiftCeilingRequest
) -> StatusResponse:
    """Stop enforcing this account's ceilings for the current UTC day.

    Decision 18's "an Admin can lift early". The auto-lift needs no route: the
    ledger is keyed by day, so a ceiling stops applying at the same UTC midnight
    the spend resets at.

    An empty `budgets` lifts all three, which is what an Admin unblocking
    somebody in a hurry means. `lifted: false` takes it back.
    """
    _assert_account_exists(session, user_id)
    budgets = (
        [_budget_or_422(name) for name in body.budgets]
        if body.budgets
        else list(Budget)
    )
    for budget in budgets:
        lift_ceiling(session, user_id, budget, lifted=body.lifted)
    return StatusResponse(status="lifted" if body.lifted else "restored")
