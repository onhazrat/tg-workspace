"""Fail a commit that touches a guard without saying how it was seen red.

A guard is any path in the first column of the table in
`docs/agents/architecture-guards.md`. Root `CLAUDE.md` asks for every guard to
be mutation-tested and for the `Mutation-checked:` line `scripts/mutate.py`
prints to go in the commit body, because a mutation leaves no diff. Runs at
commit-msg with the message file as its argument. A merge, cherry-pick or
revert brings guards in as they were already checked, so it passes.
"""

from __future__ import annotations

import re
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

GUARDS = Path(__file__).resolve().parents[1] / "docs/agents/architecture-guards.md"
_ROW = re.compile(r"^\| (.+?) \|")
_PATH = re.compile(r"`([^`\s]+/[^`\s]+\.[a-z]+)`")
_SAID = re.compile(r"^Mutation-checked:", re.MULTILINE)
_REPLAYS = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD")


def guards(doc: str) -> list[str]:
    """The paths, globs included, named in each table row's first cell."""
    return [
        path
        for line in doc.splitlines()
        if (row := _ROW.match(line))
        for path in _PATH.findall(row.group(1))
    ]


def touched(staged: list[str], patterns: list[str]) -> list[str]:
    """The staged paths that are guards."""
    return [path for path in staged if any(fnmatch(path, p) for p in patterns)]


def _git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main(argv: list[str]) -> int:
    if _SAID.search(Path(argv[0]).read_text()):
        return 0
    if any(
        _git("rev-parse", "-q", "--verify", ref).returncode == 0 for ref in _REPLAYS
    ):
        return 0
    staged = _git("diff", "--cached", "--name-only", "--diff-filter=AMR").stdout.split()
    found = touched(staged, guards(GUARDS.read_text()))
    for path in found:
        sys.stderr.write(f"error: {path} is a guard\n")
    if found:
        sys.stderr.write(
            "Mutation-test it (python3 scripts/mutate.py <mutations.json>) and put the"
            " Mutation-checked: line it prints in the commit body.\n"
        )
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
