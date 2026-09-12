"""One resolver turns a stated Analysis window into the pair Posts are selected
by (AW-02, ADR-018).

`post_filters.analysis_window_clauses` is the only place the comparison is
*written*; this is the only place the two numbers are *decided*. They are
separate jobs and both need exactly one home: AW-01 found five copies of the
comparison, and the same Scope meant five slightly different things.

**Live resolves against the start of the server's current minute, not "now".**
A zero-gap end at 14:32:47 would include the 47 seconds of a minute that is
still happening, so two requests a second apart would select different Posts
while both reporting "the last 24 hours". Flooring makes the answer stable for
the whole minute, and makes the Live refresh timer's boundary the same instant
the server would have picked anyway.

**Nothing here repairs a bad window.** A crossed pair is refused rather than
swapped and an end past the current minute is refused rather than clamped,
because the defect ADR-018 was written against is an editor that silently
made time choices nobody requested. Doing it server-side instead would be the
same defect one layer down, with the added twist that the value on screen is
then not the value used.

Flooring Fixed bounds to the minute is the one exception, and it is not a
repair: minute precision is the contract the editor presents, so an end shown
as 02:00 must be the instant 02:00:00.000 and not 02:00 plus whatever seconds
a client's clock contributed.

A pure transform, and deliberately so — it takes `now_ms` rather than reading a
clock through a `Session` or a settings lookup, which is what lets the boundary
cases above be asserted at an exact instant instead of near one.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from fastapi import HTTPException

from app.schemas.analysis_window import (
    AnalysisWindowInput,
    FixedAnalysisWindow,
    LiveAnalysisWindow,
)

MINUTE_MS = 60_000


@dataclass(frozen=True)
class ResolvedWindow:
    """Exact half-open bounds in epoch milliseconds; `None` is that side open.

    Both sides are open only when the caller sent no window at all — the
    export, lookup and language-detection reads, which are newest-first passes
    over the corpus rather than a Scope anybody selected.
    """

    start: int | None
    end: int | None


def server_now_ms() -> int:
    """The server's clock, in epoch milliseconds."""
    return int(time.time() * 1000)


def current_minute_start(at_ms: int | None = None) -> int:
    """The instant the server's current minute began.

    Floor division rather than truncation, so a pre-epoch instant floors
    backwards too. Nothing in the corpus is pre-epoch, but a truncating version
    would be wrong in a way that only shows up in a timezone-shifted test
    fixture months later.
    """
    value = server_now_ms() if at_ms is None else at_ms
    return value - value % MINUTE_MS


def resolve_analysis_window(
    window: AnalysisWindowInput | None, *, now_ms: int | None = None
) -> ResolvedWindow:
    """Resolve a stated window into exact bounds, refusing an impossible one.

    Callable from a service, not only from a route dependency: AW-05 reuses it
    to freeze an Artifact's Scope at submission, which happens well after the
    request that asked for it has been parsed.
    """
    if window is None:
        return ResolvedWindow(start=None, end=None)

    minute = current_minute_start(now_ms)

    if isinstance(window, LiveAnalysisWindow):
        end = minute - window.end_gap_minutes * MINUTE_MS
        return ResolvedWindow(start=end - window.duration_minutes * MINUTE_MS, end=end)

    return _resolve_fixed(window, minute)


def _resolve_fixed(window: FixedAnalysisWindow, minute: int) -> ResolvedWindow:
    start = current_minute_start(window.start)
    end = current_minute_start(window.end)

    if end > minute:
        raise HTTPException(
            status_code=422,
            detail=(
                "The Analysis window ends in the future. Move the end back to "
                "the current minute or earlier."
            ),
        )
    if start >= end:
        raise HTTPException(
            status_code=422,
            detail=(
                "The Analysis window must start at least one minute before it ends."
            ),
        )
    return ResolvedWindow(start=start, end=end)
