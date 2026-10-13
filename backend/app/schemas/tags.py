"""Wire models for the Account's Tags as a whole (DFP-04, ADR-029).

A Tag is addressed by name, in the body or the query, never in the path: a
name may hold a "/" or anything else, and has no length cap.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

#: As many handles as a Directory view's Ticks can be.
MAX_TAG_HANDLES = 10_000

TagName = Annotated[str, Field(min_length=1)]
Handle = Annotated[str, Field(min_length=1, max_length=256)]


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("A Tag needs a name")
    return value.strip()


class TagResponse(BaseModel):
    """One of the Account's Tags, as first written, and how many Channels carry it."""

    name: str
    channels: int


class TagHandlesResponse(BaseModel):
    """The handles carrying a Tag; none for a Tag the Account does not have."""

    name: str
    handles: list[str]


class TagChangeResponse(BaseModel):
    """How many Channels a Tag change reached."""

    changed: int


class TagHandlesRequest(BaseModel):
    """One Tag and the handles, followed or not, to put it on or take it off."""

    model_config = ConfigDict(extra="forbid")

    name: TagName
    handles: list[Handle] = Field(min_length=1, max_length=MAX_TAG_HANDLES)

    _name = field_validator("name")(_not_blank)


class TagRenameRequest(BaseModel):
    """Rename a Tag on every Channel; onto a name the Account has, the two merge."""

    model_config = ConfigDict(extra="forbid")

    name: TagName
    to: TagName

    _names = field_validator("name", "to")(_not_blank)


class TagDeleteRequest(BaseModel):
    """Take a Tag off every Channel."""

    model_config = ConfigDict(extra="forbid")

    name: TagName

    _name = field_validator("name")(_not_blank)
