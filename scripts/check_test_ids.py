"""Fail a commit that leaves a Playwright spec naming a test id nothing renders.

The e2e specs under `frontend/tests/` find elements by `getByTestId("...")`.
Renaming an id in `frontend/src` leaves every spec that names it behind, and
nothing notices before CI runs Playwright. This resolves each literal id a
spec names against the app's source, unit tests and snapshots aside: the id is
a quoted string there, or a template given as a test id spells it. A
template's placeholders hold data (a handle, a kind), except a leading one,
which names a prefix (`${testId}-bar-${i}`) that must itself render; else a
renamed prefix would still match. An id the spec builds itself (a variable, a
regex) is the spec's business and is skipped.

The whole tree is read on every run, because the commit that breaks a spec is
the one that renames the id in `frontend/src`.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SPEC = re.compile(r"^frontend/tests/.*\.ts$")
SOURCE = re.compile(r"^frontend/src/(?!client/).*\.tsx?$")
NOT_SOURCE = re.compile(r"\.(test|spec)\.tsx?$|/__snapshots__/")
#: `getByTestId("id")`, in any of the three quotes, with no placeholder.
_ID = re.compile(r"getByTestId\(\s*([\"'`])([^\"'`$]+)\1\s*\)")
#: A template given as a test id: `data-testid={`...`}`, `"data-testid": `...``,
#: or a `testId={`...`}` prop that a component passes on.
_TEMPLATE = re.compile(
    r"(?:data-testid|[A-Za-z]*[Tt]est[Ii]d)\"?\s*[=:]\s*\{?\s*`([^`]+)`"
)
_PLACEHOLDER = re.compile(r"\$\{[^}]*\}")


def _templates(source: str) -> list[re.Pattern[str]]:
    """Each templated test id as a pattern, a group per placeholder."""
    return [
        re.compile("(.+?)".join(re.escape(p) for p in _PLACEHOLDER.split(t)))
        for t in _TEMPLATE.findall(source)
    ]


def _quoted(word: str, source: str) -> bool:
    return any(f"{q}{word}{q}" in source for q in "\"'`")


def offenders(specs: dict[str, str], source: str) -> list[str]:
    """`path:line: id` for each literal id a spec names and the source never renders.

    `specs` maps each spec path to its text; `source` is the app's source, joined.
    """
    templates = _templates(source)

    def renders(test_id: str, depth: int = 0) -> bool:
        if _quoted(test_id, source):
            return True
        for pattern in templates:
            match = pattern.fullmatch(test_id)
            if not match:
                continue
            leads = pattern.pattern.startswith("(.+?)")
            if not leads or (depth < 3 and renders(match.group(1), depth + 1)):
                return True
        return False

    found: list[str] = []
    for path, text in sorted(specs.items()):
        for number, line in enumerate(text.splitlines(), start=1):
            for _, test_id in _ID.findall(line):
                if not renders(test_id):
                    found.append(f"{path}:{number}: {test_id}")
    return found


def main() -> int:
    tracked = subprocess.run(
        ["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    files = [p for p in tracked if (REPO / p).is_file()]

    def read(path: str) -> str:
        return (REPO / path).read_text(encoding="utf-8", errors="replace")

    specs = {p: read(p) for p in files if SPEC.match(p)}
    source = "\n".join(
        read(p) for p in files if SOURCE.match(p) and not NOT_SOURCE.search(p)
    )
    found = offenders(specs, source)
    for entry in found:
        sys.stderr.write(f"error: no element renders the test id at {entry}\n")
    if found:
        sys.stderr.write("Point the spec at the id the app renders now.\n")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
