"""Generate the catalog of tuning constants the Settings page lists (SET-04).

Every module-level numeric or boolean UPPER_CASE constant in the backend
(``backend/app``, migrations excepted) and the frontend (``frontend/src``,
tests and the generated client excepted), with its value, the expression it is
written as, the comment above it and its file:line. The backend serves the
catalog as the "Code" Configuration rows; it cannot scan source at runtime,
because the backend image carries no frontend.

A constant counts when its value is literal arithmetic: ``3``, ``30 * 60``,
``-1``, ``True``. One that names another constant or calls something is a
derivation, not a knob, and is left out. ``UNIT_CONVERSIONS`` drops the names
that are facts about units rather than choices about behaviour.

``--check`` fails when the committed catalog is stale; the pre-commit hook runs
it without, and ``tests/deployment/test_constants_catalog.py`` with. Both modes
also fail, naming the module, when a module with a constant has no topic in
``setting_declarations.CONSTANT_TOPICS`` or a topic names a module with none:
the same rule as ``test_every_module_with_a_constant_has_a_topic``, moved to
commit time because a frontend-only change otherwise meets it only in the
backend suite.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "backend/app/core/constants_catalog.generated.json"
DECLARATIONS = ROOT / "backend/app/services/setting_declarations.py"
BACKEND = ROOT / "backend/app"
FRONTEND = ROOT / "frontend/src"

#: Facts about units, not choices: changing one would be a bug, not a tuning.
UNIT_CONVERSIONS = frozenset(
    {"MINUTE_MS", "HOUR_MS", "DAY_MS", "WEEK_MS", "MS_PER_HOUR", "DAY"}
)

_NAME = re.compile(r"^_?[A-Z][A-Z0-9_]*$")
_TS_CONST = re.compile(
    r"^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(.+?)\s*;?\s*$"
)
_TS_EXPR = re.compile(r"^(?:true|false|[-+*/()\d_.\s]+)$")


def _arith(node: ast.expr) -> Any:
    """The value of literal arithmetic, or ``ValueError``."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (bool, int, float)):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        value = _arith(node.operand)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.BinOp):
        left, right = _arith(node.left), _arith(node.right)
        ops = {
            ast.Add: lambda: left + right,
            ast.Sub: lambda: left - right,
            ast.Mult: lambda: left * right,
            ast.Div: lambda: left / right,
            ast.FloorDiv: lambda: left // right,
            ast.Pow: lambda: left**right,
        }
        op = ops.get(type(node.op))
        if op is not None:
            return op()
    raise ValueError("not literal arithmetic")


def _comment_above(lines: list[str], lineno: int, marker: str) -> str:
    """The comment block directly above line ``lineno`` (1-based), as one line."""
    out: list[str] = []
    i = lineno - 2
    while i >= 0:
        stripped = lines[i].strip()
        if marker == "#" and stripped.startswith("#"):
            out.append(re.sub(r"^#:?\s?", "", stripped))
        elif marker == "//" and stripped.startswith(("//", "/*", "*")):
            out.append(re.sub(r"^(?://+|/\*\*?|\*/|\*)\s?", "", stripped))
        else:
            break
        i -= 1
    text = " ".join(part for part in reversed(out) if part and part != "*/")
    return re.sub(r"\s*\*/$", "", re.sub(r"\s+", " ", text)).strip()


def _entry(
    name: str, value: Any, expr: str, path: Path, line: int, comment: str
) -> dict[str, Any]:
    return {
        "name": name,
        "value": value,
        "expression": expr,
        "comment": comment,
        "file": str(path.relative_to(ROOT)),
        "line": line,
    }


def backend_constants() -> list[dict[str, Any]]:
    found = []
    for path in sorted(BACKEND.rglob("*.py")):
        if "alembic" in path.parts:
            continue
        source = path.read_text()
        lines = source.splitlines()
        for node in ast.parse(source).body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target, value = node.targets[0], node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                target, value = node.target, node.value
            else:
                continue
            if not isinstance(target, ast.Name) or not _NAME.match(target.id):
                continue
            if target.id.lstrip("_") in UNIT_CONVERSIONS:
                continue
            try:
                result = _arith(value)
            except (ValueError, ZeroDivisionError, TypeError):
                continue
            found.append(
                _entry(
                    target.id,
                    result,
                    ast.unparse(value),
                    path,
                    node.lineno,
                    _comment_above(lines, node.lineno, "#"),
                )
            )
    return found


def _skip_frontend(path: Path) -> bool:
    name = path.name
    return (
        ".test." in name
        or ".conform." in name
        or ".gen." in name
        or ".generated." in name
        or "client" in path.relative_to(FRONTEND).parts[:1]
    )


def frontend_constants() -> list[dict[str, Any]]:
    found = []
    paths = sorted([*FRONTEND.rglob("*.ts"), *FRONTEND.rglob("*.tsx")])
    for path in paths:
        if _skip_frontend(path):
            continue
        lines = path.read_text().splitlines()
        for lineno, line in enumerate(lines, 1):
            match = _TS_CONST.match(line)  # column 0 only: module level
            if not match or match.group(1) in UNIT_CONVERSIONS:
                continue
            expr = match.group(2)
            if not _TS_EXPR.match(expr):
                continue
            try:
                tree = ast.parse(
                    expr.replace("true", "True").replace("false", "False"),
                    mode="eval",
                )
                result = _arith(tree.body)
            except (SyntaxError, ValueError, ZeroDivisionError, TypeError):
                continue
            found.append(
                _entry(
                    match.group(1),
                    result,
                    expr,
                    path,
                    lineno,
                    _comment_above(lines, lineno, "//"),
                )
            )
    return found


def _constant_topics() -> dict[str, str]:
    """``CONSTANT_TOPICS``, read as a literal: this script runs without the app's deps."""
    for node in ast.parse(DECLARATIONS.read_text()).body:
        if (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "CONSTANT_TOPICS"
            and node.value is not None
        ):
            topics: dict[str, str] = ast.literal_eval(node.value)
            return topics
    raise SystemExit(f"CONSTANT_TOPICS not found in {DECLARATIONS.relative_to(ROOT)}")


def topic_errors(constants: list[dict[str, Any]]) -> list[str]:
    modules = {entry["file"] for entry in constants}
    topics = set(_constant_topics())
    where = f"{DECLARATIONS.relative_to(ROOT)} CONSTANT_TOPICS"
    return [
        *(
            f"{m} has a constant but no topic; add it to {where}"
            for m in sorted(modules - topics)
        ),
        *(
            f"{m} is in {where} but has no constant; remove it"
            for m in sorted(topics - modules)
        ),
    ]


def render() -> str:
    payload = {
        "generatedBy": "scripts/generate_constants_catalog.py",
        "constants": [*backend_constants(), *frontend_constants()],
    }
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if stale")
    args = parser.parse_args()
    expected = render()
    errors = topic_errors(json.loads(expected)["constants"])
    for error in errors:
        sys.stderr.write(error + "\n")
    if args.check:
        if not CATALOG.exists() or CATALOG.read_text() != expected:
            sys.stderr.write(
                f"{CATALOG.relative_to(ROOT)} is stale; run: "
                "python3 scripts/generate_constants_catalog.py\n"
            )
            return 1
        return 1 if errors else 0
    CATALOG.write_text(expected)
    count = len(json.loads(expected)["constants"])
    sys.stdout.write(f"Catalogued {count} constants\n")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
