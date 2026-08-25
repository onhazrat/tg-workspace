"""Pytest helpers for TG table cleanup."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from tg_test_pollution import cleanup_channel_keys, truncate_tg_tables  # noqa: F401

from app.core.db import engine

__all__ = ["cleanup_channel_keys", "purge_all_sync_lanes", "truncate_all_tg_tables"]


def truncate_all_tg_tables() -> None:
    with Session(engine) as session:
        truncate_tg_tables(session)


def purge_all_sync_lanes() -> None:
    """Empty every PGMQ sync lane between tests.

    The per-test truncate covers `tg_*`, and PGMQ's tables are in the `pgmq`
    schema — so before this, **queued messages were the one piece of state that
    survived a test**. They are also durable by design, which is the whole point
    of the queue, so this leaks in exactly the direction that is hardest to
    read: `test_bulk_follow` enqueues Channels it never drains, and the next
    module to run a worker picks up that mail alongside its own. The symptom was
    the first test of `test_sync_jobs.py` timing out while every test after it
    passed, in the full suite only.

    Uses `pgmq.purge_queue`, one statement per lane, rather than a read/delete
    loop — this runs after every test in the suite.
    """
    from app.services.sync_lanes import DRAIN_ORDER

    with Session(engine) as session:
        for lane in DRAIN_ORDER:
            session.execute(text("SELECT pgmq.purge_queue(:lane)"), {"lane": lane})
        session.commit()
