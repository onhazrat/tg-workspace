"""`CLAUDE.md` is an index of invariants, and it stays one.

Every byte of the root `CLAUDE.md` is loaded into every agent session before a
single question is asked, so its size is a cost paid on work that never touches
the subsystem being described. It reached **151 KB** (23,121 words, ~38k tokens)
on 2026-09-02, having grown 22x in six weeks, and 81% of that was a single
"Backend architecture" section arguing for its own rules at length.

The argument was not wrong. It was in the wrong file, and it was the third copy
of itself: `app/services/tenancy.py` opens with the same reasoning at 644 lines,
and `tests/services/test_tenancy_seam.py` opens with a better-organised version
again. So the file was cut to a **claim plus the pointer to what enforces it**,
with the long-form text archived in `docs/agents/architecture-rationale.md`.

Nothing evicted, so it grew. This is the eviction step.

## What is asserted

* **A budget.** Lines and bytes, both ceilings. A budget nobody checks is a
  preference, and the preference lost every week for six weeks.
* **Every path it cites resolves.** The whole design rests on the pointer being
  good. A claim whose enforcing test has been renamed is worse than no claim:
  it reads as authority and leads nowhere.
* **Every `Enforced:` pointer in the prose is a row in the guard table**, and
  every row's file exists. The table is the lookup index for the same facts the
  prose states inline, and the two drifting apart is how the table stops being
  trustworthy without ever becoming visibly wrong.

## Watched to fail

Per `CLAUDE.md`, each assertion here was mutation-tested:

* raise the budget by one line, or paste back a paragraph -> the budget test fails
* rename a cited test file -> the path test fails
* add an `*Enforced: ...*` marker with no table row -> the coverage test fails
* delete a table row whose file is still cited -> the coverage test fails
* list one guard twice -> the duplicate test fails

## Raising the budget

The ceilings sit deliberately close to the current size, so growth is a decision
rather than a drift. If a new invariant genuinely needs a line, take one back
from an invariant that has since been enforced in code, or move the reasoning to
the enforcing test's docstring where it belongs. Raising the numbers is the last
option, not the first, and doing it should feel like the argument it is.
"""

from __future__ import annotations

import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
CLAUDE_MD = REPO_ROOT / "CLAUDE.md"

# Sized against the 2026-09-02 cut (250 lines, 41,458 bytes) with a little room
# for a genuinely new invariant. See "Raising the budget" above before touching
# these: the point of a ceiling is that it is reached and argued about.
MAX_LINES = 275
MAX_BYTES = 48_000

# A backticked path naming something in the repo. Globs fall outside the
# character class, so `test_*_projection.py` is skipped rather than failing.
_CITED_PATH = re.compile(
    r"`((?:backend|frontend|docs|scripts)/[A-Za-z0-9_./-]+\.[a-z]{2,4})`"
)

# The `*Enforced: `a.py`, `b.py`.*` markers carrying each claim's pointer.
_ENFORCED_BLOCK = re.compile(r"\*Enforced[^*]*\*")
_ENFORCED_PATH = re.compile(r"`([A-Za-z0-9_./-]+\.py)`")

# A row of the guard table: `| <guard> | <what it enforces> | <kind> |`.
_TABLE_ROW = re.compile(
    r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(compile error|test|hook)\s*\|$"
)
_ANY_PATH = re.compile(r"`([A-Za-z0-9_./*-]+\.[a-z]{2,4})`")


@pytest.fixture(scope="module")
def claude_md() -> str:
    return CLAUDE_MD.read_text(encoding="utf-8")


def _guard_table_paths(text: str) -> list[str]:
    """Every file named in the first column of the architecture-guards table."""
    found: list[str] = []
    for line in text.splitlines():
        row = _TABLE_ROW.match(line)
        if row is not None:
            found.extend(_ANY_PATH.findall(row.group(1)))
    return found


def _normalise(path: str) -> str:
    """Prose cites `tests/api/x.py`; the table cites `backend/tests/api/x.py`."""
    if path.startswith(("backend/", "frontend/", "docs/", "scripts/")):
        return path
    return f"backend/{path}"


def test_the_file_stays_within_its_line_and_byte_budget(claude_md: str) -> None:
    """The eviction step. Growth has to be argued for, not accumulated."""
    lines = len(claude_md.splitlines())
    size = len(claude_md.encode("utf-8"))
    assert lines <= MAX_LINES, (
        f"CLAUDE.md is {lines} lines, over the {MAX_LINES}-line budget. "
        "Move the reasoning into the enforcing test's docstring, or take a line "
        "back from an invariant that no longer needs one. Read this module's "
        "docstring before raising the ceiling."
    )
    assert size <= MAX_BYTES, (
        f"CLAUDE.md is {size:,} bytes, over the {MAX_BYTES:,}-byte budget. "
        "Every byte here is loaded into every session, including the ones that "
        "never touch the subsystem being described."
    )


def test_every_path_it_cites_still_exists(claude_md: str) -> None:
    """A claim whose pointer leads nowhere reads as authority and is not one."""
    missing = sorted(
        {
            path
            for path in _CITED_PATH.findall(claude_md)
            if not (REPO_ROOT / path).exists()
        }
    )
    assert not missing, (
        "CLAUDE.md cites paths that do not exist: "
        + ", ".join(missing)
        + ". The file states claims and points at what enforces them, so a moved "
        "file silently turns a rule into a dead end."
    )


def test_every_guard_in_the_table_exists(claude_md: str) -> None:
    """The table is the lookup index; a row pointing at nothing is worse than none."""
    missing = sorted(
        {
            path
            for path in _guard_table_paths(claude_md)
            if "*" not in path and not (REPO_ROOT / path).exists()
        }
    )
    assert not missing, f"Guard table rows point at missing files: {', '.join(missing)}"


def test_every_enforced_pointer_in_the_prose_is_a_row_in_the_guard_table(
    claude_md: str,
) -> None:
    """The prose and the table must name the same guards.

    They state the same facts in two shapes, so drift between them is invisible:
    both halves stay individually plausible while the table quietly stops being
    the inventory it is read as.
    """
    table = set(_guard_table_paths(claude_md))
    cited: set[str] = set()
    for block in _ENFORCED_BLOCK.findall(claude_md):
        cited.update(_normalise(path) for path in _ENFORCED_PATH.findall(block))

    stranded = sorted(path for path in cited if path not in table)
    assert not stranded, (
        "These guards are cited by an *Enforced:* marker but are not rows in the "
        "architecture-guards table: " + ", ".join(stranded)
    )


def test_the_guard_table_lists_each_file_once(claude_md: str) -> None:
    """Two rows for one guard means one of them is about to go stale."""
    seen = _guard_table_paths(claude_md)
    duplicates = sorted({path for path in seen if seen.count(path) > 1})
    assert not duplicates, f"Duplicated guard-table rows: {', '.join(duplicates)}"
