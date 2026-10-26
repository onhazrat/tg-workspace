"""Mutation-check guards: break each rule, run its test, and expect red.

    python3 scripts/mutate.py mutations.json [changed paths...]

`mutations.json` is a list of `{"name", "file", "old", "new", "test"}`: in
`file`, replace `old` (which must occur exactly once) with `new`, run the one
`test` file, then write `file` back as it was. `test` is repo-relative; a
`frontend/` test runs under `bun test`, a `backend/` one under pytest.

Given changed paths, it replays only the mutations whose `file` or `test` is
one of them, or all of them when the list itself changed: the pre-commit hook
replays `docs/agents/guard-mutations.json` this way, so a commit that edits a
guard or the code it guards proves the guard still goes red. A mutation whose
`old` text is gone fails too, so a refactor that moves a guarded line has to
update its mutation in the same diff.

It ends with the `Mutation-checked:` line for the commit body when every
mutation went red, and exits 1 when one stayed green or named no single place.
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


def selected(
    mutations: list[dict[str, str]], registry: str, changed: list[str]
) -> list[dict[str, str]]:
    """The mutations a change touches; all of them with no list or a new registry."""
    if not changed or registry in changed:
        return mutations
    return [m for m in mutations if m["file"] in changed or m["test"] in changed]


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write(__doc__ or "")
        return 2
    registry = Path(argv[1]).resolve().relative_to(REPO).as_posix()
    every = json.loads((REPO / registry).read_text(encoding="utf-8"))
    mutations = selected(every, registry, argv[2:])
    red: list[str] = []
    failed = False
    for m in mutations:
        path = REPO / m["file"]
        original = path.read_text(encoding="utf-8")
        try:
            text = mutated(original, m["old"], m["new"])
            cmd, cwd = command(m["test"])
        except ValueError as error:
            print(f"SKIPPED  {m['name']}: {error}")
            failed = True
            continue
        path.write_text(text, encoding="utf-8")
        try:
            result = subprocess.run(cmd, cwd=REPO / cwd, capture_output=True)
        finally:
            path.write_text(original, encoding="utf-8")
        if result.returncode:
            print(f"red      {m['name']}")
            red.append(m["name"])
        else:
            print(f"GREEN    {m['name']}: the test passed with the rule broken")
            failed = True
    if mutations and not failed:
        print(f"\nMutation-checked: {'; '.join(red)} went red")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
