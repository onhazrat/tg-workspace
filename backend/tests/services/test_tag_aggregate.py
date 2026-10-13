"""`services/tags.py` is the only writer of `tg_tags` (ADR-029, DFP-03).

The Follow's writer used to write Tags as a JSON column. Moving them to a table
of their own is only half done if a second module can write that table, so the
writes are found in the AST: a `Tag(...)` construction, or an insert, update or
delete statement naming `Tag`, anywhere in `app/` or `scripts/` outside the
aggregate. Reads are free to name the model; the export does.
"""

from __future__ import annotations

import ast
from pathlib import Path

from app.models_tg import Tag

BACKEND_DIR = Path(__file__).resolve().parents[2]
AGGREGATE = BACKEND_DIR / "app" / "services" / "tags.py"
WRITE_STATEMENTS = {"insert", "pg_insert", "update", "sa_update", "delete", "sa_delete"}


def _writes_tag(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
        return False
    if node.func.id == Tag.__name__:
        return True
    return (
        node.func.id in WRITE_STATEMENTS
        and bool(node.args)
        and isinstance(node.args[0], ast.Name)
        and node.args[0].id == Tag.__name__
    )


def test_only_the_tag_aggregate_writes_tags() -> None:
    files = [
        *(BACKEND_DIR / "app").rglob("*.py"),
        *(BACKEND_DIR / "scripts").rglob("*.py"),
    ]
    offenders = sorted(
        str(path.relative_to(BACKEND_DIR))
        for path in files
        if path != AGGREGATE
        and "alembic/versions" not in path.as_posix()
        and any(_writes_tag(node) for node in ast.walk(ast.parse(path.read_text())))
    )
    assert not offenders, (
        f"{offenders} write `tg_tags`. `services/tags.py` is its sole writer; "
        f"call `replace_channel_tags` or `add_tags` instead."
    )


def test_the_guard_sees_the_aggregates_own_writes() -> None:
    """Without this, a guard that matched nothing would pass on every module."""
    assert any(_writes_tag(node) for node in ast.walk(ast.parse(AGGREGATE.read_text())))
