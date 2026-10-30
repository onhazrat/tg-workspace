"""The Complete window check's request and answer (ADR-043).

Docstrings stay to one line: each ships as a schema description in the
generated client. The reasoning lives in `services/window_check.py`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.analysis_window import AnalysisWindowInput

#: The closed set, in the order a person reads them when several apply.
Reason = Literal[
    "skipped",
    "failed",
    "timed_out",
    "refused",
    "end",
    "hole",
    "start",
    "retention",
    "frozen",
    "unavailable",
]
StretchKind = Literal["end", "hole", "start"]


class WindowCheckRequest(BaseModel):
    """A Scope's Channels and its Analysis window."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    channel_names: list[str] = Field(alias="channelNames")
    window: AnalysisWindowInput


class UnprovenStretch(BaseModel):
    """A part of the window a Channel cannot vouch for, `[from, to]` in epoch ms."""

    model_config = ConfigDict(populate_by_name=True)

    kind: StretchKind
    from_: int = Field(alias="from")
    to: int


class ChannelVerdict(BaseModel):
    """One Channel's answer: why it is Incomplete, if it is, and by how much."""

    model_config = ConfigDict(populate_by_name=True)

    name: str
    reasons: list[Reason]
    reason: Reason | None
    last_sync: int | None = Field(alias="lastSync")
    head_read_at: int | None = Field(alias="headReadAt")
    error: str | None
    stretches: list[UnprovenStretch]
    missing_ids: int = Field(alias="missingIds")
    syncable: bool
    behind: bool
    pace_per_hour: float | None = Field(alias="pacePerHour")
    held_posts: int = Field(alias="heldPosts")
    unproven_posts: float = Field(alias="unprovenPosts")


class WindowCheckResponse(BaseModel):
    """Every Channel's verdict for the window, read up to `end`."""

    model_config = ConfigDict(populate_by_name=True)

    frozen_at: int = Field(alias="frozenAt")
    start: int
    end: int
    channels: list[ChannelVerdict]
    held_posts: int = Field(alias="heldPosts")
    unproven_posts: int = Field(alias="unprovenPosts")
    unproven_floor: bool = Field(alias="unprovenFloor")
