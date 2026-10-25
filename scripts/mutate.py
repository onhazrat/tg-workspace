"""Mutation-check guards: break each rule, run its test, and expect red.

    python3 scripts/mutate.py mutations.json

`mutations.json` is a list of `{"name", "file", "old", "new", "test"}`: in
`file`, replace `old` (which must occur exactly once) with `new`, run the one
`test` file, then restore `file` from git. `test` is repo-relative; a
`frontend/` test runs under `bun test`, a `backend/` one under pytest.

It refuses a tree with uncommitted changes to tracked files, because the
restore is `git checkout -- <file>`, which would throw away work in that file.
Commit first, as `CLAUDE.md` says. It ends with the `Mutation-checked:` line for
the commit body when every mutation went red, and exits 1 when one stayed
green or named no single place.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def command(test: str) -> tuple[list[str], str]:
    """How to run one test file, and the directory to run it from."""
    half, _, rest = test.partition("/")
    if half == "frontend":
        return ["bun", "test", rest], "frontend"
    if half == "backend":
        return ["uv", "run", "pytest", "-q", "-x", rest], "backend"
    raise ValueError(f"{test}: a test lives under frontend/ or backend/")


def mutated(text: str, old: str, new: str) -> str:
    """`text` with its one `old` replaced by `new`."""
    count = text.count(old)
    if count == 0:
        raise ValueError("old text not found")
    if count > 1:
        raise ValueError(f"old text found in {count} places; widen it to one")
    return text.replace(old, new)


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write(__doc__ or "")
        return 2
    if _git("status", "--porcelain", "--untracked-files=no").strip():
        sys.stderr.write("Commit first: the restore would discard uncommitted work.\n")
        return 2
    mutations = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    red: list[str] = []
    failed = False
    for m in mutations:
        path = REPO / m["file"]
        try:
            text = mutated(path.read_text(encoding="utf-8"), m["old"], m["new"])
            cmd, cwd = command(m["test"])
        except ValueError as error:
            print(f"SKIPPED  {m['name']}: {error}")
            failed = True
            continue
        path.write_text(text, encoding="utf-8")
        try:
            result = subprocess.run(cmd, cwd=REPO / cwd, capture_output=True)
        finally:
            _git("checkout", "--", m["file"])
        if result.returncode:
            print(f"red      {m['name']}")
            red.append(m["name"])
        else:
            print(f"GREEN    {m['name']}: the test passed with the rule broken")
            failed = True
    if not failed:
        print(f"\nMutation-checked: {'; '.join(red)} went red")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
