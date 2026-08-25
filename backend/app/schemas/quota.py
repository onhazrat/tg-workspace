"""Response models for the quota usage endpoints (ticket 08).

Closed and exhaustive, so the generated TypeScript is a real type rather than
the `Record<string, unknown>` an untyped `dict` return would produce. Every
Budget is a declared field rather than a map keyed by Budget name: the set is
closed, the frontend renders one column per Budget, and a map would make each
column an optional lookup the compiler cannot check.
"""

from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class QuotaUsageEntry(BaseModel):
    """What one account spent on one day.

    `total` is sent rather than summed in the browser because it is the column
    the table sorts by, and a sort key computed in two places is a sort key that
    eventually disagrees with itself.
    """

    model_config = ConfigDict(populate_by_name=True)

    user_id: uuid.UUID = Field(alias="userId")
    email: str
    auto_sync: int = Field(default=0, alias="autoSync")
    manual_bulk: int = Field(default=0, alias="manualBulk")
    manual_single: int = Field(default=0, alias="manualSingle")
    total: int = 0


class QuotaUsageResponse(BaseModel):
    """One day of the ledger, across every account that spent something.

    `day` is echoed back because the request may omit it and mean "today", and
    a page that renders yesterday's numbers under today's heading — after a UTC
    midnight rollover mid-session — would be wrong in the least visible way.
    """

    model_config = ConfigDict(populate_by_name=True)

    day: date
    entries: list[QuotaUsageEntry] = Field(default_factory=list)
