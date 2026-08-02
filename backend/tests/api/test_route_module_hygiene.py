"""Structural rules for route modules, enforced instead of merely written down.

`CLAUDE.md` has stated both rules below since B1. When this file was added,
**three modules violated the first one** — `routes/rag.py` twice and
`routes/private.py` once — despite the rule sitting in the file every
contributor and every AI agent loads at the start of a session.

That is the whole argument for this test existing. The architecture-simplification
programme (`docs/architecture-simplification-plan.md`) ended with a clear pattern:
every decision that became a compile error or a failing test survived, and every
decision that stayed prose either decayed or was one careless PR from decaying.
Prose informs; only executable things enforce.

These checks read the **source**, not the imported module, so a violation is
reported at the file and line where someone will fix it, and a model that is
declared but never used still fails.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

ROUTES_DIR = pathlib.Path(__file__).resolve().parents[2] / "app" / "api" / "routes"

#: Base classes that make a class a request/response model.
MODEL_BASES = {"BaseModel", "SQLModel"}


def _route_modules() -> list[pathlib.Path]:
    return sorted(p for p in ROUTES_DIR.rglob("*.py") if p.name != "__init__.py")


def _parse(path: pathlib.Path) -> ast.Module:
    return ast.parse(path.read_text(), filename=str(path))


def _rel(path: pathlib.Path) -> str:
    return str(path.relative_to(ROUTES_DIR.parents[2]))


@pytest.mark.parametrize("path", _route_modules(), ids=lambda p: p.name)
def test_route_module_declares_no_models(path: pathlib.Path) -> None:
    """Request *and* response models live in `app/schemas/`, never in a route.

    Why it matters, and why "it's only a request model" is not an exemption: a
    model inline in a route is invisible to anyone reading `app/schemas/` to
    learn the API surface, and it cannot be reused by a second route without an
    import that inverts the intended dependency direction. Moving a Pydantic
    class between modules does **not** change its OpenAPI schema name, so there
    is never a wire-format reason to leave one here.
    """
    offenders = [
        f"{node.name} (line {node.lineno})"
        for node in ast.walk(_parse(path))
        if isinstance(node, ast.ClassDef)
        and any(
            isinstance(base, ast.Name) and base.id in MODEL_BASES for base in node.bases
        )
    ]

    assert not offenders, (
        f"{_rel(path)} declares {', '.join(offenders)} inline. "
        f"Move it to app/schemas/ — see CLAUDE.md, 'Every route declares a "
        f"response model'."
    )


@pytest.mark.parametrize("path", _route_modules(), ids=lambda p: p.name)
def test_route_handlers_declare_a_return_type(path: pathlib.Path) -> None:
    """Every decorated handler annotates what it returns.

    An unannotated handler emits no response schema at all, which is the state
    B1–B6 spent the whole programme undoing: an untyped 200 becomes
    `Record<string, unknown>` in the generated TypeScript, and the frontend then
    hand-maintains a duplicate interface that no compiler keeps in step.

    `-> Any` is deliberately **allowed**: the template's `response_model=`
    decorator argument is the older way of saying the same thing, and the
    `/private` and `/login` routes still use it. What is not allowed is silence.
    """
    tree = _parse(path)
    offenders: list[str] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        decorated_by_router = any(
            isinstance(d, ast.Call)
            and isinstance(d.func, ast.Attribute)
            and isinstance(d.func.value, ast.Name)
            and d.func.value.id == "router"
            for d in node.decorator_list
        )
        if decorated_by_router and node.returns is None:
            offenders.append(f"{node.name} (line {node.lineno})")

    assert not offenders, (
        f"{_rel(path)} has handler(s) with no return annotation: "
        f"{', '.join(offenders)}. Declare a response model from app/schemas/."
    )
