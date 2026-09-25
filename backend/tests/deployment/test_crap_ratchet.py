"""The CRAP ratchet keeps every function at or below the risk it carries today.

`scripts/crap/ratchet.py` holds the rule and its reasons; this file pins the
rule's edges and the CI wiring it depends on. The wiring is the fragile half. The
backend check only means something against the *combined* coverage of all three
test legs: run inside one leg, two thirds of the backend looks untested and every
function fails as new. And the two workflows only run it if their path filters
name `scripts/crap/**`, or a baseline edit merges without the check ever running
against it.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
from types import ModuleType
from typing import Any

import pytest
import yaml

_ROOT = pathlib.Path(__file__).resolve().parents[3]
_WORKFLOWS = _ROOT / ".github" / "workflows"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "crap_ratchet", _ROOT / "scripts" / "crap" / "ratchet.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ratchet = _load()
BACKEND = {"backend"}
FILE = "backend/app/services/x.py"


def row(
    name: str, cc: int, cov: float, line: int = 1, file: str = FILE
) -> dict[str, Any]:
    return {"file": file, "line": line, "name": name, "cc": cc, "cov": cov}


def entry(score: float, reason: str = "deliberate") -> dict[str, Any]:
    return {"score": score, "reason": reason}


def test_a_new_function_above_the_threshold_fails_with_its_numbers_and_the_fix() -> (
    None
):
    failures, _ = ratchet.check([row("f", 8, 0.0, line=12)], {}, BACKEND)

    assert len(failures) == 1
    message = failures[0]
    assert message.startswith("(a) new")
    for part in (f"{FILE}::f", "line 12", "CRAP 72.0", "cc 8", "coverage 0%"):
        assert part in message
    assert "adding tests" in message and "--update-baseline" in message


def test_a_function_at_the_threshold_passes() -> None:
    # cc 30 fully covered is exactly 30: the threshold is "above", not "at".
    assert ratchet.check([row("f", 30, 1.0)], {}, BACKEND) == ([], [])


def test_a_baseline_function_may_drift_within_the_tolerance_and_not_past_it() -> None:
    base = {f"{FILE}::f": entry(32.0)}
    within = row("f", 32, 1.0)
    one_more_branch = row("f", 33, 1.0)

    assert ratchet.check([within], base, BACKEND) == ([], [])
    failures, _ = ratchet.check([one_more_branch], base, BACKEND)
    assert len(failures) == 1 and failures[0].startswith("(b) rose")
    assert "recorded 32.0" in failures[0]


def test_the_tolerance_is_smaller_than_one_branch() -> None:
    # A new branch adds at least 1.0; a tolerance of 1.0 or more would let a
    # fully covered baseline function grow one unnoticed.
    assert 0 < ratchet.TOLERANCE < 1.0


@pytest.mark.parametrize(
    ("rows", "now"),
    [([row("f", 5, 1.0)], "now scores 5.0"), ([], "no longer exists")],
    ids=["improved", "deleted"],
)
def test_a_baseline_entry_nothing_scores_above_the_threshold_is_stale(
    rows: list[dict[str, Any]], now: str
) -> None:
    failures, _ = ratchet.check(rows, {f"{FILE}::f": entry(40.0)}, BACKEND)

    assert len(failures) == 1 and failures[0].startswith("(c) stale")
    assert now in failures[0]


def test_a_baseline_entry_needs_a_reason() -> None:
    failures, _ = ratchet.check(
        [row("f", 32, 1.0)], {f"{FILE}::f": entry(32.0, reason=" ")}, BACKEND
    )
    assert [f[:3] for f in failures] == ["(d)"]


def test_an_improvement_is_a_note_not_a_failure() -> None:
    failures, notices = ratchet.check(
        [row("f", 31, 1.0)], {f"{FILE}::f": entry(40.0)}, BACKEND
    )
    assert failures == [] and len(notices) == 1


def test_one_side_never_judges_the_other_sides_entries() -> None:
    fe = "frontend/src/a.ts::g"
    assert ratchet.check([], {fe: entry(40.0)}, BACKEND) == ([], [])


def test_a_repeated_name_is_numbered_in_source_order_regardless_of_row_order() -> None:
    rows = [
        row("<arg of useCallback>", 1, 1.0, line=9),
        row("<arg of useCallback>", 1, 1.0, line=3),
    ]

    keys = ratchet.keyed(rows)

    assert keys[f"{FILE}::<arg of useCallback>"]["line"] == 3
    assert keys[f"{FILE}::<arg of useCallback>#2"]["line"] == 9


def test_update_keeps_reasons_drops_stale_entries_and_leaves_new_ones_to_explain() -> (
    None
):
    other_side = {"frontend/src/a.ts::g": entry(40.0, "fe reason")}
    base = {
        f"{FILE}::kept": entry(35.0, "kept reason"),
        f"{FILE}::gone": entry(35.0, "gone reason"),
        **other_side,
    }
    rows = [row("kept", 36, 1.0), row("gone", 3, 1.0), row("new", 8, 0.0)]

    new = ratchet.update(rows, base, BACKEND)

    assert new == {
        f"{FILE}::kept": {"score": 36.0, "reason": "kept reason"},
        f"{FILE}::new": {"score": 72.0, "reason": ""},
        **other_side,
    }
    assert ratchet.check(rows, new, BACKEND)[0] == [
        f"(d) no reason: {FILE}::new needs a one-line reason in baseline.json."
    ]


def test_the_committed_baseline_holds_only_explained_offenders() -> None:
    baseline = json.loads(ratchet.BASELINE.read_text())

    for key, value in baseline.items():
        assert key.split("/", 1)[0] in ("backend", "frontend") and "::" in key, key
        assert value["score"] > ratchet.THRESHOLD, f"{key} is not an offender"
        assert value["reason"].strip(), f"{key} has no reason"


def _workflow(name: str) -> dict[str, Any]:
    parsed = yaml.load((_WORKFLOWS / name).read_text(), Loader=yaml.BaseLoader)
    assert isinstance(parsed, dict)
    return parsed


def _runs_the_check(job: dict[str, Any]) -> bool:
    return any("ratchet.py check" in step.get("run", "") for step in job["steps"])


@pytest.mark.parametrize(
    ("workflow", "job"),
    [
        ("test-backend.yml", "coverage-report"),
        ("test-frontend-unit.yml", "test-frontend-unit"),
    ],
)
def test_ci_runs_the_check_where_the_whole_suite_is_measured(
    workflow: str, job: str
) -> None:
    jobs = _workflow(workflow)["jobs"]

    assert _runs_the_check(jobs[job]), (
        f"{workflow}:{job} no longer runs the CRAP ratchet"
    )
    others = [name for name, j in jobs.items() if name != job and _runs_the_check(j)]
    assert others == [], f"the ratchet runs where coverage is partial: {others}"


@pytest.mark.parametrize("workflow", ["test-backend.yml", "test-frontend-unit.yml"])
def test_a_ratchet_change_triggers_the_check_and_docs_do_not(workflow: str) -> None:
    on = _workflow(workflow)["on"]

    for event in ("push", "pull_request"):
        paths = on[event]["paths"]
        assert "scripts/crap/**" in paths, f"{workflow} {event} skips baseline edits"
        assert not any(
            p.startswith("docs") or (p.endswith(".md") and p != "CLAUDE.md")
            for p in paths
        )
