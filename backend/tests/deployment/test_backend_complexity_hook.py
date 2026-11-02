"""The pre-push hook fails a backend function the CRAP ratchet fails at any coverage.

`scripts/crap/backend_complexity.py` holds the rule and its reason. CRAP is
never below cyclomatic complexity, so complexity above the threshold is a
certain CI failure; this pins that edge, the baseline exemption, and the hook's
wiring at pre-push.
"""

from __future__ import annotations

import importlib.util
import pathlib
from types import ModuleType
from typing import Any

import yaml

_ROOT = pathlib.Path(__file__).resolve().parents[3]
FILE = "backend/app/services/x.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "backend_complexity", _ROOT / "scripts" / "crap" / "backend_complexity.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hook = _load()


def row(name: str, cc: int) -> dict[str, Any]:
    return {"file": FILE, "line": 7, "name": name, "cc": cc, "cov": 0.0}


def test_complexity_above_the_threshold_fails_and_at_it_warns() -> None:
    failures, warnings = hook.verdicts([row("over", 31), row("at", 30)], {})

    assert failures == [
        f"{FILE}::over (line 7): cc 31 fails the CRAP ratchet at any coverage. Split it."
    ]
    assert [w.split(" (")[0] for w in warnings] == [f"{FILE}::at"]


def test_a_function_below_the_warning_says_nothing() -> None:
    assert hook.verdicts([row("f", hook.WARN_AT - 1)], {}) == ([], [])


def test_a_baseline_function_is_left_to_the_ratchet() -> None:
    baseline = {f"{FILE}::over": {"score": 40.0, "reason": "deliberate"}}

    assert hook.verdicts([row("over", 35)], baseline) == ([], [])


def test_the_hook_runs_at_pre_push_on_backend_app() -> None:
    config = yaml.safe_load((_ROOT / ".pre-commit-config.yaml").read_text())
    (found,) = [
        h
        for repo in config["repos"]
        for h in repo["hooks"]
        if h["id"] == "crap-complexity-backend"
    ]

    assert found["stages"] == ["pre-push"]
    assert found["entry"] == "python3 scripts/crap/backend_complexity.py"
    assert found["files"] == r"^backend/app/.*\.py$"
