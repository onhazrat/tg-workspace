"""Every service module declares which of the five kinds it is (H3).

`CLAUDE.md` states the rule: `app/services/` has one module per *kind*, and new
code must fit one and say which. It also warns **never split a module because it
got long** — a file extracted only to reduce a line count must fit a kind or be
merged back.

That rule was prose, and prose is how a 44-module directory becomes 60. This
test makes the classification a thing you cannot skip: a new module that is not
in `INVENTORY` fails, at which point you have to decide what it *is* before it
can ship. That decision, made once at creation, is the whole point.

## Two checks, not one

The inventory alone is bookkeeping. Two kinds have a property that can be
verified mechanically, so they are:

* **Pure transform** — no `Session`, no network. If one grows either, it is not
  a pure transform any more and the label is now a lie.
* **Read model** — takes a `Session`, never commits.

The other three (aggregate, integration, orchestrator) are checked by review,
because "owns one table" and "owns one external boundary" are not properties the
source text can be read for without more false positives than findings.

## The exceptions are declared, not hidden

`EXCEPTIONS` carries a reason per module. That is deliberate: an exception with a
written reason is a decision, one without is drift, and the difference matters
more than the count.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

SERVICES_DIR = pathlib.Path(__file__).resolve().parents[2] / "app" / "services"

AGGREGATE = "aggregate"
READ_MODEL = "read model"
INTEGRATION = "integration"
PURE_TRANSFORM = "pure transform"
ORCHESTRATOR = "orchestrator"

#: Every module in `app/services/`, and the kind it is.
INVENTORY: dict[str, str] = {
    # 1. Aggregate — owns one table and is the only module that writes it.
    "channel_setting_groups.py": AGGREGATE,
    "channels.py": AGGREGATE,
    # Owns `tg_chat_sessions` *and* `tg_chat_session_payloads`: a companion
    # payload table belongs to its parent's aggregate, like `logs.py` and
    # `summaries.py`. The split is a storage detail the API never sees.
    "chat_sessions.py": AGGREGATE,
    "credentials.py": AGGREGATE,
    "data_vectors.py": AGGREGATE,
    "discover_ignored.py": AGGREGATE,
    "discover_probes.py": AGGREGATE,
    "discover_reports.py": AGGREGATE,
    "follows.py": AGGREGATE,
    "logs.py": AGGREGATE,
    "post_sync_state.py": AGGREGATE,
    "posts.py": AGGREGATE,
    "scraper_jobs.py": AGGREGATE,
    "settings_store.py": AGGREGATE,
    "summaries.py": AGGREGATE,
    "sync_meta.py": AGGREGATE,
    "tag_runs.py": AGGREGATE,
    # 2. Read model — read-only aggregation across tables; never commits.
    # Unions four aggregates into one time-ordered page for History. Owns no
    # table and never commits.
    "artifacts.py": READ_MODEL,
    "discover.py": READ_MODEL,
    "network_settings.py": READ_MODEL,
    "operator.py": READ_MODEL,
    "prompt_assembly.py": READ_MODEL,
    # Resolves a User's permissions from their role assignments. Reads
    # rbac_user_roles joined to rbac_roles and never commits; seeding is done by
    # the migration and init_db, so this module has no reason to write.
    "rbac.py": READ_MODEL,
    "runtime_config.py": READ_MODEL,
    # 3. Integration — owns one external boundary.
    "channel_photos.py": INTEGRATION,
    "embeddings.py": INTEGRATION,
    "network.py": INTEGRATION,
    "post_thumbnails.py": INTEGRATION,
    "proxy_pool.py": INTEGRATION,
    "publish.py": INTEGRATION,
    "scraper.py": INTEGRATION,
    # 4. Pure transform — no Session, no network, trivially testable.
    "channel_tags.py": PURE_TRANSFORM,
    "language.py": PURE_TRANSFORM,
    "post_filters.py": PURE_TRANSFORM,
    "post_links_parser.py": PURE_TRANSFORM,
    "post_media_parser.py": PURE_TRANSFORM,
    "post_reply_parser.py": PURE_TRANSFORM,
    "serialization.py": PURE_TRANSFORM,
    "sync_schedule.py": PURE_TRANSFORM,
    # The tenancy seam. Builds scoped select statements and compares owner ids, executes
    # nothing — so it is testable with no database, and acquiring a `Session`
    # later fails `test_pure_transforms_do_no_io` rather than passing quietly.
    "tenancy.py": PURE_TRANSFORM,
    "telegram_html.py": PURE_TRANSFORM,
    "telegram_web.py": PURE_TRANSFORM,
    # 5. Orchestrator — owns one workflow, coordinates the other four.
    "bulk_channels.py": ORCHESTRATOR,
    "bulk_follow.py": ORCHESTRATOR,
    "data_import_export.py": ORCHESTRATOR,
    "sync_orchestrator.py": ORCHESTRATOR,
}

#: Modules that do not fit a kind, and why. Adding to this needs a reason.
EXCEPTIONS: dict[str, str] = {
    "async_db.py": (
        "Infrastructure utility — belongs in core/, not services/. Runs blocking "
        "SQLAlchemy work off the event loop; it is not domain code at all."
    ),
    "followed_channels.py": (
        "Writes Channel alongside channels.py, breaking the one-writer rule on "
        "purpose so the Discover and auto-follow paths share one creation path. "
        "Two creation paths was the alternative, and was worse."
    ),
    "stats.py": (
        "Read model plus one destructive admin operation. `clear_table` deletes "
        "across every aggregate's table and commits, so it is not the read-only "
        "module CLAUDE.md describes. It is here rather than relabelled because "
        "moving `clear_table` into each aggregate would spread a single admin "
        "action across fifteen modules."
    ),
}


def _modules() -> list[str]:
    return sorted(p.name for p in SERVICES_DIR.glob("*.py") if p.name != "__init__.py")


def _parse(name: str) -> ast.Module:
    path = SERVICES_DIR / name
    return ast.parse(path.read_text(), filename=str(path))


def _imported_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                names.add(node.module.split(".")[0])
            names.update(a.name for a in node.names)
    return names


def test_every_service_module_is_classified() -> None:
    """A new module must declare its kind before it can ship.

    This is the check that does the work. The five kinds exist so that "where
    does this code go?" has an answer that is not "a new file"; leaving a module
    unclassified is how that erodes.
    """
    on_disk = set(_modules())
    declared = set(INVENTORY) | set(EXCEPTIONS)

    unclassified = sorted(on_disk - declared)
    assert not unclassified, (
        f"New service module(s) with no declared kind: {unclassified}. "
        f"Add each to INVENTORY as one of the five kinds "
        f"({AGGREGATE}, {READ_MODEL}, {INTEGRATION}, {PURE_TRANSFORM}, "
        f"{ORCHESTRATOR}) — see CLAUDE.md. If it genuinely fits none, add it to "
        f"EXCEPTIONS with a reason. 'It got long' is not a reason: a file "
        f"extracted only to reduce a line count must fit a kind or be merged back."
    )

    stale = sorted(declared - on_disk)
    assert not stale, f"Declared but no longer on disk: {stale}"


@pytest.mark.parametrize(
    "name", sorted(n for n, k in INVENTORY.items() if k == PURE_TRANSFORM)
)
def test_pure_transforms_do_no_io(name: str) -> None:
    """The one property that makes a pure transform worth the label: **no I/O**.

    It is what makes these modules trivially testable — no fixture, no mock, no
    database. A `Session` or an HTTP client means it has become something else
    and should be reclassified, not quietly widened.

    Note what is *not* forbidden: importing `sqlalchemy` to build a
    `ColumnElement`. `post_filters.py` does exactly that — it constructs query
    predicates and executes none of them, so it stays deterministic and needs no
    database to test. A first draft of this check banned the import outright and
    flagged it; that was the check being wrong, not the module. **`Session` is
    the load-bearing signal**, because without one nothing can be executed.
    """
    imported = _imported_names(_parse(name))
    forbidden = imported & {"Session", "httpx", "aiohttp", "requests", "engine"}

    assert not forbidden, (
        f"{name} is declared a pure transform but imports {sorted(forbidden)}. "
        f"Either drop the dependency or reclassify it in INVENTORY."
    )


@pytest.mark.parametrize(
    "name", sorted(n for n, k in INVENTORY.items() if k == READ_MODEL)
)
def test_read_models_never_commit(name: str) -> None:
    """A read model takes a `Session` and leaves the transaction to its caller.

    A commit here is how a read path quietly becomes a write path — and then two
    modules write the same table, which is the exact thing the aggregate rule
    exists to prevent. `stats.py` is the module that already did this; it is a
    declared exception rather than a silent one.
    """
    commits = [
        node.lineno
        for node in ast.walk(_parse(name))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "commit"
    ]

    assert not commits, (
        f"{name} is declared a read model but commits at line(s) {commits}. "
        f"Move the write into the aggregate that owns the table, or reclassify."
    )
