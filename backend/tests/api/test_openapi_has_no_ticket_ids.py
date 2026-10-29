"""No ticket id reaches the public API description.

A route handler's docstring becomes its OpenAPI `description`, and a schema
class's docstring becomes its schema `description`; both ship as JSDoc in the
generated client (`frontend/src/client/sdk.gen.ts`, `types.gen.ts`). A ticket
number there is internal bookkeeping published to every consumer, and it rots:
the id means nothing to a reader of the client. The rule was prose and was
broken again by TB-05, so it is a test now.

Keep the id in a `#` comment above the decorator or the class instead; the
comment stays in the source and never reaches the schema.

`TICKET_ID` comes from `scripts/check_client_ticket_ids.py`, the commit hook
that reads the generated client for the same leak in seconds.
Mutation watched: put `(ticket 12)` back into `SyncLaneEntry`'s docstring.
"""

from __future__ import annotations

import importlib.util
import pathlib
from typing import Any

from app.main import app

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[3] / "scripts/check_client_ticket_ids.py"
)
_spec = importlib.util.spec_from_file_location("check_client_ticket_ids", _SCRIPT)
assert _spec is not None and _spec.loader is not None
_hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_hook)
TICKET_ID = _hook.TICKET_ID


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


def test_the_hook_reads_only_comment_lines() -> None:
    """The commit hook flags a JSDoc line and leaves code alone."""
    client = "/**\n * Lists Tags (TGU-02).\n */\nexport type Kind = 'AB-12'\n"
    assert _hook.leaks(client) == [(2, "TGU-02")]
