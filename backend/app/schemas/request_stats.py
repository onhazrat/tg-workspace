"""Response models for the Requests endpoints (RQS-01, ADR-035)."""

from __future__ import annotations

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


class RequestBreakdownResponse(BaseModel):
    """Totals by kind and by Channel for one range, in UTC."""

    model_config = ConfigDict(populate_by_name=True)

    start: datetime
    end: datetime
    by_kind: list[RequestTotals] = Field(alias="byKind")
    by_channel: list[ChannelRequestTotals] = Field(alias="byChannel")
