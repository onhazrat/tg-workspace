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
from app.core.request_recording import Outcome
from app.schemas.request_stats import (
    AccountRequestTotals,
    ChannelRequestTotals,
    RequestBreakdownResponse,
    RequestRecord,
    RequestRecordsResponse,
    RequestSpreadBucket,
    RequestSpreadResponse,
    RequestTotals,
    RequestTrendBucket,
    RequestTrendResponse,
)
from app.services.request_stats import (
    ChargedFilter,
    Picked,
    account_emails,
    request_breakdown,
    request_records,
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
    keeps the Requests charged to those Accounts and the Uncharged ones they
    asked for; Uncharged Requests that name no Account stay out. `leftOut`
    drops those Channels' rows, by handle, and `leftOutKinds` the rows of
    those kinds' work with no Channel."""
    return Picked(charged, accounts or (), left_out or (), left_out_kinds or ())


PickedDep = Annotated[Picked, Depends(_picked)]


def _range(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    lo, hi = _utc_minute(start), _utc_minute(end)
    if hi <= lo:
        raise HTTPException(status_code=422, detail="end must be after start")
    return lo, hi


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
    the Requests charged to those Accounts and the Uncharged ones they asked
    for; Uncharged Requests that name no Account stay out. `leftOut` drops
    those Channels, by handle, and `leftOutKinds` the rows of those kinds'
    work with no Channel. `byAccount` counts each Account's charged Requests
    alone.
    """
    lo, hi = _range(start, end)
    breakdown = request_breakdown(session, lo, hi, picked)
    emails = account_emails(session, (a for a, _ in breakdown.by_account))
    return RequestBreakdownResponse(
        start=lo,
        end=hi,
        byKind=[
            RequestTotals(kind=kind, **asdict(totals))
            for kind, totals in breakdown.by_kind.items()
        ],
        byChannel=[
            ChannelRequestTotals(channel=channel, kind=kind, **asdict(totals))
            for (channel, kind), totals in breakdown.by_channel.items()
        ],
        byAccount=[
            AccountRequestTotals(
                accountId=account,
                email=emails.get(account, ""),
                kind=kind,
                **asdict(totals),
            )
            for (account, kind), totals in breakdown.by_account.items()
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


# RQS-10: the sheet a Channel table row opens.
@router.get(
    "/records",
    dependencies=[Depends(require_permission(Permission.QUOTA_READ_ANY))],
    response_model=RequestRecordsResponse,
)
def read_request_records(
    session: SessionDep,
    start: datetime,
    end: datetime,
    picked: PickedDep,
    channel: str | None = None,
    kind: str | None = None,
    hidden_kinds: Annotated[list[str] | None, Query(alias="hiddenKinds")] = None,
    hidden_outcomes: Annotated[
        list[Outcome] | None, Query(alias="hiddenOutcomes")
    ] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> RequestRecordsResponse:
    """One Channel table row's Requests in `[start, end)`, newest first.

    Name the row by `channel`, a Channel's handle, or by `kind`, the kind of
    an aggregate row (work with no Channel), never both. Each Request is kept
    `recordDays` days, so the range is cut to them. `charged`, `accounts`,
    `leftOut` and `leftOutKinds` are read as on the Breakdown. `hiddenKinds`
    and `hiddenOutcomes` leave those kinds of work and outcomes out. The
    outcome counts cover every page.
    """
    if (channel is None) == (kind is None):
        raise HTTPException(status_code=422, detail="name a channel or a kind")
    lo, hi = _range(start, end)
    page = request_records(
        session,
        lo,
        hi,
        (channel, kind),
        picked,
        (offset, limit),
        (hidden_kinds or (), [o.value for o in hidden_outcomes or ()]),
    )
    emails = account_emails(
        session, (r.account_id for r in page.records if r.account_id)
    )
    return RequestRecordsResponse(
        start=page.start,
        end=hi,
        total=page.outcomes.total(),
        useful=page.outcomes["useful"],
        idle=page.outcomes["idle"],
        wasted=page.outcomes["wasted"],
        records=[
            RequestRecord.model_validate(
                {
                    **record.model_dump(),
                    "email": emails.get(record.account_id, "")
                    if record.account_id
                    else None,
                }
            )
            for record in page.records
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
