"""No Posts or Discover route resolves a Posts view by hand (ADR-036).

Seven reads used to resolve one view each, route by route: an Analysis window,
a `PostScope`, the Post filter (and the Settling curve when a bound or the
views order read it) and the Post selection's predicate. They drifted: whether
the curve was loaded depended on the caller passing the right sort, and the
followed-set precondition was spelled three ways. The Posts routes now read
their body through `api/post_views.view_of` and the Discover route builds
through `resolve_posts_view`, so the parts arrive resolved.

This fails a route module that names the Post scope type, the Post filter
parser or the selection compiler, because a route that names one is resolving
a part of the view itself, which is how an eighth read would reopen the drift.
Read from the source, so a bare import fails too and the line is reported.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

DATA_ROUTES = (
    pathlib.Path(__file__).resolve().parents[2] / "app" / "api" / "routes" / "data"
)

#: The Posts and Discover route modules.
ROUTE_MODULES = ("posts.py", "discover.py")

#: What resolving a part of a Posts view by hand names.
RESOLVERS = frozenset(
    {
        "PostScope",
        "parse_post_filters",
        "selection_clause",
        "compile_selection",
    }
)


def _named(tree: ast.Module) -> list[tuple[str, int]]:
    """Every name, attribute and import alias in `tree`, with its line."""
    found: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            found.append((node.id, node.lineno))
        elif isinstance(node, ast.Attribute):
            found.append((node.attr, node.lineno))
        elif isinstance(node, ast.ImportFrom):
            found.extend((alias.name, node.lineno) for alias in node.names)
    return found


@pytest.mark.parametrize("name", ROUTE_MODULES)
def test_no_posts_route_resolves_a_view_by_hand(name: str) -> None:
    path = DATA_ROUTES / name
    offenders = sorted(
        {
            f"{found} (line {line})"
            for found, line in _named(ast.parse(path.read_text(), filename=str(path)))
            if found in RESOLVERS
        }
    )

    assert not offenders, (
        f"{name} resolves part of a Posts view itself: {', '.join(offenders)}. "
        "Read the body with `api/post_views.view_of`, or build one with "
        "`services/posts_view.resolve_posts_view` (ADR-036)."
    )
