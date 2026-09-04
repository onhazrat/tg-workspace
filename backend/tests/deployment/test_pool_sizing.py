"""The database pool and the thread pool are sized, not defaulted.

`create_engine` with no pool arguments is 5 connections plus 10 overflow, a
number SQLAlchemy chose for a generic application. The scraping Partition is as
wide as the proxy fleet and every Channel walk holds a session, so a ten-proxy
deployment can want more than fifteen at once. What happens then is nothing:
the surplus waits inside the pool, which raises no error and writes no log.
"sync got slower and nothing is wrong" is the shape this repo has twice
recorded as impossible to diagnose after the fact (`MEMORY.md`,
`scheduler-tick-db-cost`), which is why it is asserted rather than left to a
comment (ADR-012).

**The thread pool is the same number and that is the point.** Almost every
`asyncio.to_thread` call in the worker opens a `Session`, so raising the
connection pool alone moves the queue one layer down: the default executor is
`min(32, cpu_count + 4)`, which on a two-core box is six, and six threads
cannot use thirty connections. Sizing one without the other buys nothing an
operator can see.
"""

from __future__ import annotations

import ast
import inspect
import pathlib

from app.core import db
from app.core.config import Settings


def _engine_call_kwargs() -> set[str]:
    """The keywords `create_engine` is actually called with, from the AST.

    Read from source rather than off the live engine, because the point is
    whether the code *states* the size. `engine.pool.size()` answers with
    SQLAlchemy's default just as confidently as with ours, so it would pass
    against exactly the code this guard exists to reject.
    """
    tree = ast.parse(pathlib.Path(inspect.getfile(db)).read_text())
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "create_engine"
        ):
            return {kw.arg for kw in node.keywords if kw.arg}
    raise AssertionError("app/core/db.py no longer calls create_engine")


def test_the_engine_states_its_pool_size() -> None:
    kwargs = _engine_call_kwargs()

    assert "pool_size" in kwargs and "max_overflow" in kwargs, (
        "the engine is back on SQLAlchemy's 5 + 10 default, which the scraping "
        "partition outgrows without erroring or logging anything"
    )


def test_the_pool_is_wider_than_the_default_it_replaced() -> None:
    """Sized *up*, not merely spelled out. Writing `pool_size=5` explicitly
    would satisfy the assertion above and change nothing at all."""
    assert Settings.model_fields["DB_POOL_SIZE"].default > 5
    assert db.db_pool_capacity() >= Settings.model_fields["DB_POOL_SIZE"].default


def _worker_tree() -> ast.Module:
    from app import worker

    return ast.parse(pathlib.Path(inspect.getfile(worker)).read_text())


def _executor_max_workers() -> ast.expr:
    """The expression passed as `max_workers` to the installed executor.

    Reached through `set_default_executor`'s argument rather than by searching
    the module for a `ThreadPoolExecutor`, so an executor that is constructed
    and then dropped cannot answer for one that is installed.
    """
    for node in ast.walk(_worker_tree()):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "set_default_executor"
            and node.args
            and isinstance(node.args[0], ast.Call)
        ):
            for kw in node.args[0].keywords:
                if kw.arg == "max_workers":
                    return kw.value
    raise AssertionError(
        "nothing installs a sized executor, so `asyncio.to_thread` is back on "
        "min(32, cpu_count + 4) — six threads on the two-core box this runs on"
    )


def test_the_worker_sizes_its_thread_pool_from_the_connection_pool() -> None:
    """Derived, not a literal: more threads than connections is the same queue
    one layer down, minus the ability to say which layer it is in.

    Read off the `max_workers` **expression**, not out of the function's
    source text. The first version of this checked `"db_pool_capacity()" in
    inspect.getsource(...)` and stayed green when the size was replaced with
    the literal 34, because the log line one statement below still named the
    function. That is the same trap `test_worker_count.py` documents, walked
    into again, and caught by mutating the size out and watching this pass.
    """
    size = _executor_max_workers()
    named = {
        node.func.id
        for node in ast.walk(size)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }

    assert "db_pool_capacity" in named, (
        "the worker's thread pool no longer derives from the connection pool, "
        "so raising one silently leaves the other as the bottleneck"
    )


def test_the_worker_sizes_it_before_it_touches_the_database() -> None:
    """Ordering, because `set_default_executor` only affects `to_thread` calls
    made after it. Installed halfway through boot, the reconcile and the first
    scheduler tick would run on the default pool and the guard above would
    still be green.

    Ordered by line number, **not** by `ast.walk` order. `walk` is
    breadth-first, so it reported the same sequence whichever statement came
    first and this assertion could not fail at all until it was mutated.
    """
    main = next(
        node
        for node in ast.walk(_worker_tree())
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "main"
    )
    calls: list[tuple[int, str]] = []
    for node in ast.walk(main):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                calls.append((node.lineno, node.func.id))
            elif isinstance(node.func, ast.Attribute):
                calls.append((node.lineno, node.func.attr))
    called = [name for _, name in sorted(calls)]

    assert "_size_the_thread_pool" in called, "the worker never sizes its pool"
    assert called.index("_size_the_thread_pool") < called.index("init_db"), (
        "the executor is installed after the first database work, so boot runs "
        "on the default thread pool"
    )
