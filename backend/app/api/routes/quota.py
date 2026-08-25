"""Reading the quota ledger (ticket 08).

One route, and it is the "observe" half of "observe only": an Admin can see what
each account spent today, per Budget, and nothing anywhere refuses anything on
the strength of it. Tickets 23 and 24 add the lane choice and the ceiling, and
they need a week of these numbers before their defaults are anything but a
guess.

Gated on `Permission.QUOTA_READ_ANY` rather than on a role, per ticket 07: the
auditor role the plan keeps in view becomes an `INSERT`, and this file does not
change.
"""

from datetime import date

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, require_permission
from app.core.permissions import Permission
from app.schemas.quota import QuotaUsageEntry, QuotaUsageResponse
from app.services.quota import Budget, today_utc, usage_by_account

router = APIRouter(prefix="/quota", tags=["quota"])


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
            )
            for account in usage_by_account(session, day=ledger_day)
        ],
    )
