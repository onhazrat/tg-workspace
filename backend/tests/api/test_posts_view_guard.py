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

## The Action path reads through the Artifact coverage module (ADR-038)

The prompts a Summary gets were built four ways: Generate and Retry applied
the frozen Selection rules to today's corpus, and the scheduler read every
Post of the predecessor's Channels with a raw `select(Post)`, no Follow
scoping, no limits and its own formatter. Chat turns and Tag runs read the
Posts tab's selection of today, and a Discovery report resolved its selection
a second time. So an Action-path module that names `resolve_posts_view`,
`apply_analysis_window` or `select(Post)` fails: it is building its own Post
read instead of asking `services/artifact_coverage.py` which Posts the
Artifact covers.

Mutation-checked by restoring the scheduler's inline Post read (AC-01), by
naming `resolve_posts_view` in the AI routes (AC-02), and, once the Action path
was derived, by a `select(Post)` in the start-Attempt route nobody listed.
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


APP = DATA_ROUTES.parents[2]

#: The doors to an Artifact's Covered Posts: freezing them, reading them, the
#: prompt builders over them, and the Attempt that builds a Summary's prompt.
COVERAGE_DOORS = frozenset(
    {
        "freeze",
        "covered_posts",
        "posts_block",
        "refs_predicate",
        "summary_prompt",
        "chat_system_prompt",
        "tag_prompt",
        "start_attempt",
    }
)

#: Modules that use a door and may still build a Post read, and why.
NOT_ACTION_PATH = {
    "services/artifact_coverage.py": "The read model itself: the one place an "
    "Action builds a Post read.",
    "api/routes/data/discover.py": "Freezes a Discovery report like every "
    "Action, and also serves the Discover tab's own Posts view through "
    "`resolve_posts_view` (ADR-036), which builds no prompt.",
}


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


def _named_in(path: pathlib.Path) -> set[str]:
    return {name for name, _ in _named(ast.parse(path.read_text(), filename=str(path)))}


def _action_path() -> list[str]:
    """Every module that uses a door to the Covered Posts: the Action path.

    Derived, so a new Action-path module is guarded the day it asks for
    Covered Posts, without anybody remembering to list it.
    """
    return sorted(
        rel
        for path in APP.rglob("*.py")
        if not (rel := path.relative_to(APP).as_posix()).startswith("alembic/")
        and rel not in NOT_ACTION_PATH
        and _named_in(path) & COVERAGE_DOORS
    )


ACTION_PATH = _action_path()

#: What building a Post read by hand names.
POST_READERS = frozenset({"resolve_posts_view", "apply_analysis_window"})


def test_the_action_path_is_found_from_the_doors() -> None:
    """A floor, so a derivation that broke and found nothing cannot pass.

    Summary generation, the scheduler's regeneration, the AI routes, the
    prompt builders, Discovery reports, Chat sessions, Tag runs and Summaries.
    The Discover aggregate's own window code (`services/discover.py`) is not
    one.
    """
    assert {
        "jobs/summary_generation.py",
        "jobs/auto_summary.py",
        "api/routes/ai_routes.py",
        "services/artifact_prompts.py",
        "services/discover_reports.py",
        "services/chat_sessions.py",
        "services/tag_runs.py",
        "services/summaries.py",
    } <= set(ACTION_PATH)
    assert "services/discover.py" not in ACTION_PATH


def _post_reads(tree: ast.Module) -> list[tuple[str, int]]:
    """Every Post-read builder `tree` names, and every `select(Post, ...)`."""
    found = [(name, line) for name, line in _named(tree) if name in POST_READERS]
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name | ast.Attribute)
            and (getattr(node.func, "id", None) or getattr(node.func, "attr", None))
            in {"select", "sa_select"}
            and any(isinstance(a, ast.Name) and a.id == "Post" for a in node.args)
        ):
            found.append(("select(Post)", node.lineno))
    return found


@pytest.mark.parametrize("name", ACTION_PATH)
def test_no_action_path_module_builds_its_own_post_read(name: str) -> None:
    path = APP / name
    offenders = sorted(
        {
            f"{found} (line {line})"
            for found, line in _post_reads(
                ast.parse(path.read_text(), filename=str(path))
            )
        }
    )

    assert not offenders, (
        f"{name} builds its own Post read: {', '.join(offenders)}. An Artifact's "
        "prompt reads its Covered Posts through `services/artifact_coverage.py` "
        "(ADR-038)."
    )


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
