"""Fail when two ADRs claim one number, here or against `origin/main`.

The next ADR number is taken by whichever branch merges first. A branch cut
before another merged its ADR-NNN picks the same NNN, and the clash surfaced
only as a README conflict and a rename through every doc citing it. Compared
with what `origin/main` added since the merge base, it fails at the commit,
as fresh as the last fetch. A renamed ADR keeps its number and is not a clash:
only ADRs both sides *added* are compared.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ADR_DIR = "docs/adr"
_NUMBER = re.compile(r"(?:^|/)ADR-(\d+)-[^/]+\.md$")


def _numbers(names: list[str]) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for name in names:
        if m := _NUMBER.search(name):
            found.setdefault(m[1], []).append(name.rsplit("/", 1)[-1])
    return found


def clashes(
    here: list[str], added_here: list[str], added_on_main: list[str]
) -> list[str]:
    """Each number two ADRs in `here` share, or one both sides added."""
    found = [
        f"ADR-{n}: {', '.join(sorted(names))}"
        for n, names in sorted(_numbers(here).items())
        if len(names) > 1
    ]
    mine, theirs = _numbers(added_here), _numbers(added_on_main)
    found += [
        f"ADR-{n}: {', '.join(mine[n])} here, {', '.join(theirs[n])} on origin/main"
        for n in sorted(mine.keys() & theirs.keys())
    ]
    return found


def _git(*args: str) -> list[str]:
    result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    return result.stdout.splitlines() if result.returncode == 0 else []


def main() -> int:
    here = [p.name for p in (REPO / ADR_DIR).glob("ADR-*.md")]
    base = _git("merge-base", "HEAD", "origin/main")
    added_here = added_on_main = []
    if base:
        added = ("diff", "--name-only", "--diff-filter=A")
        added_here = _git(*added, base[0], "--", ADR_DIR)
        added_here += _git("ls-files", "--others", "--exclude-standard", ADR_DIR)
        added_on_main = _git(*added, base[0], "origin/main", "--", ADR_DIR)
    found = clashes(here, added_here, added_on_main)
    for entry in found:
        sys.stderr.write(f"error: two ADRs claim {entry}\n")
    if found:
        sys.stderr.write("Take the next number free on origin/main (fetch first).\n")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
