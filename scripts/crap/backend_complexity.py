"""Stop a push whose backend change already fails the CRAP ratchet.

    python3 scripts/crap/backend_complexity.py <changed backend/app paths...>

The backend ratchet scores CRAP from the combined coverage of CI's three test
legs, so nothing local can score it before the push; it failed only in
`coverage-report`, a CI run later, on ALB-01. But CRAP is never below a
function's cyclomatic complexity, so a function with complexity above the
ratchet's threshold fails at any coverage. This reads radon's complexity for
the changed files alone (seconds): above the threshold it fails, unless the
baseline already holds the function; near it, it warns that the function
needs close to full coverage.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from backend_crap import rows_for  # noqa: E402
from ratchet import THRESHOLD  # noqa: E402

#: Complexity from which a function needs close to full coverage to pass:
#: at 25, 90% coverage scores 25.6 and 75% scores 34.8.
WARN_AT = 25


def verdicts(
    rows: list[dict[str, Any]], baseline: dict[str, Any]
) -> tuple[list[str], list[str]]:
    """Failures and warnings for the functions in `rows`."""
    failures: list[str] = []
    warnings: list[str] = []
    for r in rows:
        key = f"{r['file']}::{r['name']}"
        if key in baseline or r["cc"] < WARN_AT:
            continue
        where = f"{key} (line {r['line']}): cc {r['cc']}"
        if r["cc"] > THRESHOLD:
            failures.append(
                f"{where} fails the CRAP ratchet at any coverage. Split it."
            )
        else:
            warnings.append(
                f"{where} needs close to full coverage to stay under {THRESHOLD:g}."
            )
    return failures, warnings


def main(changed: list[str]) -> int:
    paths = [
        p.removeprefix("backend/") for p in changed if p.startswith("backend/app/")
    ]
    if not paths:
        return 0
    radon = subprocess.run(
        [
            "uv",
            "run",
            "--no-project",
            "--with",
            "radon==6.0.1",
            "radon",
            "cc",
            "-j",
            *paths,
        ],
        cwd=HERE.parents[1] / "backend",
        capture_output=True,
        text=True,
        check=True,
    )
    baseline = json.loads((HERE / "baseline.json").read_text(encoding="utf-8"))
    failures, warnings = verdicts(rows_for(json.loads(radon.stdout), {}), baseline)
    for line in warnings:
        print(f"warning: {line}")
    for line in failures:
        print(f"error: {line}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
