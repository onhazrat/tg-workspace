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


class ArtifactBase(BaseModel):
    """What every artifact has, whatever it is."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str = ""
    channels: list[str] = Field(default_factory=list)
    start_date: int = Field(default=0, alias="startDate")
    end_date: int = Field(default=0, alias="endDate")
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


class SummaryArtifactResponse(ArtifactBase):
    """`status` is `"pending"` until an externally-run prompt is pasted back.

    `autoRegenerate` and `autoPublish` are here rather than left to the Summary
    tab because History is where they are toggled, and reading them out of
    `extra` costs nothing once `isStarred` is already being read.
    """

    kind: Literal["summary"]
    status: str = "complete"
    language: str = "English"
    auto_regenerate: bool = Field(default=False, alias="autoRegenerate")
    auto_publish: bool = Field(default=False, alias="autoPublish")


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
