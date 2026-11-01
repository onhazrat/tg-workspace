"""Fail a commit that adds a word GLOSSARY.md rejects in code.

A glossary term may carry a `_Checked_:` line after its `_Avoid_:` line,
naming the avoided words that mean nothing else in this codebase. Most avoided
words are ordinary English elsewhere ("stale", "excluded") and stay with the
reviewer; only the checked ones fail a commit. A word matches in any identifier
style: `LAGGING`, `isLagging` and `is_lagging` all hold "lagging". Only lines
the staged diff adds under `backend/` or `frontend/` are read.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

GLOSSARY = Path(__file__).resolve().parents[1] / "GLOSSARY.md"
CODE = re.compile(r"^(backend|frontend)/")
SKIPPED = re.compile(
    r"^(frontend/src/client/|frontend/openapi\.json$|backend/tests/fixtures/live/"
    r"|.*\.generated\.json$)"
)
_TERM = re.compile(r"^\*\*(.+?)\*\*")
_CHECKED = re.compile(r"^_Checked_:\s*(.+)$")
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
_WORD = re.compile(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+")


def words(text: str) -> str:
    """`text` as lower-case words split at case changes and punctuation."""
    return " ".join(w.lower() for w in _WORD.findall(text))


def checked(glossary: str) -> dict[str, str]:
    """Each checked phrase, as words, and the first term that rejects it."""
    found: dict[str, str] = {}
    term = ""
    for line in glossary.splitlines():
        if heading := _TERM.match(line):
            term = heading.group(1)
        elif listed := _CHECKED.match(line):
            for phrase in listed.group(1).split(","):
                found.setdefault(words(phrase), term)
    return found


def offenders(diff: str, phrases: dict[str, str]) -> list[str]:
    """`path:line: "phrase" (say Term)` for each added line holding a phrase."""
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
            if path and CODE.match(path) and not SKIPPED.match(path):
                said = f" {words(row[1:])} "
                found += [
                    f'{path}:{line}: "{phrase}" (say {term})'
                    for phrase, term in phrases.items()
                    if f" {phrase} " in said
                ]
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
    found = offenders(diff, checked(GLOSSARY.read_text()))
    for entry in found:
        sys.stderr.write(f"error: {entry}\n")
    if found:
        sys.stderr.write("GLOSSARY.md avoids these words; use its term.\n")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
