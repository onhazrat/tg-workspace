"""`scripts/mutate.py`, which mutation-checks a guard: break a rule, watch its test go red.

These pin the two decisions it makes before running anything: which suite a
test file belongs to, and that a mutation names exactly one place.
"""

from __future__ import annotations

import importlib.util
import pathlib

import pytest

_SCRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts/mutate.py"
_spec = importlib.util.spec_from_file_location("mutate", _SCRIPT)
assert _spec is not None and _spec.loader is not None
mutate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mutate)


def test_a_test_runs_in_its_own_half() -> None:
    assert mutate.command("frontend/src/lib/spread.test.ts") == (
        ["bun", "test", "src/lib/spread.test.ts"],
        "frontend",
    )
    assert mutate.command("backend/tests/api/test_x.py") == (
        ["uv", "run", "pytest", "-q", "-x", "tests/api/test_x.py"],
        "backend",
    )
    with pytest.raises(ValueError, match="frontend/ or backend/"):
        mutate.command("scripts/x.py")


def test_a_mutation_names_exactly_one_place() -> None:
    assert mutate.mutated("a < b", "<", "<=") == "a <= b"
    with pytest.raises(ValueError, match="not found"):
        mutate.mutated("a < b", ">", "<")
    with pytest.raises(ValueError, match="2 places"):
        mutate.mutated("a < b < c", "<", "<=")


def test_a_change_replays_the_mutations_it_touches() -> None:
    a = {"name": "a", "file": "frontend/src/a.ts", "test": "frontend/src/a.test.ts"}
    b = {"name": "b", "file": "frontend/src/b.ts", "test": "frontend/src/b.test.ts"}
    registry = "docs/agents/guard-mutations.json"
    assert mutate.selected([a, b], registry, ["frontend/src/a.ts"]) == [a]
    assert mutate.selected([a, b], registry, ["frontend/src/b.test.ts"]) == [b]
    assert mutate.selected([a, b], registry, ["backend/app/main.py"]) == []
    assert mutate.selected([a, b], registry, [registry]) == [a, b]
    assert mutate.selected([a, b], registry, []) == [a, b]
