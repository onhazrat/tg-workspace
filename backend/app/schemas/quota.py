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
    #: Which of this account's ceilings an Admin lifted for this day (ticket
    #: 24). Beside the spend rather than behind a second request, because "this
    #: account is past its ceiling" and "somebody let it through anyway" are one
    #: question when an Admin is looking at why work is still running.
    auto_sync_lifted: bool = Field(default=False, alias="autoSyncLifted")
    manual_bulk_lifted: bool = Field(default=False, alias="manualBulkLifted")
    manual_single_lifted: bool = Field(default=False, alias="manualSingleLifted")


class QuotaUsageResponse(BaseModel):
    """One day of the ledger, across every account that spent something.

    `day` is echoed back because the request may omit it and mean "today", and
    a page that renders yesterday's numbers under today's heading — after a UTC
    midnight rollover mid-session — would be wrong in the least visible way.
    """

    model_config = ConfigDict(populate_by_name=True)

    day: date
    entries: list[QuotaUsageEntry] = Field(default_factory=list)


class BudgetLimitsPayload(BaseModel):
    """One Budget's two numbers, as an Admin sets them or a User reads them.

    `null` means unlimited on the wire, which is what a negative setting
    resolves to — the negative spelling is the `.env` escape hatch and does not
    leave the backend. A number of zero is a real limit and is sent as zero.
    """

    model_config = ConfigDict(populate_by_name=True)

    budget: str
    allowance: int | None = None
    ceiling: int | None = None


class MyBudgetUsage(BudgetLimitsPayload):
    """What the calling account has spent on one Budget today, and what follows.

    `status` is computed on the server rather than derived in the browser from
    the three numbers beside it. The derivation is three comparisons with two
    different meanings for zero, and a browser that got one of them wrong would
    show "you are blocked" to somebody whose work is running — the failure the
    ticket's fifth checkbox exists to prevent, moved to the other side of the
    wire.
    """

    #: All three are **required, with no default**, unlike the two limits above.
    #: A default here would be a lie the wire cannot distinguish from an answer:
    #: OpenAPI marks a defaulted field optional, so the generated TypeScript
    #: would make `status` `string | undefined` and every reader would have to
    #: invent a fallback — and the only sane fallback is `"normal"`, which is
    #: "your work is running" shown to an account whose work has stopped. The
    #: route computes all three for every Budget on every call.
    spent: int
    #: `normal`, `degraded` (best-effort tier) or `blocked` (nothing runs).
    status: str
    #: An Admin lifted the ceiling for this account, this Budget, today.
    lifted: bool


class MyQuotaResponse(BaseModel):
    """The calling account's three Budgets for one UTC day.

    All three are always present, even untouched: the panel renders three rows
    and an absent Budget there reads as a bug rather than as a zero.
    """

    model_config = ConfigDict(populate_by_name=True)

    day: date
    budgets: list[MyBudgetUsage] = Field(default_factory=list)


class QuotaLimitOverride(BudgetLimitsPayload):
    """One account's override of one Budget."""

    model_config = ConfigDict(populate_by_name=True)

    user_id: uuid.UUID = Field(alias="userId")
    email: str = ""


class QuotaLimitsResponse(BaseModel):
    """Everything an Admin needs to set limits: the defaults and every override.

    One response rather than two endpoints, because the browser cannot render an
    override without the default it overrides — a blank field has to say what
    number it inherits, and fetching that separately means a screen that is
    briefly wrong.
    """

    model_config = ConfigDict(populate_by_name=True)

    #: The numbers actually in force, `config.py` fallback included. What a
    #: form shows as *placeholder* text.
    defaults: list[BudgetLimitsPayload] = Field(default_factory=list)
    #: What the Admin has explicitly stored in the `quota` settings row, with
    #: `null` for "never set". What a form shows as the input *value*.
    #:
    #: **Sent separately from `defaults`, and that is not redundancy.** With
    #: only the resolved numbers, a form seeds every box with the shipped value
    #: and the first save writes all six into the settings row — after which
    #: `QUOTA_DEFAULT_*` in `.env` is silently dead for that deployment and the
    #: form's own "leave it empty to inherit" is unreachable, because no box is
    #: ever empty. Two fields is how a blank box stays sayable.
    stored_defaults: list[BudgetLimitsPayload] = Field(
        default_factory=list, alias="storedDefaults"
    )
    overrides: list[QuotaLimitOverride] = Field(default_factory=list)


class SetQuotaLimitsRequest(BaseModel):
    """An Admin setting one account's overrides, or the deployment's defaults.

    Every field of every entry is optional and `null` is meaningful: it puts
    that half back on the layer underneath. There is no other way to say "stop
    overriding this", and a sentinel number would collide with the negative that
    already means unlimited.

    A Budget the body omits is left alone, so a screen that edits one row does
    not have to send the other two back to keep them.
    """

    model_config = ConfigDict(populate_by_name=True)

    budgets: list[BudgetLimitsPayload] = Field(default_factory=list)


class LiftCeilingRequest(BaseModel):
    """Lift (or restore) this account's ceilings for the current UTC day.

    `budgets` empty means all three, which is what an Admin unblocking somebody
    in a hurry means. The day is not a parameter: a lift is for today, because
    lifting a ceiling on a day that is already over changes nothing and lifting
    one in advance is a limit change rather than a lift.
    """

    model_config = ConfigDict(populate_by_name=True)

    budgets: list[str] = Field(default_factory=list)
    lifted: bool = True
