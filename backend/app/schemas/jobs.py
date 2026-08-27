"""Request and response models for the scheduler job endpoints.

Reworked under B6 of `docs/architecture-simplification-plan.md`.

## Why `JobsStatusResponse` was deleted rather than used

The module previously declared a `JobsStatusResponse` with one field per job.
It was never referenced by any route, and wiring it up would have introduced two
bugs:

1. **It listed five jobs; `JOB_IDS` has six.** `discover_probe` was missing, so
   using it would have silently dropped that job from `GET /jobs/status` — and
   the same would happen to every job added afterwards, because a closed model
   drops what it does not declare.
2. **Its keys are job ids, not columns**, so they are snake_case
   (`auto_sync`) against a codebase whose wire format is camelCase. That is
   correct — the frontend reads `status.auto_sync?.pauseUntil` — but it made the
   alias guard in `tests/api/test_schema_aliases.py` need three exemptions to
   describe a model nothing used.

`GET /jobs/status` is now `dict[str, JobStatusEntry]`, which is the shape it
always had: a mapping keyed by job id. Any job in `JOB_IDS` flows through, so
adding a seventh cannot silently disappear. It renders in OpenAPI as
`additionalProperties: {$ref}` — genuinely typed, though the plan's §6 metric
does not count it (blind spot #1, recorded there).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class JobStatusEntry(BaseModel):
    """The scheduler's view of one job.

    Five keys are always present. Two more are **conditional** and therefore
    undeclared, travelling through `extra` exactly as they do today:

    * `detail` — set by `_mark_ok` only when a run reported something.
    * `pauseUntil` — set only on `auto_sync`, and only while a pause is active.

    Declaring either would emit `"detail": null` / `"pauseUntil": null` on every
    other job and every other run, which is the trap B1 established the rule
    against.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    enabled: bool = True
    last_run: int | None = Field(default=None, alias="lastRun")
    last_status: str = Field(default="idle", alias="lastStatus")
    last_error: str | None = Field(default=None, alias="lastError")
    next_run: int | None = Field(default=None, alias="nextRun")


class UpdateJobRequest(BaseModel):
    enabled: bool


class SyncLaneEntry(BaseModel):
    """One of the six sync lanes, as an Admin sees it (ticket 12)."""

    model_config = ConfigDict(populate_by_name=True)

    lane: str
    budget: str
    tier: str
    queued: int
    paused: bool


class SyncLaneListResponse(BaseModel):
    """Every lane, in drain order.

    A list rather than a mapping keyed by lane, because the *order* is part of
    the answer: it is the order the worker serves them in, and a JSON object
    would leave that to whatever the client does with key order.
    """

    lanes: list[SyncLaneEntry]


class DrainLaneResponse(BaseModel):
    """What purging a lane did.

    `jobsCancelled` is not a detail: purging some of a job's messages leaves the
    rest of its Channels unable to finish it, so a drain cancels the jobs it
    orphans. An operator seeing a number here is seeing syncs that stopped.
    """

    model_config = ConfigDict(populate_by_name=True)

    lane: str
    archived: int
    jobs_cancelled: int = Field(alias="jobsCancelled")
