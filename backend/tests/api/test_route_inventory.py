"""Every declared `/data` route is actually reachable.

Written because the C1 split silently dropped twelve endpoints on its first
attempt. The extraction took each function's span from `ast` node `lineno`,
which points at the `def` — so the leading `@router.get(...)` was left behind on
every block boundary. The decorated functions still existed, still imported,
still type-checked, and `pytest` still passed 698 of 767 tests. Nothing said
"twelve routes are gone" except an OpenAPI diff run by hand.

This test makes that failure loud, and covers the neighbouring mistake too:
adding a module under `routes/data/` and forgetting to `include_router` it.

It works off the source, not the imports, so a route that is *declared* but not
*mounted* fails — which is exactly the case a smoke test cannot see.
"""

from __future__ import annotations

import ast
import pathlib

from app.main import app

ROUTES_DIR = pathlib.Path(__file__).resolve().parents[2] / "app" / "api" / "routes"
DATA_PKG = ROUTES_DIR / "data"

HTTP_METHODS = {"get", "post", "put", "delete", "patch"}


def _declared_routes(module: pathlib.Path) -> set[tuple[str, str]]:
    """`(METHOD, path)` pairs declared by `@router.<method>("…")` in one file."""
    found: set[tuple[str, str]] = set()
    for node in ast.walk(ast.parse(module.read_text())):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        for deco in node.decorator_list:
            if (
                isinstance(deco, ast.Call)
                and isinstance(deco.func, ast.Attribute)
                and deco.func.attr in HTTP_METHODS
                and deco.args
                and isinstance(deco.args[0], ast.Constant)
            ):
                found.add((deco.func.attr.upper(), deco.args[0].value))
    return found


def _mounted_routes() -> set[tuple[str, str]]:
    """`(METHOD, path)` pairs the app actually serves.

    Read off `app.openapi()` rather than `app.routes`: this FastAPI version keeps
    included routers nested as `_IncludedRouter` objects rather than flattening
    them into `APIRoute`s, so walking `app.routes` finds nothing. The generated
    document is the contract anyway — it is what the client is built from.
    """
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method.lower() in HTTP_METHODS
    }


def test_every_declared_data_route_is_mounted() -> None:
    mounted = _mounted_routes()
    missing: list[str] = []

    for module in sorted(DATA_PKG.glob("*.py")):
        if module.name.startswith("_"):
            continue
        for method, path in sorted(_declared_routes(module)):
            full = f"/api/v1/data{path}"
            if (method, full) not in mounted:
                missing.append(f"{module.name}: {method} {full}")

    assert not missing, "declared but not mounted:\n  " + "\n  ".join(missing)


def test_the_data_package_is_fully_included() -> None:
    """Each family module must contribute at least one mounted route.

    Catches a module added to `routes/data/` but never wired into
    `data/__init__.py` — it would import cleanly and serve nothing.
    """
    mounted = _mounted_routes()
    silent: list[str] = []

    for module in sorted(DATA_PKG.glob("*.py")):
        if module.name.startswith("_"):
            continue
        declared = _declared_routes(module)
        if not declared:
            continue
        if not any((m, f"/api/v1/data{p}") in mounted for m, p in declared):
            silent.append(module.name)

    assert not silent, f"modules declaring routes that are not mounted: {silent}"


def test_the_split_did_not_change_the_route_count() -> None:
    """73 `/data` endpoints before the split, and after it.

    A bare number is a blunt instrument, but it is the one assertion that would
    have failed loudly on the first C1 attempt — it dropped twelve. Update it
    deliberately when an endpoint is genuinely added or removed.

    (The plan and audit both say "71 endpoints". That was already stale before
    this split; the document has counted 73 since B-series work added none. The
    figure here is measured, not copied.)
    """
    data_routes = {
        (m, p) for m, p in _mounted_routes() if p.startswith("/api/v1/data/")
    }
    assert len(data_routes) == 73, (
        f"expected 73 /data endpoints, found {len(data_routes)}"
    )
