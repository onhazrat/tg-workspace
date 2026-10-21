"""No ticket id reaches the public API description.

A route handler's docstring becomes its OpenAPI `description`, and a schema
class's docstring becomes its schema `description`; both ship as JSDoc in the
generated client (`frontend/src/client/sdk.gen.ts`, `types.gen.ts`). A ticket
number there is internal bookkeeping published to every consumer, and it rots:
the id means nothing to a reader of the client. The rule was prose and was
broken again by TB-05, so it is a test now.

Keep the id in a `#` comment above the decorator or the class instead; the
comment stays in the source and never reaches the schema.

`UTF-16` matches the id shape and is a fact about encodings, so it is excused.
Mutation watched: put `(ticket 12)` back into `SyncLaneEntry`'s docstring.
"""

from __future__ import annotations

import re
from typing import Any

from app.main import app

TICKET_ID = re.compile(r"\b(?!UTF-)[A-Z]{2,6}-\d{2}\b|(?i:\bticket \d+)")


def _leaks(node: Any, path: str) -> list[str]:
    found = []
    if isinstance(node, dict):
        for key, value in node.items():
            where = f"{path}/{key}"
            if key in ("description", "summary") and isinstance(value, str):
                found += [f"{where}: {m}" for m in TICKET_ID.findall(value)]
            found += _leaks(value, where)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            found += _leaks(value, f"{path}/{i}")
    return found


def test_no_openapi_description_names_a_ticket() -> None:
    leaks = _leaks(app.openapi(), "")
    assert not leaks, (
        "ticket ids in the public OpenAPI schema; move each into a `#` comment "
        f"above the route or class, then run scripts/generate-client.sh: {leaks}"
    )


def test_the_pattern_catches_both_spellings() -> None:
    """A pattern that matched nothing would pass the guard above."""
    assert TICKET_ID.search("the editor (TB-05)")
    assert TICKET_ID.search("Ticket 24 added it")
    assert not TICKET_ID.search("in UTF-16 code units, per ADR-022")
