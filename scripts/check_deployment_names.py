"""Fail a commit or a push that adds a line naming a deployment.

The repo is public, and history keeps whatever was pushed even after a later
commit removes it. The names to refuse (domains, host names, addresses, the
prototype role and schema) are themselves the secret, so they live outside the
repo, one Python regex per line, matched case-insensitively; `#` starts a
comment. The file is `$TG_DEPLOYMENT_NAMES`, or
`~/.config/tg-workspace/deployment-names.txt`. Without it the check warns and
passes, because CI has no copy.

At pre-commit it reads the staged diff; at pre-push, every commit being pushed,
which also covers commits built without `git commit` (a `commit-tree`
snapshot). `python3 scripts/check_deployment_names.py <rev-range>` checks a
range by hand.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT = Path.home() / ".config" / "tg-workspace" / "deployment-names.txt"
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
_NO_COMMIT = "0" * 40


def load(path: Path) -> list[re.Pattern[str]]:
    """The deny-list's patterns, comments and blank lines dropped."""
    lines = (raw.strip() for raw in path.read_text().splitlines())
    return [
        re.compile(line, re.IGNORECASE)
        for line in lines
        if line and not line.startswith("#")
    ]


def offenders(diff: str, patterns: list[re.Pattern[str]]) -> list[str]:
    """`path:line` for each added line a pattern matches; never the match itself."""
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
            if path and any(p.search(row[1:]) for p in patterns):
                found.append(f"{path}:{line}")
            line += 1
        elif not row.startswith("-"):
            line += 1
    return found


def _diff_args(argv: list[str]) -> list[str]:
    """What to read: a range given by hand, the commits a push sends, or the index."""
    if argv:
        return [argv[0]]
    to_ref = os.environ.get("PRE_COMMIT_TO_REF")
    if to_ref:
        from_ref = os.environ.get("PRE_COMMIT_FROM_REF", "")
        # A new branch has no remote side: everything since main is new.
        base = from_ref if from_ref and from_ref != _NO_COMMIT else "origin/main"
        return [f"{base}...{to_ref}"]
    return ["--cached"]


def main(argv: list[str]) -> int:
    path = Path(os.environ.get("TG_DEPLOYMENT_NAMES", DEFAULT))
    if not path.exists():
        if not os.environ.get("CI"):
            sys.stderr.write(
                f"warning: no deployment names at {path}; nothing checked\n"
            )
        return 0
    diff = subprocess.run(
        ["git", "diff", "-U0", "--no-color", "--diff-filter=AMR", *_diff_args(argv)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    found = offenders(diff, load(path))
    for entry in found:
        sys.stderr.write(f"error: a deployment name is added at {entry}\n")
    if found:
        sys.stderr.write(
            "Write a placeholder instead (<host>, <api-base>, <schema>).\n"
        )
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
