"""Per-function CRAP rows for backend/app.

Joins radon's cyclomatic complexity to coverage.py's line hits by source span.
Radon already scores closures on their own, and their lines don't count toward
the enclosing function here either.

Usage: python3 scripts/crap/backend_crap.py <radon.json> <coverage.json> <out.json>
"""

import json
import sys
from typing import Any


def rows_for(radon: dict[str, Any], cov: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def walk(
        path: str,
        block: dict[str, Any],
        prefix: str,
        executed: set[int],
        statements: set[int],
    ) -> None:
        name = f"{prefix}{block['name']}"
        if block["type"] in ("function", "method"):
            nested = {
                ln
                for c in block.get("closures", [])
                for ln in range(c["lineno"] + 1, c["endline"] + 1)
            }
            span = [
                ln
                for ln in range(block["lineno"], block["endline"] + 1)
                if ln in statements and ln not in nested
            ]
            covered = sum(ln in executed for ln in span) / len(span) if span else 0.0
            rows.append(
                {
                    "file": f"backend/{path}",
                    "line": block["lineno"],
                    "name": name,
                    "cc": block["complexity"],
                    "cov": covered,
                }
            )
        for child in block.get("methods", []) + block.get("closures", []):
            walk(path, child, f"{name}.", executed, statements)

    for path, blocks in radon.items():
        if isinstance(blocks, dict):  # radon could not parse the file
            print(f"radon skipped {path}: {blocks.get('error')}", file=sys.stderr)
            continue
        f = cov.get(path, {})
        executed = set(f.get("executed_lines", []))
        statements = executed | set(f.get("missing_lines", []))
        for b in blocks:
            # radon lists every method twice: under its class and at top level
            if b["type"] != "method":
                walk(path, b, "", executed, statements)
    return rows


if __name__ == "__main__":
    radon_path, cov_path, out_path = sys.argv[1:4]
    with open(radon_path) as f:
        radon = json.load(f)
    with open(cov_path) as f:
        cov = json.load(f)["files"]
    rows = rows_for(radon, cov)
    with open(out_path, "w") as f:
        json.dump(rows, f)
    print(f"backend: {len(rows)} functions")
