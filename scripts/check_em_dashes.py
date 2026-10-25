"""Fail a commit that adds an em dash (U+2014) to a line.

The house style writes a period or a comma instead. Only lines the staged diff
adds are read, so the em dashes already in the tree go when somebody next edits
their line, not all at once. Generated files and recorded fixtures are skipped.
"""

from __future__ import annotations

import re
import subprocess
import sys

EM_DASH = chr(0x2014)
SKIPPED = re.compile(
    r"^(frontend/src/client/|frontend/openapi\.json$|backend/tests/fixtures/live/"
    r"|.*\.generated\.json$)"
)
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def offenders(diff: str) -> list[str]:
    """`path:line: text` for each added line holding an em dash."""
    found: list[str] = []
    path: str | None = None
    line = 0
    for row in diff.splitlines():
        if row.startswith("+++ "):
            target = row[4:]
            path = None if target == "/dev/null" else target.removeprefix("b/")
        elif hunk := _HUNK.match(row):
            line = int(hunk.group(1))
        elif row.startswith("+"):
            if path and not SKIPPED.match(path) and EM_DASH in row:
                found.append(f"{path}:{line}: {row[1:].strip()}")
            line += 1
        elif not row.startswith("-"):
            line += 1
    return found


def main() -> int:
    diff = subprocess.run(
        ["git", "diff", "--cached", "-U0", "--no-color", "--diff-filter=AMR"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    found = offenders(diff)
    for entry in found:
        sys.stderr.write(f"error: em dash added at {entry}\n")
    if found:
        sys.stderr.write("Write a period or a comma instead.\n")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
