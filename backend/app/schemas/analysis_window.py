"""The Analysis window as a caller states it, and the server's clock (AW-02).

A Scope used to carry two epoch milliseconds the *browser* computed. That made
every selection depend on a clock the server has no view of: a laptop four
minutes fast summarised four minutes of Posts nobody asked for, and the stored
Artifact recorded the skewed pair as though it were the intent.

So a caller states the intent instead and the server resolves it —
`app/services/analysis_window.py` is the one place that does. The two forms are
a discriminated union rather than four optional fields because "Live" and
"Fixed" are different facts, and a shape that can hold both at once is a shape
somebody has to invent a precedence rule for. ADR-018 refuses exactly that: the
mode is chosen, never inferred.

Docstrings here stay to one line each. A model docstring becomes the schema
description in `openapi.json` and a JSDoc block in `src/client/types.gen.ts`,
so the reasoning lives in comments, which do not ship.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

#: 9999-12-31T23:59:59.999Z. An upper bound on every instant and every span,
#: because without one the arithmetic leaves the range PostgreSQL can compare a
#: `bigint` against: a Duration of 10**25 minutes resolves to a start that makes
#: psycopg raise `NumericValueOutOfRange`, and a 500 is the wrong answer to a
#: number a client simply made up. Far past any real corpus, so the only
#: requests it refuses are ones that were never going to work.
MAX_INSTANT_MS = 253_402_300_799_999

#: A century. The same argument as `MAX_INSTANT_MS`, for the elapsed values.
MAX_SPAN_MINUTES = 100 * 365 * 24 * 60


class LiveAnalysisWindow(BaseModel):
    """A window that advances with the server's clock."""

    model_config = ConfigDict(populate_by_name=True)

    mode: Literal["live"]
    # Whole minutes of *elapsed UTC time*, which is what makes a Duration
    # reproducible: `7d` is 168 hours in March and in November alike. Minutes
    # rather than milliseconds because the editor's precision is the minute,
    # and a field that can express 90 seconds invites a window the UI cannot
    # display back.
    #
    # Duration is at least one minute: a zero-width window cannot masquerade as
    # useful work (story 18). The end gap may be zero — that is "ending at the
    # current minute", which needs no dedicated shortcut (story 19).
    duration_minutes: int = Field(alias="durationMinutes", ge=1, le=MAX_SPAN_MINUTES)
    end_gap_minutes: int = Field(alias="endGapMinutes", ge=0, le=MAX_SPAN_MINUTES)


class FixedAnalysisWindow(BaseModel):
    """Two exact UTC instants, in epoch milliseconds, that do not move."""

    model_config = ConfigDict(populate_by_name=True)

    mode: Literal["fixed"]
    start: int = Field(ge=0, le=MAX_INSTANT_MS)
    end: int = Field(ge=0, le=MAX_INSTANT_MS)


#: Either form, told apart by `mode` rather than by which fields are present.
#: Pydantic answers a wrong or missing `mode` with a union-tag error naming
#: both, instead of two sets of "field required" for the branch it guessed.
AnalysisWindowInput = Annotated[
    LiveAnalysisWindow | FixedAnalysisWindow, Field(discriminator="mode")
]


# What a browser measures its clock offset against.
#
# `minuteStart` is derivable from `now`, and it ships anyway: flooring to the
# minute is the rule AW-02 moved server-side, so the client reading it back is
# one fewer place the two can disagree.
#
# Both are for drawing only — previews, labels, timer alignment. Every
# selection is resolved again on the server, so latency can move when a label
# repaints and never which Posts an operation uses.
class ServerTimeResponse(BaseModel):
    """The server's clock: the current instant, and when its minute began."""

    model_config = ConfigDict(populate_by_name=True)

    now: int
    minute_start: int = Field(alias="minuteStart")
