"""Building a Discover report's frozen Scope in a test (AW-06).

`create_report` used to take the scope as six loose keyword arguments, three of
which (`start_date`, `end_date`, `post_ids`) accepted `None` for "no
restriction". It takes one `FrozenScope` now, because the route freezes the
submission once and hands the same value to the aggregation and to the row — so
two readings of one clock can no longer straddle a minute boundary between them.

That makes "both sides open" inexpressible, deliberately: an Artifact always
covers a window somebody chose, and a corpus walk is not a Scope. Tests that
genuinely do not care about the window say so with `ALL_TIME` rather than with a
`None` that used to mean two different things depending on which argument it was
passed to.
"""

from __future__ import annotations

from typing import Any

from app.schemas.scope import FrozenScope
from tests.utils.scope import stored_scope

#: 2100-01-01, as a window that contains every fixture any test seeds. Not
#: `None`: the point of the frozen contract is that a recorded Scope names two
#: instants, and a test asserting behaviour "over everything" still has to say
#: which everything it means.
ALL_TIME = (0, 4_102_444_800_000)


def report_scope(**overrides: Any) -> FrozenScope:
    """A report's frozen Scope, defaulting to every Post of one carrier."""
    start, end = ALL_TIME
    return FrozenScope.model_validate({"start": start, "end": end, **overrides})


def stored_report_scope(**overrides: Any) -> dict[str, Any]:
    """The same value as the `scope` column holds it (AW-07).

    `tg_discover_reports.scope` is NOT NULL since that ticket — the report
    response declares its Scope required, so a row without one is a 500 rather
    than a readable row — which means a fixture seeding a report directly has to
    state one. It is a helper rather than a literal per test because the
    interesting part of most of those tests is the owner or the timestamp, and a
    hand-written scope dict repeated a dozen times is a dozen chances to drift
    from what `FrozenScope.stored()` actually writes.
    """
    start, end = ALL_TIME
    return stored_scope(start=start, end=end, **overrides)
