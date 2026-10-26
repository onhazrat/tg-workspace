"""`scripts/ci_failure_context.py` reads a Playwright blob report's events."""

from __future__ import annotations

import importlib.util
import json
import pathlib

_SCRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts/ci_failure_context.py"
_spec = importlib.util.spec_from_file_location("ci_failure_context", _SCRIPT)
assert _spec is not None and _spec.loader is not None
ci = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ci)


def _end(result_id: str, status: str, message: str = "") -> dict[str, object]:
    errors = [{"message": f"\x1b[31m{message}\x1b[39m"}] if message else []
    return {
        "method": "onTestEnd",
        "params": {
            "test": {"testId": "t1"},
            "result": {"id": result_id, "status": status, "errors": errors},
        },
    }


def test_a_retried_failure_names_its_test_snapshot_and_flake(
    tmp_path: pathlib.Path,
) -> None:
    test = {
        "testId": "t1",
        "title": "saves",
        "location": {"file": "a.spec.ts", "line": 9},
    }
    events = [
        {
            "method": "onProject",
            "params": {
                "project": {
                    "suites": [
                        {
                            "title": "a.spec.ts",
                            "entries": [{"title": "Quota", "entries": [test]}],
                        }
                    ]
                }
            },
        },
        {
            "method": "onAttach",
            "params": {
                "resultId": "r1",
                "attachments": [{"name": "error-context", "path": "resources/x.md"}],
            },
        },
        _end("r1", "timedOut", "Test timeout"),
        _end("r2", "passed"),
    ]
    report = tmp_path / "report.jsonl"
    report.write_text("\n".join(json.dumps(e) for e in events), encoding="utf-8")

    failed, flaky = ci.failures(report)

    assert failed.splitlines()[:4] == [
        "## a.spec.ts:9 › Quota › saves",
        "timedOut, attempt 1",
        "",
        "Test timeout",
    ]
    assert failed.endswith(f"-> {tmp_path / 'resources/x.md'}")
    assert flaky == "FLAKY (failed, then passed on retry): a.spec.ts:9 › Quota › saves"
