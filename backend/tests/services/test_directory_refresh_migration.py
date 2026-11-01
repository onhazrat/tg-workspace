"""DRP-01's migration: the setting rename and the due-date recompute (ADR-045).

These run the revision's own statements rather than a copy, as
`test_tag_move_migration.py` does: a copy is a test that passes while the thing
that runs on deploy does something else. The Posting rate rebuild is pinned to
the transform in `test_directory_statistics_write_path.py`.
"""

from __future__ import annotations

import importlib
from datetime import timedelta
from types import ModuleType

import sqlalchemy as sa
from sqlmodel import Session

from app.core.db import engine
from app.jobs.settings import load_directory_settings, save_settings_section
from app.models_tg import DirectoryEntry, utc_now
from app.services.channel_directory import (
    recompute_refresh_due,
    record_probe_result,
    refresh_entries,
)
from app.services.settings_registry import DIRECTORY_KEY


def _migration() -> ModuleType:
    return importlib.import_module(
        "app.alembic.versions.b5e9d3f7a2c8_directory_refresh_by_posts_drp_01"
    )


def test_a_stored_refresh_window_becomes_the_longest_wait() -> None:
    """A deployment that stored 7 keeps 7 until an Operator changes it."""
    with Session(engine) as session:
        save_settings_section(session, DIRECTORY_KEY, {"directoryRefreshDays": 7})
        session.commit()
        session.execute(sa.text(_migration().RENAME_SETTING_SQL))
        session.commit()

        stored = load_directory_settings(session)
        assert stored["directoryRefreshMaxDays"] == 7
        assert "directoryRefreshDays" not in stored


def _seed(session: Session) -> None:
    for handle in ("live_one", "live_two", "asked"):
        record_probe_result(
            session, handle, {"isTelegramPage": True, "kind": "channel"}
        )
    record_probe_result(session, "a_bot", {"isTelegramPage": True, "kind": "bot"})
    refresh_entries(session, ["asked"])
    # As the 7-day window left them, with a rate on one.
    session.execute(
        sa.text(
            "UPDATE tg_channel_directory SET checked_at = :then, "
            "refresh_due_at = CASE WHEN handle = 'asked' THEN refresh_due_at "
            "WHEN kind = 'bot' THEN NULL ELSE :old_due END, "
            "posts_per_week = CASE WHEN handle = 'live_two' THEN 3.5 END"
        ),
        {"then": utc_now() - timedelta(days=10), "old_due": utc_now()},
    )
    session.commit()


def _due(session: Session) -> dict[str, object]:
    session.expire_all()
    return {
        handle: getattr(session.get(DirectoryEntry, handle), "refresh_due_at", None)
        for handle in ("live_one", "live_two", "asked", "a_bot")
    }


def _waits(session: Session) -> dict[str, object]:
    """Each entry's due date as a wait after its last answer, so two seedings
    a few milliseconds apart compare equal."""
    session.expire_all()
    out: dict[str, object] = {}
    for handle in ("live_one", "live_two", "a_bot"):
        row = session.get(DirectoryEntry, handle)
        assert row is not None
        due, checked = row.refresh_due_at, row.checked_at
        out[handle] = None if due is None or checked is None else due - checked
    return out


def test_the_recompute_moves_live_entries_from_the_stored_settings() -> None:
    migration = _migration()
    with Session(engine) as session:
        save_settings_section(session, DIRECTORY_KEY, {"directoryRefreshMaxDays": 60})
        session.commit()
        _seed(session)
        asked_before = _due(session)["asked"]

        connection = session.connection()
        assert migration.policy(connection) == {
            "target": 20,
            "min_days": 4,
            "max_days": 60,
        }
        connection.execute(
            sa.text(migration.RECOMPUTE_DUE_SQL), migration.policy(connection)
        )
        session.commit()
        due = _due(session)

        then = session.get(DirectoryEntry, "live_one")
        assert then is not None and then.checked_at is not None
        # No rate: the longest wait. 3.5 a week: 20 Posts in 40 days.
        assert due["live_one"] == then.checked_at + timedelta(days=60)
        assert due["live_two"] == then.checked_at + timedelta(days=40)
        assert due["asked"] == asked_before, "an on-demand Refresh stays due"
        assert due["a_bot"] is None


def test_the_frozen_recompute_agrees_with_the_live_one() -> None:
    """The revision restates `recompute_refresh_due` in SQL, frozen; on the day
    it was written the two must give the same answer."""
    migration = _migration()
    with Session(engine) as session:
        _seed(session)
        connection = session.connection()
        connection.execute(
            sa.text(migration.RECOMPUTE_DUE_SQL), migration.policy(connection)
        )
        session.commit()
        frozen = _waits(session)

        _seed(session)
        recompute_refresh_due(session)
        assert _waits(session) == frozen
