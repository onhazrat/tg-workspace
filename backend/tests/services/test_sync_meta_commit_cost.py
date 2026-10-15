"""The etag must move in the same transaction as the change it announces.

Every caller in `sync_orchestrator` was `session.commit()` followed by
`touch_sync`, which commits again — two fsyncs per logical change, on a path that
runs per *page* as well as per channel. Staging: **181,879 `UPDATE tg_sync_meta
SET etag` in 10 hours**, 19 minutes of database time, for a table with one row
per resource.

Halving the commits is the cheap half of the reason. The other half is
correctness: split across two transactions, a crash in between leaves the data
written and the etag stale, and a stale etag does not heal — it actively tells
every client there is nothing to refetch.

## Asserted in both directions

Following `client-split.conform.ts`:

1. `commit=False` really does not commit (otherwise the change is cosmetic), and
2. it really does stage the bump, so the caller's commit carries it — a
   `commit=False` that quietly dropped the write would pass (1) perfectly while
   freezing every client's cache.
"""

from __future__ import annotations

import ast
import pathlib
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Channel, SyncMeta
from app.services.sync_meta import touch_sync
from tests.utils.setting_groups import add_test_channel


@contextmanager
def counted_commits() -> Iterator[list[int]]:
    """Counts real transaction commits, not `Session.commit()` calls.

    Hooking the session would miss the point: the question is how many times the
    database is asked to flush, which is what the 19 minutes were made of.
    """
    count = [0]

    def on_commit(conn: object) -> None:
        count[0] += 1

    event.listen(engine, "commit", on_commit)
    try:
        yield count
    finally:
        event.remove(engine, "commit", on_commit)


def _etag(session: Session, resource: str) -> str | None:
    session.expire_all()
    row = session.get(SyncMeta, resource)
    return row.etag if row else None


def test_deferring_the_bump_costs_no_commit_of_its_own() -> None:
    """The two orders, side by side, with real pending work in both.

    The work matters: a `Session.commit()` with nothing staged emits no COMMIT at
    all, so comparing the bare calls would flatter the new order for the wrong
    reason.
    """
    with Session(engine) as session:
        channel = add_test_channel(session, "commit-cost-work")
        touch_sync(session, "commit-cost-a")
        session.commit()

        with counted_commits() as new_order:
            channel.display_name = "after"
            session.add(channel)
            touch_sync(session, "commit-cost-a", commit=False)
            session.commit()

        with counted_commits() as old_order:
            channel.display_name = "before"
            session.add(channel)
            session.commit()
            touch_sync(session, "commit-cost-a")

    assert new_order[0] == 1, "the deferred form should ride the caller's commit"
    assert old_order[0] == 2, (
        "the old order is expected to cost two — if this is 1 the counter is not "
        "seeing commits and the assertion above proves nothing"
    )


def test_the_deferred_bump_is_still_written() -> None:
    """`commit=False` implemented as an early `return` would pass the test above
    and silently freeze every client's cache."""
    with Session(engine) as session:
        touch_sync(session, "commit-cost-b")
        before = _etag(session, "commit-cost-b")

        touch_sync(session, "commit-cost-b", commit=False)
        session.commit()

    with Session(engine) as verify:
        after = _etag(verify, "commit-cost-b")

    assert before is not None
    assert after is not None
    assert after != before


def test_the_bump_rolls_back_with_the_change_it_announces() -> None:
    """The correctness half.

    Under the old order the etag was already committed by the time the caller's
    work failed, leaving clients told to refetch data that was rolled back — or,
    in the crash-after-commit case, not told about data that was kept.
    """
    with Session(engine) as session:
        channel = add_test_channel(session, "commit-cost-ch", display_name="kept")
        touch_sync(session, "commit-cost-c")
        session.commit()
        before = _etag(session, "commit-cost-c")

        channel.display_name = "discarded"
        session.add(channel)
        touch_sync(session, "commit-cost-c", commit=False)
        session.rollback()

    with Session(engine) as verify:
        rolled_back = verify.get(Channel, "commit-cost-ch")
        assert rolled_back is not None
        assert rolled_back.display_name == "kept", (
            "the change did not roll back, so this proves nothing about the etag"
        )
        assert _etag(verify, "commit-cost-c") == before


def test_a_brand_new_resource_can_be_created_deferred_too() -> None:
    """The insert branch, which a `commit=False` that only handled updates would
    skip — `network_logs` is created on first use by exactly this path."""
    with Session(engine) as session:
        touch_sync(session, "commit-cost-new", commit=False)
        session.commit()

    with Session(engine) as verify:
        assert _etag(verify, "commit-cost-new") is not None


def test_the_default_still_commits_on_its_own() -> None:
    """~20 callers outside the sync path rely on it, and they have no commit of
    their own to ride."""
    with Session(engine) as session:
        touch_sync(session, "commit-cost-d")

    with Session(engine) as verify:
        assert _etag(verify, "commit-cost-d") is not None


#: Modules whose every etag bump rides the commit of the write it announces.
#: The Summary Attempt code was written after this rule and broke it at twelve
#: sites, half of them a `commit()` in a service then `touch_sync` in its
#: route, so the bump lives beside the commit and the routes say nothing.
#: Older callers elsewhere still commit twice; extend this as they move.
_SAME_COMMIT_MODULES = (
    "app/services/summary_attempts.py",
    "app/jobs/summary_generation.py",
)
_ATTEMPT_ROUTES = "app/api/routes/data/summaries.py"


def _touch_calls(tree: ast.AST) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "touch_sync"
    ]


def _defers(call: ast.Call) -> bool:
    return any(
        kw.arg == "commit"
        and isinstance(kw.value, ast.Constant)
        and kw.value.value is False
        for kw in call.keywords
    )


def _is_attempt_route(fn: ast.FunctionDef) -> bool:
    paths = [
        str(d.args[0].value)
        for d in fn.decorator_list
        if isinstance(d, ast.Call) and d.args and isinstance(d.args[0], ast.Constant)
    ]
    return any("/attempts" in p or "/failures" in p for p in paths)


def test_summary_attempt_writes_move_the_etag_in_their_own_commit() -> None:
    """Every bump in the Attempt modules is `commit=False`, and the Attempt
    routes leave it to them. Mutation-tested: dropping `commit=False` from
    `record_attempt`, or putting a bump back in the stop route, fails this."""
    root = pathlib.Path(__file__).parents[2]
    committing = [
        f"{path}:{call.lineno}"
        for path in _SAME_COMMIT_MODULES
        for call in _touch_calls(ast.parse((root / path).read_text()))
        if not _defers(call)
    ]
    assert not committing, f"{committing} commit the etag on its own"
    routes = ast.parse((root / _ATTEMPT_ROUTES).read_text())
    in_routes = [
        fn.name
        for fn in ast.walk(routes)
        if isinstance(fn, ast.FunctionDef)
        and _is_attempt_route(fn)
        and _touch_calls(fn)
    ]
    assert not in_routes, f"{in_routes} bump the etag after the service committed"
