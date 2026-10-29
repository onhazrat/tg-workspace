"""Fail a commit whose generated client names a ticket id in its JSDoc.

Route and schema docstrings become OpenAPI descriptions, which the generator
writes as JSDoc into `frontend/src/client/*.gen.ts`.
`backend/tests/api/test_openapi_has_no_ticket_ids.py` guards the same rule,
but it needs Postgres and runs at the end of the backend suite. This reads the
client the `generate-frontend-sdk` hook just wrote, so the leak shows at
commit, in under a second. `TICKET_ID` lives here; the test imports it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CLIENT = REPO / "frontend/src/client"

# `UTF-16` matches the id shape and is a fact about encodings, so it is excused.
TICKET_ID = re.compile(r"\b(?!UTF-)[A-Z]{2,6}-\d{2}\b|(?i:\bticket \d+)")
# JSDoc and line comments: where descriptions land, and nowhere else.
_COMMENT = re.compile(r"^\s*(\*|/\*\*|//)")


def leaks(text: str) -> list[tuple[int, str]]:
    """Each (line number, id) a comment line of `text` names."""
    return [
        (n, m)
        for n, line in enumerate(text.splitlines(), 1)
        if _COMMENT.match(line)
        for m in TICKET_ID.findall(line)
    ]


def main() -> int:
    found = [
        f"{path.relative_to(REPO)}:{n}: {m}"
        for path in sorted(CLIENT.glob("*.gen.ts"))
        for n, m in leaks(path.read_text(encoding="utf-8"))
    ]
    for line in found:
        print(line)
    if found:
        print(
            "ticket ids in the generated client; move each into a `#` comment "
            "above the route or schema class, then run scripts/generate-client.sh"
        )
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
