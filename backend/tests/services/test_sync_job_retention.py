"""`tg_sync_jobs` has to shrink, without ever deleting live work.

The table reached **196,047 rows / 153 MB** with no retention policy at all, and
**711 rows sat in `running`** (48 in `pending`) going back to June — stranded by
restarts, because job progress lives in `_active_jobs` and nothing reconciled the
rows afterwards.

The two halves depend on each other, which is why they are tested together:

* pruning is restricted to **terminal** rows, so a long-running sync is never
  deleted out from under a client reading its progress — but that makes a
  stranded `running` row immortal;
* reconciliation clears exactly those rows at startup, where in-memory state is
  empty and every non-terminal row is provably dead.

Drop either and the table still grows. Drop the terminal filter instead and the
table shrinks by deleting live jobs, which is worse than not shrinking.

## Asserted in both directions

Following `client-split.conform.ts`: "rows went away" is also what the broken
version does, so every test that deletes something has a counterpart asserting
what must survive.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import cast

import pytest
from sqlalchemy import event
from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import SyncJob as SyncJobRow
from app.services.scraper_jobs import (
    _TERMINAL_JOB_STATUSES,
    SYNC_JOB_DELETE_BATCH,
    clear_jobs_for_tests,
    prune_finished_jobs,
    reconcile_interrupted_jobs,
)
from tests.utils.tenancy import ANY_READER

DAY_MS = 24 * 60 * 60 * 1000


@pytest.fixture(autouse=True)
def _clean() -> None:
    clear_jobs_for_tests()


def _job(session: Session, job_id: str, *, status: str, age_days: float) -> None:
    session.add(
        SyncJobRow(
            id=job_id,
            # A real account: ticket 21's foreign key rejects a fabricated uuid,
            # and its NOT NULL rejects no owner at all. Retention is not about
            # who owns the row, so any seeded account will do.
            user_id=ANY_READER,
            status=status,
            source="test",
            channels=[],
            created_at=int(time.time() * 1000 - age_days * DAY_MS),
        )
    )


def _ids(session: Session) -> set[str]:
    return set(cast(list[str], session.exec(select(SyncJobRow.id)).all()))


# --- pruning ----------------------------------------------------------------


def test_old_finished_jobs_are_deleted() -> None:
    with Session(engine) as session:
        _job(session, "old-done", status="completed", age_days=30)
        session.commit()

        assert prune_finished_jobs(session, max_age_days=14) == 1
        assert _ids(session) == set()


def test_recent_jobs_survive() -> None:
    with Session(engine) as session:
        _job(session, "recent-done", status="completed", age_days=3)
        session.commit()

        assert prune_finished_jobs(session, max_age_days=14) == 0
        assert _ids(session) == {"recent-done"}


@pytest.mark.parametrize("status", ["running", "pending"])
def test_an_unfinished_job_is_never_pruned_however_old(status: str) -> None:
    """The direction that matters most.

    Age alone would eventually delete a sync that is still working — and that
    row is exactly what a reconnecting client reads when the SSE stream drops.
    """
    with Session(engine) as session:
        _job(session, f"ancient-{status}", status=status, age_days=365)
        session.commit()

        assert prune_finished_jobs(session, max_age_days=14) == 0
        assert _ids(session) == {f"ancient-{status}"}


@pytest.mark.parametrize("status", sorted(_TERMINAL_JOB_STATUSES))
def test_every_terminal_status_is_prunable(status: str) -> None:
    """`cancelled` and `failed` are as disposable as `completed`; pruning only
    `completed` would leave two thirds of the table growing."""
    with Session(engine) as session:
        _job(session, f"old-{status}", status=status, age_days=30)
        session.commit()

        assert prune_finished_jobs(session, max_age_days=14) == 1


def test_zero_disables_pruning() -> None:
    """Matches every other retention window in this codebase, where 0 is how an
    operator opts out rather than the shortest possible horizon."""
    with Session(engine) as session:
        _job(session, "old-done", status="completed", age_days=999)
        session.commit()

        assert prune_finished_jobs(session, max_age_days=0) == 0
        assert _ids(session) == {"old-done"}


# --- reconciliation ---------------------------------------------------------


@pytest.mark.parametrize("status", ["running", "pending"])
def test_a_job_left_mid_flight_is_failed_at_startup(status: str) -> None:
    with Session(engine) as session:
        _job(session, f"stranded-{status}", status=status, age_days=0.1)
        session.commit()

        assert reconcile_interrupted_jobs(session) == 1

        row = session.get(SyncJobRow, f"stranded-{status}")
        assert row is not None
        assert row.status == "failed"
        assert row.finished_at, "a terminal job must carry a finish time"


def test_finished_jobs_are_left_alone() -> None:
    """`reconcile` must not rewrite history — a completed job stays completed,
    and its original `finished_at` is not stamped over with the restart time."""
    finished_at = int(time.time() * 1000) - 5000
    with Session(engine) as session:
        _job(session, "already-done", status="completed", age_days=1)
        row = session.get(SyncJobRow, "already-done")
        assert row is not None
        row.finished_at = finished_at
        session.commit()

        assert reconcile_interrupted_jobs(session) == 0

        row = session.get(SyncJobRow, "already-done")
        assert row is not None
        assert row.status == "completed"
        assert row.finished_at == finished_at


def test_reconciled_rows_become_prunable() -> None:
    """The two halves meeting.

    An old stranded row is immortal under pruning alone — the terminal filter
    protects it forever. Reconciliation is what lets retention reach it.
    """
    with Session(engine) as session:
        _job(session, "stranded-old", status="running", age_days=90)
        session.commit()

        assert prune_finished_jobs(session, max_age_days=14) == 0, (
            "it should be protected while it still looks live"
        )

        reconcile_interrupted_jobs(session)

        assert prune_finished_jobs(session, max_age_days=14) == 1
        assert _ids(session) == set()


def test_reconciliation_is_idempotent() -> None:
    """It runs on every startup, and restarts can be frequent."""
    with Session(engine) as session:
        _job(session, "stranded", status="running", age_days=0.1)
        session.commit()

        assert reconcile_interrupted_jobs(session) == 1
        assert reconcile_interrupted_jobs(session) == 0


# --- transaction length -----------------------------------------------------


@contextmanager
def counted_commits() -> Iterator[list[int]]:
    count = [0]

    def on_commit(conn: object) -> None:
        count[0] += 1

    event.listen(engine, "commit", on_commit)
    try:
        yield count
    finally:
        event.remove(engine, "commit", on_commit)


def test_a_large_backlog_is_cleared_in_several_transactions() -> None:
    """Not about memory — only ids are selected, so the JSON is never loaded.

    It is about how long one transaction lasts. The first real run has ~180k
    rows to clear and `channels` is TOASTed (`pg_total_relation_size` was 871 MB
    against a 153 MB heap). A single statement over that holds a transaction
    open for its whole duration, and a long transaction pins the xmin horizon so
    autovacuum reclaims nothing — the exact failure this codebase already hit
    once today (`test_auto_sync_session_scope.py`).
    """
    with Session(engine) as session:
        for i in range(5):
            _job(session, f"bulk-{i}", status="completed", age_days=30)
        session.commit()

        with counted_commits() as commits:
            deleted = prune_finished_jobs(session, max_age_days=14, batch_size=2)

    assert deleted == 5, "every expired row must still go"
    assert commits[0] >= 3, (
        f"5 rows at batch_size=2 should take at least 3 transactions, took "
        f"{commits[0]} — the deletes are not being batched"
    )


def test_the_batch_loop_terminates_when_nothing_matches() -> None:
    """A loop whose delete silently matches nothing would spin forever, and it
    would do so inside the scheduler with no output."""
    with Session(engine) as session:
        _job(session, "fresh", status="completed", age_days=1)
        session.commit()

        assert prune_finished_jobs(session, max_age_days=14, batch_size=2) == 0
        assert _ids(session) == {"fresh"}


def test_the_default_batch_is_bounded() -> None:
    """`batch_size` defaulting to something enormous would make the batching
    real in tests and absent in production."""
    assert 0 < SYNC_JOB_DELETE_BATCH <= 10_000
