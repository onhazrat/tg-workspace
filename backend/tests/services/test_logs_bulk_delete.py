"""clear_logs / delete_old_logs delete in SQL, not row-by-row in Python.

Both are reachable from user-triggered endpoints (data.py). They previously
selected every matching row into memory before deleting it — the same OOM
shape the scheduled retention sweep was already fixed for.
"""

from __future__ import annotations

import uuid

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import SyncLog, utc_now
from app.services.logs import clear_logs, delete_old_logs

DAY_MS = 24 * 60 * 60 * 1000


def _now_ms() -> int:
    return int(utc_now().timestamp() * 1000)


def _seed(rows: list[tuple[str, int, uuid.UUID | None]]) -> None:
    with Session(engine) as session:
        for log_id, timestamp, user_id in rows:
            session.add(
                SyncLog(
                    id=log_id,
                    user_id=user_id,
                    channel_name="ch",
                    status="success",
                    timestamp=timestamp,
                )
            )
        session.commit()


def _ids() -> set[str]:
    with Session(engine) as session:
        return {row.id for row in session.exec(select(SyncLog)).all()}


def test_clear_logs_deletes_all_and_returns_count() -> None:
    _seed([(f"clear-{i}", _now_ms(), None) for i in range(5)])

    with Session(engine) as session:
        assert clear_logs(session, "sync") == 5

    assert _ids() == set()


def test_clear_logs_on_empty_table_returns_zero() -> None:
    with Session(engine) as session:
        assert clear_logs(session, "sync") == 0


def test_delete_old_logs_removes_only_expired() -> None:
    now = _now_ms()
    _seed([("old", now - 10 * DAY_MS, None), ("fresh", now - 1 * DAY_MS, None)])

    with Session(engine) as session:
        deleted = delete_old_logs(session, older_than_days=5)

    assert deleted["sync"] == 1
    assert _ids() == {"fresh"}


def test_delete_old_logs_returns_a_count_per_log_type() -> None:
    with Session(engine) as session:
        deleted = delete_old_logs(session, older_than_days=5)

    assert set(deleted) == {"publish", "sync", "llm", "embedding", "network"}
    assert all(isinstance(v, int) for v in deleted.values())


def test_delete_old_logs_sweeps_every_account() -> None:
    """The Admin purge crosses accounts, which is why it is Admin-gated.

    It used to narrow itself to `user_id == operator OR IS NULL`, so an
    administrative sweep quietly skipped every other account's rows while its
    own docstring said it swept them all. Ticket 19 took sync logs off any
    account's books and ticket 20 removed the filter.
    """
    now = _now_ms()
    mine = uuid.uuid4()
    theirs = uuid.uuid4()
    _seed(
        [
            ("mine-old", now - 10 * DAY_MS, mine),
            ("theirs-old", now - 10 * DAY_MS, theirs),
            ("unowned-old", now - 10 * DAY_MS, None),
            ("fresh", now - 1 * DAY_MS, theirs),
        ]
    )

    with Session(engine) as session:
        deleted = delete_old_logs(session, older_than_days=5)

    assert deleted["sync"] == 3
    assert _ids() == {"fresh"}
