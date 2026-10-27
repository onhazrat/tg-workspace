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

## The split

By 2026-10-20 the cut file was back at its 48,000-byte ceiling, and the ceiling
was distorting the work: a new guard went unlisted because its row did not fit,
and six other rows were shortened to make room. 83% of the bytes were the
backend's invariants and the guard table, paid for by sessions that touched
neither. So the file became four, each loaded only by the work it governs:

* the root `CLAUDE.md`, loaded every session: layout, commands, conventions, and
  a pointer to each of the other three
* `backend/CLAUDE.md` and `frontend/CLAUDE.md`, which Claude Code loads once a
  session reads a file in that tree
* `docs/agents/architecture-guards.md`, the guard table, reached when a guard
  fails or is about to change

## What is asserted

* **A budget per file.** Lines and bytes, both ceilings. A budget nobody checks
  is a preference, and the preference lost every week for six weeks.
* **The root points at the other three.** A disclosed file nothing names is a
  file only the directory walk finds, and only for Claude Code.
* **Every path they cite resolves.** The whole design rests on the pointer being
  good. A claim whose enforcing test has been renamed is worse than no claim:
  it reads as authority and leads nowhere.
* **Every `Enforced:` pointer in the prose is a row in the guard table**, and
  every row's file exists. The table is the lookup index for the same facts the
  prose states inline, and the two drifting apart is how the table stops being
  trustworthy without ever becoming visibly wrong.

## Watched to fail

Per `CLAUDE.md`, each assertion here was mutation-tested:

* lower a file's budget below its size, or paste back a paragraph -> the budget
  test fails for that file
* delete a pointer from the root -> the pointer test fails
* rename a cited test file -> the path test fails
* add an `*Enforced: ...*` marker with no table row -> the coverage test fails
* delete a table row whose file is still cited -> the coverage test fails
* list one guard twice -> the duplicate test fails
* delete a frontend test row's last mutation -> the mutation coverage test fails

## A row names a file, so a mutation names the guard

A row is one file, and one file holds many guards. PVM-01 added two pins to
`architecture-invariants.test.ts`, which already had a row, so coverage passed
without a new one; PVM-02 then deleted the provider identity assertion from a
file no marker named, and nothing went red until a code review. A guard that is
a sentence in a table can be deleted by a diff that keeps the sentence. So each
frontend test row keeps, in `docs/agents/guard-mutations.json`, the mutations
that must turn it red, and the `guard-mutations` pre-commit hook replays a
guard's mutations whenever a commit touches its file or its test. Backend rows
are not covered yet: their tests need a database, which the hook and CI's
pre-commit job do not have.

## Raising the budget

The ceilings sit deliberately close to the current sizes, so growth is a
decision rather than a drift. If a new invariant genuinely needs a line, take
one back from an invariant that has since been enforced in code, or move the
reasoning to the enforcing test's docstring where it belongs. Raising the
numbers is the last option, not the first, and doing it should feel like the
argument it is. The root's ceiling is the one that matters most: it is the only
file every session pays for.
"""

from __future__ import annotations

import json
import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
ROOT_CLAUDE_MD = "CLAUDE.md"
GUARDS_DOC = "docs/agents/architecture-guards.md"
MUTATIONS = "docs/agents/guard-mutations.json"

# (max lines, max bytes), sized against the 2026-10-20 split (root 97 lines /
# 7,058 bytes, backend 78 / 24,586, frontend 12 / 2,442, guards 97 / 15,164)
# with a little room for a genuinely new invariant. See "Raising the budget"
# above before touching these. Raised on 2026-10-27 for the
# `test_request_accounting.py` guard, which arrived with both files at their
# ceilings and so went unlisted, as the split warned.
BUDGETS: dict[str, tuple[int, int]] = {
    ROOT_CLAUDE_MD: (110, 8_000),
    "backend/CLAUDE.md": (90, 27_100),
    "frontend/CLAUDE.md": (20, 3_000),
    GUARDS_DOC: (115, 17_200),
}

# The files the root must name, so every harness finds them and not only the
# one that walks directories.
DISCLOSED = [path for path in BUDGETS if path != ROOT_CLAUDE_MD]

# A backticked path naming something in the repo. Globs fall outside the
# character class, so `test_*_projection.py` is skipped rather than failing.
_CITED_PATH = re.compile(
    r"`((?:backend|frontend|docs|scripts)/[A-Za-z0-9_./-]+\.[a-z]{2,4})`"
)

# The `*Enforced: `a.py`, `b.py`.*` markers carrying each claim's pointer.
_ENFORCED_BLOCK = re.compile(r"\*Enforced[^*]*\*")
_ENFORCED_PATH = re.compile(r"`([A-Za-z0-9_./-]+\.(?:py|tsx?))`")

# A row of the guard table: `| <guard> | <what it enforces> | <kind> |`.
_TABLE_ROW = re.compile(
    r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(compile error|test|hook)\s*\|$"
)
_ANY_PATH = re.compile(r"`([A-Za-z0-9_./*-]+\.[a-z]{2,4})`")


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def guards_doc() -> str:
    return _read(GUARDS_DOC)


def _guard_table_paths(text: str) -> list[str]:
    """Every file named in the first column of the architecture-guards table."""
    found: list[str] = []
    for line in text.splitlines():
        row = _TABLE_ROW.match(line)
        if row is not None:
            found.extend(_ANY_PATH.findall(row.group(1)))
    return found


def _normalise(path: str) -> str:
    """Prose cites `tests/api/x.py` or `src/x.ts`; the table cites from the root."""
    if path.startswith(("backend/", "frontend/", "docs/", "scripts/")):
        return path
    if path.startswith("src/"):
        return f"frontend/{path}"
    return f"backend/{path}"


@pytest.mark.parametrize("path", list(BUDGETS))
def test_each_file_stays_within_its_line_and_byte_budget(path: str) -> None:
    """The eviction step. Growth has to be argued for, not accumulated."""
    max_lines, max_bytes = BUDGETS[path]
    text = _read(path)
    lines = len(text.splitlines())
    size = len(text.encode("utf-8"))
    assert lines <= max_lines, (
        f"{path} is {lines} lines, over its {max_lines}-line budget. "
        "Move the reasoning into the enforcing test's docstring, or take a line "
        "back from an invariant that no longer needs one. Read this module's "
        "docstring before raising the ceiling."
    )
    assert size <= max_bytes, (
        f"{path} is {size:,} bytes, over its {max_bytes:,}-byte budget. "
        "Every byte is loaded into every session that reaches this file, "
        "including the ones that never touch the subsystem being described."
    )


@pytest.mark.parametrize("path", DISCLOSED)
def test_the_root_points_at_each_disclosed_file(path: str) -> None:
    """Claude Code walks into `backend/` and `frontend/`; nothing else does."""
    assert f"`{path}`" in _read(ROOT_CLAUDE_MD), (
        f"The root CLAUDE.md no longer names `{path}`, so an agent that does not "
        "load nested CLAUDE.md files, or never reads a file in that tree, never "
        "reaches it."
    )


@pytest.mark.parametrize("path", list(BUDGETS))
def test_every_path_it_cites_still_exists(path: str) -> None:
    """A claim whose pointer leads nowhere reads as authority and is not one."""
    missing = sorted(
        {
            cited
            for cited in _CITED_PATH.findall(_read(path))
            if not (REPO_ROOT / cited).exists()
        }
    )
    assert not missing, (
        f"{path} cites paths that do not exist: "
        + ", ".join(missing)
        + ". The file states claims and points at what enforces them, so a moved "
        "file silently turns a rule into a dead end."
    )


def test_every_guard_in_the_table_exists(guards_doc: str) -> None:
    """The table is the lookup index; a row pointing at nothing is worse than none."""
    missing = sorted(
        {
            path
            for path in _guard_table_paths(guards_doc)
            if "*" not in path and not (REPO_ROOT / path).exists()
        }
    )
    assert not missing, f"Guard table rows point at missing files: {', '.join(missing)}"


def test_every_enforced_pointer_in_the_prose_is_a_row_in_the_guard_table(
    guards_doc: str,
) -> None:
    """The prose and the table must name the same guards.

    They state the same facts in two shapes, so drift between them is invisible:
    both halves stay individually plausible while the table quietly stops being
    the inventory it is read as.
    """
    table = set(_guard_table_paths(guards_doc))
    cited: set[str] = set()
    for path in BUDGETS:
        for block in _ENFORCED_BLOCK.findall(_read(path)):
            cited.update(_normalise(p) for p in _ENFORCED_PATH.findall(block))

    stranded = sorted(path for path in cited if path not in table)
    assert not stranded, (
        "These guards are cited by an *Enforced:* marker but are not rows in "
        f"the guard table in {GUARDS_DOC}: " + ", ".join(stranded)
    )


def test_every_frontend_test_row_keeps_a_mutation(guards_doc: str) -> None:
    """A frontend guard is a mutation that goes red, not a row that says so."""
    mutations = json.loads(_read(MUTATIONS))
    tested = {m["test"] for m in mutations}
    rows = set(_guard_table_paths(guards_doc))
    frontend_tests = {
        path for path in rows if path.startswith("frontend/src/") and ".test." in path
    }
    unguarded = sorted(frontend_tests - tested)
    assert not unguarded, (
        f"These frontend guard tests have no mutation in {MUTATIONS}, so a diff "
        "can delete what they assert and stay green: " + ", ".join(unguarded)
    )
    stray = sorted(tested - rows)
    assert not stray, (
        f"{MUTATIONS} replays tests the guard table does not list: " + ", ".join(stray)
    )


def test_the_guard_table_lists_each_file_once(guards_doc: str) -> None:
    """Two rows for one guard means one of them is about to go stale."""
    seen = _guard_table_paths(guards_doc)
    duplicates = sorted({path for path in seen if seen.count(path) > 1})
    assert not duplicates, f"Duplicated guard-table rows: {', '.join(duplicates)}"
