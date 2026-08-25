"""The scheduler must not hold a transaction open across the sync it starts.

`run_auto_sync` planned and synced inside one `with Session(engine)`, so a
transaction sat `idle in transaction` for the whole job — minutes — pinning the
xmin horizon that entire time. Autovacuum ran and reclaimed nothing. Measured on
staging:

| table | live | dead | autovacuums |
|---|---:|---:|---:|
| `tg_sync_meta` | 10 | **4,743** | 1,062 |
| `tg_channels` | 2,077 | **4,498** | 619 |

That bloat is why single-row updates by primary key stalled for seconds with no
I/O — `UPDATE tg_channels SET subscribers`, min 0 ms, **max 21,361 ms**, 112
blocks read across 778 calls. Nothing was lock-blocked (`pg_blocking_pids` was
empty on every sample); the pages were simply full of tuples that could not be
reclaimed.

The failure mode is invisible in every ordinary test: the code is correct, the
sync works, and the damage accrues in a system table over hours.

## Asserted in both directions

Following `client-split.conform.ts`:

1. no transaction is open once the sync begins, and
2. the planning session did real work first — a version that read nothing would
   satisfy (1) trivially.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest
from sqlalchemy import event
from sqlmodel import Session

import app.jobs.auto_sync as auto_sync
from app.core.db import engine
from app.services.scraper_jobs import clear_active_jobs_for_tests
from tests.utils.setting_groups import add_test_channel


@pytest.fixture(autouse=True)
def _no_leftover_active_job() -> Any:
    """`run_auto_sync` returns early while any job is active, and each test here
    leaves one behind — without this the later tests skip the sync and assert
    nothing."""
    clear_active_jobs_for_tests()
    yield
    clear_active_jobs_for_tests()


class _Recorder:
    """Counts connections left inside a transaction when the sync starts."""

    def __init__(self) -> None:
        self.open_transactions_at_sync: int | None = None
        self.statements_before_sync = 0
        self._live: set[int] = set()

    def begin(self, conn: Any) -> None:
        self._live.add(id(conn))

    def end(self, conn: Any) -> None:
        self._live.discard(id(conn))

    def statement(self, *args: Any, **kwargs: Any) -> None:
        if self.open_transactions_at_sync is None:
            self.statements_before_sync += 1

    def snapshot(self) -> None:
        self.open_transactions_at_sync = len(self._live)


@pytest.fixture
def recorder() -> Any:
    rec = _Recorder()
    event.listen(engine, "begin", rec.begin)
    event.listen(engine, "commit", rec.end)
    event.listen(engine, "rollback", rec.end)
    event.listen(engine, "before_cursor_execute", rec.statement)
    try:
        yield rec
    finally:
        event.remove(engine, "begin", rec.begin)
        event.remove(engine, "commit", rec.end)
        event.remove(engine, "rollback", rec.end)
        event.remove(engine, "before_cursor_execute", rec.statement)


def test_no_transaction_is_open_once_the_sync_starts(
    monkeypatch: pytest.MonkeyPatch, recorder: Any
) -> None:
    """The property the bloat came from.

    `run_sync_job` is where minutes are spent. Whatever the planning code did,
    it must have committed or rolled back by the time control reaches here.
    """
    with Session(engine) as session:
        add_test_channel(
            session,
            "scope-due",
            next_regular_sync_at=1,
            next_dynamic_sync_at=None,
        )
        session.commit()

    async def fake_run_sync_job(job: Any, owner_id: uuid.UUID | None) -> None:
        recorder.snapshot()

    monkeypatch.setattr(auto_sync, "enqueue_sync_job", fake_run_sync_job)

    result = asyncio.run(auto_sync.run_auto_sync())

    assert not result.get("skipped"), (
        f"nothing was synced, so nothing was proven: {result}"
    )
    assert recorder.open_transactions_at_sync == 0, (
        "a transaction was still open when the sync began — it will sit "
        "'idle in transaction' for the whole job and pin the xmin horizon"
    )


def test_the_planning_session_did_real_work_first(
    monkeypatch: pytest.MonkeyPatch, recorder: Any
) -> None:
    """The other direction.

    A `run_auto_sync` that opened no session at all would pass the test above
    perfectly, so pin that the planning actually queried the database before
    handing off.
    """
    with Session(engine) as session:
        add_test_channel(session, "scope-work", next_regular_sync_at=1)
        session.commit()

    async def fake_run_sync_job(job: Any, owner_id: uuid.UUID | None) -> None:
        recorder.snapshot()

    monkeypatch.setattr(auto_sync, "enqueue_sync_job", fake_run_sync_job)

    asyncio.run(auto_sync.run_auto_sync())

    assert recorder.statements_before_sync > 3, (
        "the planner issued almost no SQL — the scope assertion is vacuous"
    )


def test_the_plan_survives_the_session_it_was_built_in(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Closing the session early is only safe if nothing downstream holds an ORM
    object. A detached `Channel` raises on attribute access, so this would fail
    loudly rather than silently — but it would fail *in the scheduler*, where
    the only symptom is a job that stops running."""
    with Session(engine) as session:
        add_test_channel(session, "scope-detached", next_regular_sync_at=1)
        session.commit()

    seen: dict[str, Any] = {}

    async def fake_run_sync_job(job: Any, owner_id: uuid.UUID | None) -> None:
        seen["names"] = [ch.channel_name for ch in job.channels.values()]
        seen["meta"] = [ch.metadata for ch in job.channels.values()]

    monkeypatch.setattr(auto_sync, "enqueue_sync_job", fake_run_sync_job)

    result = asyncio.run(auto_sync.run_auto_sync())

    assert "scope-detached" in seen["names"]
    assert any(m.get("dueReason") for m in seen["meta"]), (
        "the due reason was lost when the session closed"
    )
    assert result["channels"] >= 1
    assert result["dueChannels"] >= 1


def test_no_orm_object_outlives_the_planning_block() -> None:
    """Read as a source-level check, because the runtime symptom is delayed.

    `to_sync` holds `Channel` rows; `entries` is the plain projection built to
    replace it. If a later edit reaches for `to_sync`, `due_channels` or
    `channels` after the `with` block, attribute access on a detached instance
    raises inside the scheduler thread — where it surfaces as "auto-sync quietly
    stopped", not as a test failure.

    **Reads names, not substrings.** This used to split the source text and
    check `"to_sync" not in after`, which reports a violation for any comment
    below the block that happens to mention `run_auto_sync` — the function's own
    name contains `to_sync`. It also needed `"channels)"` with the bracket
    attached to avoid matching the `"channels"` dict key, which is the kind of
    trick that works until the formatter moves a line. The AST has neither
    problem: comments are not in it, string literals are not `Name` nodes, and
    an identifier is matched as an identifier.
    """
    import ast
    import inspect
    import textwrap

    source = inspect.getsource(auto_sync.run_auto_sync)
    tree = ast.parse(textwrap.dedent(source))
    func = tree.body[0]
    assert isinstance(func, ast.AsyncFunctionDef)

    planning = next(
        (node for node in func.body if isinstance(node, ast.With)),
        None,
    )
    assert planning is not None, (
        "the planning `with Session(engine)` block is gone; this guard is now blind"
    )
    assert planning.end_lineno is not None

    used_after = {
        node.id
        for node in ast.walk(func)
        if isinstance(node, ast.Name)
        and node.lineno > planning.end_lineno
        and isinstance(node.ctx, ast.Load)
    }

    for name in ("to_sync", "due_channels", "partial_batch", "channels"):
        assert name not in used_after, (
            f"`{name}` is used after the planning session closes; it holds "
            "detached ORM rows. Project it to a plain value inside the block."
        )
    assert "Channel" in source, "the planner no longer touches channels at all"
