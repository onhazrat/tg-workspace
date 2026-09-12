"""Building an Artifact's frozen Scope column in a test (AW-07).

That ticket dropped the `channels` / `start_date` / `end_date` trio every
Artifact family carried, so a fixture that seeds a row directly and then expects
the scheduler, the History union or a search to see a window has to write the
`scope` column instead — it is the only copy left.

A helper rather than a literal per test because `FrozenScope.stored()` decides
what the column actually holds (no `posts`, no `durationMinutes`), and a dozen
hand-written dicts is a dozen chances to drift from it.
"""

from __future__ import annotations

from typing import Any

from app.schemas.scope import FrozenScope


def stored_scope(*, start: int, end: int, **overrides: Any) -> dict[str, Any]:
    """The `scope` column's value for a window and any filters."""
    return FrozenScope.model_validate(
        {"start": start, "end": end, **overrides}
    ).stored()
