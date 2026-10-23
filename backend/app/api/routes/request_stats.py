"""Where every Request went, for the Operator (RQS-01, ADR-035).

Gated on `QUOTA_READ_ANY`, the Permission that already reads every account's
quota usage: these are the same Requests, broken down further.
"""

import uuid
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import SessionDep, require_permission
from app.core.config import settings
from app.core.permissions import Permission
from app.schemas.request_stats import (
    AccountRequestTotals,
    ChannelRequestTotals,
    RequestBreakdownResponse,
    RequestSpreadBucket,
    RequestSpreadResponse,
    RequestTotals,
    RequestTrendBucket,
    RequestTrendResponse,
)
from app.services.request_stats import (
    ChargedFilter,
    Picked,
    Totals,
    account_emails,
    request_breakdown,
    request_spread,
    request_trend,
)

router = APIRouter(prefix="/requests", tags=["requests"])


def _utc_minute(moment: datetime) -> datetime:
    """Naive UTC, to the minute, as the stats tables store time."""
    if moment.tzinfo is not None:
        moment = moment.astimezone(UTC).replace(tzinfo=None)
    return moment.replace(second=0, microsecond=0)


def _picked(
    charged: ChargedFilter = "all",
    accounts: Annotated[list[uuid.UUID] | None, Query()] = None,
    left_out: Annotated[list[str] | None, Query(alias="leftOut")] = None,
    left_out_kinds: Annotated[list[str] | None, Query(alias="leftOutKinds")] = None,
) -> Picked:
    """`charged` keeps only Charged or only Uncharged Requests. `accounts`
    keeps only the Requests charged to those Accounts. `leftOut` drops those
    Channels' rows, by handle, and `leftOutKinds` the rows of those kinds'
    work with no Channel."""
    return Picked(charged, accounts or (), left_out or (), left_out_kinds or ())


PickedDep = Annotated[Picked, Depends(_picked)]


def _range(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    lo, hi = _utc_minute(start), _utc_minute(end)
    if hi <= lo:
        raise HTTPException(status_code=422, detail="end must be after start")
    return lo, hi


def _totals(kind: str, totals: Totals) -> dict[str, object]:
    return {
        "kind": kind,
        "requests": totals.requests,
        "useful": totals.useful,
        "idle": totals.idle,
        "wasted": totals.wasted,
        "charged": totals.charged,
        "newPosts": totals.new_posts,
        "repeatedPosts": totals.repeated_posts,
        "syncs": totals.syncs,
        "failedSyncs": totals.failed_syncs,
    }


@router.get(
    "/breakdown",
    dependencies=[Depends(require_permission(Permission.QUOTA_READ_ANY))],
    response_model=RequestBreakdownResponse,
)
def read_request_breakdown(
    session: SessionDep,
    start: datetime,
    end: datetime,
    picked: PickedDep,
) -> RequestBreakdownResponse:
    """Requests in `[start, end)` by kind of work, by Channel and by Account.

    Times are cut to the minute and read as UTC when they carry no zone.
    `charged` keeps only Charged or only Uncharged Requests. `accounts` keeps
    only the Requests charged to those Accounts. `leftOut` drops those
    Channels, by handle, and `leftOutKinds` the rows of those kinds' work with
    no Channel. `byAccount` counts each Account's charged Requests alone.
    """
    lo, hi = _range(start, end)
    breakdown = request_breakdown(session, lo, hi, picked)
    emails = account_emails(session, (a for a, _ in breakdown.by_account))
    return RequestBreakdownResponse(
        start=lo,
        end=hi,
        byKind=[
            RequestTotals.model_validate(_totals(kind, totals))
            for kind, totals in sorted(breakdown.by_kind.items())
        ],
        byChannel=[
            ChannelRequestTotals.model_validate(
                {**_totals(kind, totals), "channel": channel}
            )
            for (channel, kind), totals in sorted(
                breakdown.by_channel.items(),
                key=lambda item: (-item[1].requests, item[0][0] or "", item[0][1]),
            )
        ],
        byAccount=[
            AccountRequestTotals.model_validate(
                {
                    **_totals(kind, totals),
                    "accountId": account,
                    "email": emails.get(account, ""),
                }
            )
            for (account, kind), totals in sorted(
                breakdown.by_account.items(),
                key=lambda item: (str(item[0][0]), item[0][1]),
            )
        ],
    )


# RQS-06: the trend both of the tab's charts draw.
@router.get(
    "/trend",
    dependencies=[Depends(require_permission(Permission.QUOTA_READ_ANY))],
    response_model=RequestTrendResponse,
)
def read_request_trend(
    session: SessionDep,
    start: datetime,
    end: datetime,
    picked: PickedDep,
) -> RequestTrendResponse:
    """Requests in `[start, end)` over time, by kind of work and outcome.

    Each bucket is the finest the stored totals allow for its stretch: 5
    minutes inside the last week, an hour inside the last `hourlyDays` days, a
    day before. A range cut finer than its stretch allows is widened to that
    grain; otherwise the first and last buckets are cut to the range. Times
    `charged`, `accounts`, `leftOut` and `leftOutKinds` are read as on the
    Breakdown.
    """
    lo, hi = _range(start, end)
    return RequestTrendResponse(
        start=lo,
        end=hi,
        hourlyDays=settings.REQUEST_HOURLY_DAYS,
        buckets=[
            RequestTrendBucket.model_validate(asdict(bucket))
            for bucket in request_trend(session, lo, hi, picked)
        ],
    )


# RQS-09: the range picker's spread.
@router.get(
    "/spread",
    dependencies=[Depends(require_permission(Permission.QUOTA_READ_ANY))],
    response_model=RequestSpreadResponse,
)
def read_request_spread(
    session: SessionDep, picked: PickedDep
) -> RequestSpreadResponse:
    """When Requests were made, over everything kept, for the range picker.

    Hours inside the hourly totals' span, whole days before it, without the
    range. `charged`, `accounts`, `leftOut` and `leftOutKinds` are read as on
    the Breakdown.
    """
    return RequestSpreadResponse(
        recordDays=settings.REQUEST_RECORD_DAYS,
        hourlyDays=settings.REQUEST_HOURLY_DAYS,
        buckets=[
            RequestSpreadBucket.model_validate(asdict(bucket))
            for bucket in request_spread(session, picked)
        ],
    )
