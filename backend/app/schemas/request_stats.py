"""Response models for the Requests endpoints (RQS-01, ADR-035)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RequestTotals(BaseModel):
    """Requests by outcome, and the Posts the answered pages brought."""

    model_config = ConfigDict(populate_by_name=True)

    kind: str
    requests: int
    useful: int
    idle: int
    wasted: int
    charged: int
    new_posts: int = Field(alias="newPosts")
    repeated_posts: int = Field(alias="repeatedPosts")
    #: Sync runs and how many failed (RQS-04); 0 on work that is not a sync.
    syncs: int
    failed_syncs: int = Field(alias="failedSyncs")


class ChannelRequestTotals(RequestTotals):
    """One kind of work on one Channel. `channel` is null on an aggregate row."""

    channel: str | None


class AccountRequestTotals(RequestTotals):
    """One kind of work charged to one Account. `email` is blank for an
    Account deleted since."""

    account_id: uuid.UUID = Field(alias="accountId")
    email: str


class RequestBreakdownResponse(BaseModel):
    """Totals by kind and by Channel for one range, in UTC."""

    model_config = ConfigDict(populate_by_name=True)

    start: datetime
    end: datetime
    by_kind: list[RequestTotals] = Field(alias="byKind")
    by_channel: list[ChannelRequestTotals] = Field(alias="byChannel")
    by_account: list[AccountRequestTotals] = Field(alias="byAccount")


class RequestTrendBucket(BaseModel):
    """One kind's Charged or Uncharged Requests in `[start, end)`, by outcome."""

    start: datetime
    end: datetime
    kind: str
    charged: bool
    useful: int
    idle: int
    wasted: int


class RequestTrendResponse(BaseModel):
    """One range in buckets: 5 minutes inside the Requests' span, hours inside
    the hourly totals' span (`hourlyDays`), whole days before."""

    model_config = ConfigDict(populate_by_name=True)

    start: datetime
    end: datetime
    hourly_days: int = Field(alias="hourlyDays")
    buckets: list[RequestTrendBucket]


# RQS-10, ADR-035.
class RequestRecord(BaseModel):
    """One Request: one attempt that reached Telegram.

    `channel` is the Channel's handle, or the handle a probe or Handle check
    asked about. `cause` and `errorCode` are set on a Wasted Request alone.
    `chainId` is the id of the first attempt at the same page. `newPosts` and
    `repeatedPosts` are null where the page carried no Posts. `email` is
    blank for an Account deleted since, and null when no Account is charged.
    """

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: uuid.UUID
    at: datetime
    latency_ms: int = Field(alias="latencyMs")
    kind: str
    charged: bool
    account_id: uuid.UUID | None = Field(alias="accountId")
    email: str | None
    budget: str | None
    best_effort: bool = Field(alias="bestEffort")
    channel: str | None
    lane: str
    page_type: str = Field(alias="pageType")
    outcome: str
    cause: str | None
    error_code: str | None = Field(alias="errorCode")
    attempt: int
    chain_id: uuid.UUID = Field(alias="chainId")
    new_posts: int | None = Field(alias="newPosts")
    repeated_posts: int | None = Field(alias="repeatedPosts")


class RequestRecordsResponse(BaseModel):
    """One page of a Channel's or aggregate row's Requests, newest first.

    `start` is the range's start, moved up to the oldest Request still kept.
    `total` and the outcome counts cover every page.
    """

    model_config = ConfigDict(populate_by_name=True)

    start: datetime
    end: datetime
    total: int
    useful: int
    idle: int
    wasted: int
    records: list[RequestRecord]


class RequestSpreadBucket(BaseModel):
    """Every Request in `[start, end)`, in UTC."""

    start: datetime
    end: datetime
    requests: int


class RequestSpreadResponse(BaseModel):
    """When Requests were made, over everything kept: hours inside the hourly
    totals' span (`hourlyDays`), whole days before. `recordDays` is how far
    back each Request is kept."""

    model_config = ConfigDict(populate_by_name=True)

    record_days: int = Field(alias="recordDays")
    hourly_days: int = Field(alias="hourlyDays")
    buckets: list[RequestSpreadBucket]
