"""Fail a commit that leaves a `path.py::name` reference pointing at nothing.

Prose and comments cite code as `services/posts_view.py::feed`. Moving or
deleting the function leaves every such citation behind, reading as a pointer
and leading nowhere, and no test notices. This resolves each backticked one in
the tracked files: the path matches any tracked `.py` file ending in it, and
the name must be defined at the top level of one of them, or as `Class.member`.

The whole tree is read on every run, because the commit that breaks a
reference is the one that changes the code it names, not the file that cites
it. History is skipped: the PR archive, the ADRs, the tickets under
`.scratch/` and the dated plans and audits in `docs/` record what was true when
they were written.
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
from collections.abc import Iterable
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SKIPPED = re.compile(
    r"^(\.scratch/|docs/pr-archive/|docs/adr/|docs/[^/]+-(plan|audit)\.md$"
    r"|frontend/src/client/"
    # This check and its test, whose examples name nothing on purpose.
    r"|scripts/check_code_refs\.py$|backend/tests/deployment/test_code_refs_hook\.py$)"
)
SCANNED = re.compile(r"\.(py|md|ts|tsx|sh|ya?ml|toml)$")
#: A backticked reference: `a/b.py::name`, `b.py::Class.method`. A pytest node
#: id is the same shape and resolves the same way.
_REF = re.compile(r"`([A-Za-z0-9_./-]*[A-Za-z0-9_]\.py)::([A-Za-z_][A-Za-z0-9_.]*)`")


def _tracked() -> list[str]:
    return subprocess.run(
        ["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout.splitlines()


def defined(source: str) -> set[str]:
    """Top-level names `source` defines, and `Class.member` for each class body."""
    names: set[str] = set()

    def targets(node: ast.stmt) -> Iterable[str]:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            yield node.name
        elif isinstance(node, ast.Assign):
            yield from (t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            yield node.target.id
        elif isinstance(node, ast.TypeAlias):
            yield node.name.id

    for node in ast.parse(source).body:
        names.update(targets(node))
        if isinstance(node, ast.ClassDef):
            names.update(
                f"{node.name}.{m}" for child in node.body for m in targets(child)
            )
    return names


def offenders(files: dict[str, str], python: dict[str, set[str]]) -> list[str]:
    """`path:line: ref` for each reference no tracked module defines.

    `files` maps each scanned path to its text; `python` maps each tracked
    `.py` path to the names it defines.
    """
    found: list[str] = []
    for path, text in sorted(files.items()):
        for number, line in enumerate(text.splitlines(), start=1):
            for module, name in _REF.findall(line):
                homes = [p for p in python if p == module or p.endswith(f"/{module}")]
                if not any(name in python[p] for p in homes):
                    found.append(f"{path}:{number}: {module}::{name}")
    return found


def main() -> int:
    tracked = [p for p in _tracked() if (REPO / p).is_file()]
    python: dict[str, set[str]] = {}
    for path in tracked:
        if path.endswith(".py"):
            try:
                python[path] = defined((REPO / path).read_text(encoding="utf-8"))
            except SyntaxError:
                python[path] = set()
    files = {
        path: (REPO / path).read_text(encoding="utf-8", errors="replace")
        for path in tracked
        if SCANNED.search(path) and not SKIPPED.match(path)
    }
    found = offenders(files, python)
    for entry in found:
        sys.stderr.write(f"error: dangling reference at {entry}\n")
    if found:
        sys.stderr.write(
            "Point it at where the code lives now, or say what it was in words.\n"
        )
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
