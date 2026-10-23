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
