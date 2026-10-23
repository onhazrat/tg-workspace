"""Response models for the unified artifact list.

A discriminated union, not one model with optional per-kind fields. Two existing
schema modules already made that call for the same reason: `discover.py` keeps
`DiscoverCandidateResponse` and `ReportCandidateResponse` separate "because a
declared optional field serialises as an explicit `null` where the key is
absent", and `tag_runs.py` splits light from full "so the list response cannot
accidentally acquire the heavy fields as `null`s".

Here that would mean `messageCount: null, candidateCount: null, status: null,
mode: null` on every summary row — four dead keys per row on a list whose whole
purpose is being small — and a TypeScript type where narrowing by `kind` tells
the compiler nothing.

Every model is **closed**. This is a projection over named columns, not a row
with an `extra` bag, and that is what keeps the unified list on the generated
client rather than the hand-written one (ADR-006).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ZoomRequest
from app.schemas.logs import LogBoundQuery, LogSpreadResponse
from app.schemas.scope import FrozenScope
from app.services.artifacts import DEFAULT_ARTIFACT_PAGE_SIZE, MAX_ARTIFACT_PAGE_SIZE


class ArtifactBase(BaseModel):
    """What every artifact has, whatever it is."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str = ""
    timestamp: int = 0
    model: str | None = None
    post_count: int | None = Field(default=None, alias="postCount")
    is_starred: bool = Field(default=False, alias="isStarred")
    note: str | None = None
    #: The Owner who made the last write, when it was not the account that owns
    #: the row (ticket 27). `null` for almost every artifact, exactly like
    #: `note` and `model` beside it.
    #:
    #: On the base rather than per kind, deliberately: "an Owner wrote this on
    #: your behalf" is a fact about an artifact, and a field only some kinds
    #: carried would be one that narrowing by `kind` tells the caller nothing
    #: about — which is the failure this module's discriminated union exists to
    #: avoid, pointed the other way.
    acted_by_email: str | None = Field(default=None, alias="actedByEmail")
    #: The Scope this artifact was frozen at (AW-06), or `null` on a row a
    #: legacy write door opened without one — the rows that predated the
    #: contract were deleted in AW-07 rather than backfilled.
    #:
    #: On the base, and that is the point of the ticket: History is the one
    #: screen that lists every kind, so it is the one place "Artifact kind does
    #: not change temporal meaning" is either true or visibly false. The
    #: `channels` / `startDate` / `endDate` trio it superseded went in AW-07,
    #: so this is the only thing a History row says about which Posts it read.
    #:
    #: Without its Post refs — see `services/artifacts.py`, which never opens
    #: the column or table they live in. `scopedPostCount` is what says a
    #: selection existed.
    scope: FrozenScope | None = None


class SummaryArtifactResponse(ArtifactBase):
    """`status` is `"pending"` until an externally-run prompt is pasted back,
    `"failed"` while its latest Attempt did not finish, and `"running"` while
    an Attempt is running, whatever the stored status says.

    `autoRegenerate` and `autoPublish` are here rather than left to the Summary
    tab because History is where they are toggled, and reading them out of
    `extra` costs nothing once `isStarred` is already being read.
    """

    kind: Literal["summary"]
    status: str = "complete"
    language: str = "English"
    auto_regenerate: bool = Field(default=False, alias="autoRegenerate")
    auto_publish: bool = Field(default=False, alias="autoPublish")
    #: The Publish target; History's Auto-publish chip shows and sets it.
    publish_bot_id: str | None = Field(default=None, alias="publishBotId")
    publish_chat_id: str | None = Field(default=None, alias="publishChatId")
    #: How many of its Attempts failed (SFR-01); History's "Failed ×n".
    failed_attempts: int = Field(default=0, alias="failedAttempts")


class ChatArtifactResponse(ArtifactBase):
    kind: Literal["chat"]
    message_count: int = Field(default=0, alias="messageCount")
    mode: Literal["full_scope", "semantic"] = "full_scope"
    language: str = "English"


class TagArtifactResponse(ArtifactBase):
    kind: Literal["tag"]
    status: str = "pending"
    mode: str = "add"


class DiscoveryArtifactResponse(ArtifactBase):
    kind: Literal["discovery"]
    candidate_count: int = Field(default=0, alias="candidateCount")


#: FastAPI emits `oneOf` plus a `discriminator.mapping` for this, which
#: `@hey-api/openapi-ts` turns into a real TypeScript discriminated union.
ArtifactListItemResponse = Annotated[
    SummaryArtifactResponse
    | ChatArtifactResponse
    | TagArtifactResponse
    | DiscoveryArtifactResponse,
    Field(discriminator="kind"),
]


ArtifactKind = Literal["summary", "chat", "tag", "discovery"]
ArtifactStatus = Literal["failed", "pending"]
#: What the time filter bounds: Written, or overlap with the Analysis window.
ArtifactMoment = Literal["written", "window"]


class ArtifactFilterQuery(BaseModel):
    """History's filters, shared by the list, the counts and the spread."""

    kind: ArtifactKind | None = None
    search: str | None = None
    starred: bool = False
    status: ArtifactStatus | None = None
    moment: ArtifactMoment = Field(
        "written",
        description="What the Time bound bounds: Written, or the Analysis window",
    )


# One model per route, because FastAPI reads a model's fields as query
# parameters only when it is the route's sole query parameter.
class ArtifactCountsQuery(ArtifactFilterQuery, LogBoundQuery):
    """The filters and the Time bound, as the Logs list takes it."""


class ArtifactPageQuery(ArtifactCountsQuery):
    """One page, sorted on Written or the window's start, newest first."""

    sort: Literal["written", "window"] = "written"
    descending: bool = True
    limit: int = Field(DEFAULT_ARTIFACT_PAGE_SIZE, ge=1, le=MAX_ARTIFACT_PAGE_SIZE)
    offset: int = Field(0, ge=0)


class ArtifactSpreadQuery(ArtifactFilterQuery, ZoomRequest):
    """The filters without the Time bound, zoomed by `lo` and `hi`."""


# Closed, and no field carries a default, so every one is required in the
# generated client.
class ArtifactKindCountsResponse(BaseModel):
    summary: int
    chat: int
    tag: int
    discovery: int


class ArtifactStatusCountsResponse(BaseModel):
    failed: int
    pending: int


class ArtifactCountsResponse(BaseModel):
    """The total under every filter; each Kind under every filter but Kind,
    each Status under every filter but Status."""

    model_config = ConfigDict(populate_by_name=True)

    total: int
    kinds: ArtifactKindCountsResponse
    kinds_all: int = Field(alias="kindsAll")
    statuses: ArtifactStatusCountsResponse
    statuses_all: int = Field(alias="statusesAll")


class ArtifactSpreadResponse(LogSpreadResponse):
    """When Artifacts were Written, or their windows started: the Logs spread's
    shape, so the same chart draws it."""
