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
saying which *other* window it is. Four exist, and they are genuinely other
windows — retention's cutoff, the scraper's backward walk — not the Account's
Analysis window under another name.
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

_ORDER_OPS = (ast.Lt, ast.LtE, ast.Gt, ast.GtE)


def _is_post_timestamp(node: ast.expr) -> bool:
    """`Post.timestamp`, bare or wrapped in `col(...)`."""
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name) and func.id == "col" and node.args:
            return _is_post_timestamp(node.args[0])
        return False
    return (
        isinstance(node, ast.Attribute)
        and node.attr == "timestamp"
        and isinstance(node.value, ast.Name)
        and node.value.id == "Post"
    )


def _modules() -> list[pathlib.Path]:
    return sorted(
        path
        for path in APP_ROOT.rglob("*.py")
        # Alembic revisions are frozen history: an applied migration must keep
        # meaning what it meant, so they are never rewritten to use a helper.
        if "alembic" not in path.parts
    )


def _comparison_sites() -> dict[str, int]:
    """`module path relative to app/ -> how many ordered comparisons it makes`."""
    found: dict[str, int] = {}
    for path in _modules():
        tree = ast.parse(path.read_text())
        count = 0
        for node in ast.walk(tree):
            if not isinstance(node, ast.Compare):
                continue
            if not any(isinstance(op, _ORDER_OPS) for op in node.ops):
                continue
            operands = [node.left, *node.comparators]
            if any(_is_post_timestamp(operand) for operand in operands):
                count += 1
        if count:
            found[str(path.relative_to(APP_ROOT))] = count
    return found


def test_every_post_timestamp_comparison_is_the_predicate_or_declared() -> None:
    sites = _comparison_sites()

    undeclared = {
        module: count
        for module, count in sites.items()
        if module != THE_PREDICATE and module not in NOT_THE_ANALYSIS_WINDOW
    }

    assert undeclared == {}, (
        "these modules compare `Post.timestamp` themselves: "
        f"{sorted(undeclared)}. If this is the Account's Analysis window, use "
        "`post_filters.apply_analysis_window` — five separate copies of it is "
        "what AW-01 removed, and every one of them had an inclusive end. If it "
        "is a different window, add it to NOT_THE_ANALYSIS_WINDOW saying which."
    )


def test_the_shared_predicate_still_writes_the_comparison() -> None:
    """The guard above passes trivially if the helper stops comparing anything.

    A guard that cannot fail is worse than none, and this is the way this one
    would stop being able to: refactor the bounds into a string, a raw
    `text()`, or a column object built somewhere else, and every assertion here
    goes green over a codebase with no half-open window left in it.
    """
    assert _comparison_sites().get(THE_PREDICATE, 0) >= 2, (
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
