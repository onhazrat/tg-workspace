"""Where every Request went, for the Operator (RQS-01, ADR-035).

Gated on `QUOTA_READ_ANY`, the Permission that already reads every account's
quota usage: these are the same Requests, broken down further.
"""

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import SessionDep, require_permission
from app.core.config import settings
from app.core.permissions import Permission
from app.schemas.request_stats import (
    ChannelRequestTotals,
    RequestBreakdownResponse,
    RequestTotals,
    RequestTrendBucket,
    RequestTrendResponse,
)
from app.services.request_stats import (
    ChargedFilter,
    Totals,
    request_breakdown,
    request_trend,
)

router = APIRouter(prefix="/requests", tags=["requests"])


def _utc_minute(moment: datetime) -> datetime:
    """Naive UTC, to the minute, as the stats tables store time."""
    if moment.tzinfo is not None:
        moment = moment.astimezone(UTC).replace(tzinfo=None)
    return moment.replace(second=0, microsecond=0)


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
    charged: Annotated[ChargedFilter, Query()] = "all",
) -> RequestBreakdownResponse:
    """Requests in `[start, end)` by kind of work and by Channel.

    Times are cut to the minute and read as UTC when they carry no zone.
    `charged` keeps only Charged or only Uncharged Requests.
    """
    lo, hi = _range(start, end)
    breakdown = request_breakdown(session, lo, hi, charged)
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
    charged: Annotated[ChargedFilter, Query()] = "all",
) -> RequestTrendResponse:
    """Requests in `[start, end)` over time, by kind of work and outcome.

    Each bucket is the finest the stored totals allow for its stretch: 5
    minutes inside the last week, an hour inside the last `hourlyDays` days, a
    day before. A range cut finer than its stretch allows is widened to that
    grain; otherwise the first and last buckets are cut to the range. Times
    and `charged` are read as on the Breakdown.
    """
    lo, hi = _range(start, end)
    return RequestTrendResponse(
        start=lo,
        end=hi,
        hourlyDays=settings.REQUEST_HOURLY_DAYS,
        buckets=[
            RequestTrendBucket.model_validate(asdict(bucket))
            for bucket in request_trend(session, lo, hi, charged)
        ],
    )
