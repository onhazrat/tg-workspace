"""AW-01: the Analysis window is compared in exactly one place.

`test_analysis_window_boundaries.py` proves the window is half-open on every
path that selects Posts. This proves there is no sixth path — that nobody has
written `Post.timestamp >= start` beside a hand-rolled end somewhere new.

The two are not the same claim, and the boundary file cannot make this one. It
can only check the paths it knows about, and the defect being fixed here was
precisely that five modules each grew their own copy of the comparison: the
feed, the counts, Discover, semantic search and auto-regeneration, every one of
them inclusive. A sixth would pass every test in that file while quietly making
the same Scope mean something different again.

So this walks the AST of `app/` instead and requires every comparison against
`Post.timestamp` to be either the shared predicate or a declared exception
saying which *other* window it is. Four exist, one narrowed to a function, and
they are genuinely other windows — retention's cutoff, the scraper's backward
walk, the counter refresh horizon — not the Account's Analysis window under
another name.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

APP_ROOT = pathlib.Path(__file__).resolve().parents[2] / "app"

#: The one module allowed to compare `Post.timestamp` against a window bound.
THE_PREDICATE = "services/post_filters.py"

#: Comparisons that are **not** the Analysis window, each with the window it
#: actually is. A bare count would not do: the point is that somebody adding a
#: comparison has to say which question it answers, and "the Analysis window"
#: is not an available answer.
NOT_THE_ANALYSIS_WINDOW: dict[str, str] = {
    "jobs/retention.py": (
        "The retention cutoff. It deletes by age on the deployment's "
        "`postRetentionDays`, which is a policy about storage, not a Scope "
        "anybody selected."
    ),
    "services/channels.py": (
        "The scraper's backward walk: `< scrape_cutoff_ms` bounds how far back "
        "a sync reaches, and `> 0` excludes rows with no usable timestamp. "
        "Neither is a window a person chose."
    ),
    "services/sync_orchestrator.py": (
        "`> 0` again, finding a Channel's newest real Post to resume from. A "
        "sync cursor, not a Scope."
    ),
}

#: The same, narrowed to one function, for a module that also holds a path the
#: Analysis window governs. `posts.py` holds the feed and the counts beside the
#: write path, so excusing the module would excuse a hand-rolled window in
#: `list_feed` too (REACH-10).
NOT_THE_ANALYSIS_WINDOW_IN: dict[tuple[str, str], str] = {
    ("services/posts.py", "refresh_post_counters"): (
        "The counter refresh horizon (REACH-02): sync re-observes a stored "
        "Post's View count only while it is younger than 7 days. A code "
        "constant about when a count stops changing, not a Scope."
    ),
}

_ORDER_OPS = (ast.Lt, ast.LtE, ast.Gt, ast.GtE)


def _post_aliases(tree: ast.Module) -> set[str]:
    """Names bound to `aliased(Post, ...)` anywhere in the module.

    Without this the guard has a hole in the one module it most needs to
    cover. `posts.py::list_feed` re-aliases `Post` onto its `row_number()`
    subquery (`capped = aliased(Post, ranked)`), so a window predicate written
    as `capped.timestamp <= end_date` — inside the capped branch, the subtler
    of the feed's two query shapes — would be invisible here *and* pass the
    boundary suite, which reaches the same rows through the shared predicate
    applied earlier in the statement.

    Module-scoped rather than flow-sensitive on purpose: a name that ever means
    an aliased Post is treated as one everywhere. Over-matching costs a
    declared exception; under-matching costs the thing this file exists for.
    """
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        value = node.value
        if not isinstance(value, ast.Call):
            continue
        func = value.func
        if not (isinstance(func, ast.Name) and func.id == "aliased"):
            continue
        if not (
            value.args
            and isinstance(value.args[0], ast.Name)
            and value.args[0].id == "Post"
        ):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                aliases.add(target.id)
    return aliases


def _is_post_timestamp(node: ast.expr, aliases: frozenset[str]) -> bool:
    """`Post.timestamp` — bare, wrapped in `col(...)`, or through an alias."""
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name) and func.id == "col" and node.args:
            return _is_post_timestamp(node.args[0], aliases)
        return False
    return (
        isinstance(node, ast.Attribute)
        and node.attr == "timestamp"
        and isinstance(node.value, ast.Name)
        and (node.value.id == "Post" or node.value.id in aliases)
    )


def _modules() -> list[pathlib.Path]:
    return sorted(
        path
        for path in APP_ROOT.rglob("*.py")
        # Alembic revisions are frozen history: an applied migration must keep
        # meaning what it meant, so they are never rewritten to use a helper.
        if "alembic" not in path.parts
    )


def _is_window_comparison(node: ast.AST, aliases: frozenset[str]) -> bool:
    return (
        isinstance(node, ast.Compare)
        and any(isinstance(op, _ORDER_OPS) for op in node.ops)
        and any(
            _is_post_timestamp(operand, aliases)
            for operand in [node.left, *node.comparators]
        )
    )


def _enclosing_functions(
    node: ast.AST, aliases: frozenset[str], function: str = "<module>"
) -> list[str]:
    """The nearest enclosing function of each comparison under `node`."""
    found: list[str] = []
    for child in ast.iter_child_nodes(node):
        if _is_window_comparison(child, aliases):
            found.append(function)
        inner = (
            child.name
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
            else function
        )
        found.extend(_enclosing_functions(child, aliases, inner))
    return found


def _comparison_sites() -> dict[str, list[str]]:
    """`module path relative to app/ -> the function of each ordered comparison`."""
    found: dict[str, list[str]] = {}
    for path in _modules():
        tree = ast.parse(path.read_text())
        functions = _enclosing_functions(tree, frozenset(_post_aliases(tree)))
        if functions:
            found[str(path.relative_to(APP_ROOT))] = functions
    return found


def test_every_post_timestamp_comparison_is_the_predicate_or_declared() -> None:
    sites = _comparison_sites()

    undeclared = {
        module: functions
        for module, functions in sites.items()
        if module != THE_PREDICATE
        and module not in NOT_THE_ANALYSIS_WINDOW
        and any((module, f) not in NOT_THE_ANALYSIS_WINDOW_IN for f in functions)
    }

    assert undeclared == {}, (
        "these modules compare `Post.timestamp` themselves: "
        f"{sorted(undeclared)}. If this is the Account's Analysis window, use "
        "`post_filters.apply_analysis_window` — five separate copies of it is "
        "what AW-01 removed, and every one of them had an inclusive end. If it "
        "is a different window, add it to NOT_THE_ANALYSIS_WINDOW (or, for one "
        "function, NOT_THE_ANALYSIS_WINDOW_IN) saying which."
    )


def test_the_shared_predicate_still_writes_the_comparison() -> None:
    """The guard above passes trivially if the helper stops comparing anything.

    A guard that cannot fail is worse than none, and this is the way this one
    would stop being able to: refactor the bounds into a string, a raw
    `text()`, or a column object built somewhere else, and every assertion here
    goes green over a codebase with no half-open window left in it.
    """
    assert len(_comparison_sites().get(THE_PREDICATE, [])) >= 2, (
        "`post_filters.py` no longer compares `Post.timestamp` on both sides — "
        "the window has moved somewhere this guard cannot see"
    )


@pytest.mark.parametrize("module", sorted(NOT_THE_ANALYSIS_WINDOW))
def test_a_declared_exception_still_makes_its_comparison(module: str) -> None:
    """An exception nothing exercises is a leftover nobody dares touch.

    When one of these modules stops comparing timestamps the entry must go,
    rather than sitting in the list granting permission to whoever adds the
    next one.
    """
    assert module in _comparison_sites(), (
        f"{module} no longer compares `Post.timestamp`; drop its entry from "
        "NOT_THE_ANALYSIS_WINDOW rather than leaving a standing exemption"
    )


@pytest.mark.parametrize("site", sorted(NOT_THE_ANALYSIS_WINDOW_IN))
def test_a_declared_function_still_makes_its_comparison(site: tuple[str, str]) -> None:
    module, function = site
    assert function in _comparison_sites().get(module, []), (
        f"{module}::{function} no longer compares `Post.timestamp`; drop its "
        "entry from NOT_THE_ANALYSIS_WINDOW_IN"
    )
