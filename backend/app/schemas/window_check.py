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
    #: The moment an action froze, to read its window as it was then.
    frozen_at: int | None = Field(default=None, alias="frozenAt")


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
    #: When the newest sync still syncing it started, any Account's.
    syncing_since: int | None = Field(default=None, alias="syncingSince")
    #: That sync read its head before E, so another must follow it.
    sync_again: bool = Field(default=False, alias="syncAgain")


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


#: How the gate let the action go on (CW-02): `complete` when nothing was
#: Incomplete, `nothing_to_sync` when no sync could fix what was, `timed_out`
#: when its wait hit the deadline.
GateChoice = Literal[
    "synced",
    "continued_early",
    "timed_out",
    "skipped",
    "complete_only",
    "nothing_to_sync",
    "complete",
]


class GateOutcome(BaseModel):
    """What the person chose in the gate, sent with the Scope the action froze."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    choice: GateChoice
    frozen_at: int = Field(alias="frozenAt")
    skipped: list[str] = Field(default_factory=list)
    timed_out: list[str] = Field(default_factory=list, alias="timedOut")
    left_out: list[str] = Field(default_factory=list, alias="leftOut")


class CompletenessMark(BaseModel):
    """What History's pill shows of an Artifact's window."""

    model_config = ConfigDict(populate_by_name=True)

    unproven_posts: int = Field(alias="unprovenPosts")
    unproven_floor: bool = Field(alias="unprovenFloor")
    fixable: bool
    incomplete_count: int = Field(alias="incompleteCount")
    channel_count: int = Field(alias="channelCount")
    #: The Incomplete Channels by the reason each shows.
    counts: dict[Reason, int] = Field(default_factory=dict)


class Completeness(CompletenessMark):
    """An Artifact's window as it froze: its Incomplete and Left out Channels."""

    choice: GateChoice
    frozen_at: int = Field(alias="frozenAt")
    start: int
    end: int
    held_posts: int = Field(alias="heldPosts")
    channels: list[ChannelVerdict]
    left_out: list[str] = Field(alias="leftOut")
