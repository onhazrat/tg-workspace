"""The commit-msg check that a commit touching a guard says how it went red."""

from __future__ import annotations

import importlib.util
import pathlib

_ROOT = pathlib.Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location(
    "check_mutation_checked", _ROOT / "scripts/check_mutation_checked.py"
)
assert _spec is not None and _spec.loader is not None
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)

DOC = """\
| Guard | Enforces | Kind |
|---|---|---|
| `backend/tests/api/test_route_inventory.py` | routes are mounted, see `backend/app/main.py` | test |
| `backend/tests/api/test_*_projection.py`, `scripts/check_x.py` | key sets | test, hook |
| `CONSTANT_TOPICS` | not a path | test |
"""


def test_guards_are_the_paths_in_each_rows_first_cell() -> None:
    assert hook.guards(DOC) == [
        "backend/tests/api/test_route_inventory.py",
        "backend/tests/api/test_*_projection.py",
        "scripts/check_x.py",
    ]


def test_a_staged_guard_is_found_by_path_or_glob() -> None:
    staged = [
        "backend/app/main.py",
        "backend/tests/api/test_summary_projection.py",
        "scripts/check_x.py",
    ]
    assert hook.touched(staged, hook.guards(DOC)) == staged[1:]


def test_the_real_guard_table_names_its_guards() -> None:
    found = hook.guards((_ROOT / "docs/agents/architecture-guards.md").read_text())
    assert "backend/tests/api/test_route_inventory.py" in found
    assert "scripts/check_mutation_checked.py" in found
