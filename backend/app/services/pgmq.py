"""Integration boundary for PGMQ (ticket 09): the durable-queue substrate.

Owns exactly one external boundary — the `pgmq.*` SQL functions the migration
in `f0a1b2c3d4e5` installs (see `app/alembic/vendor/pgmq_v1.12.0.sql`) — the
same reason `scraper.py` (t.me) and `network.py` (HTTP/proxy) are integration
modules rather than aggregates: nothing here owns an app table, it wraps a
boundary the app does not control the shape of.

PGMQ ships no Python client for the plain-SQL install path (only the Rust and
JS clients call the extension form), so this is a thin `sqlalchemy.text()`
wrapper rather than a dependency — a handful of functions, not a library.

A message's `message` column is passed and read back as `jsonb`; callers own
the shape of that payload (`app/jobs/manual_single_queue.py` is the only
caller today).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlmodel import Session


@dataclass
class PgmqMessage:
    msg_id: int
    read_ct: int
    message: dict[str, Any]


def send(session: Session, queue_name: str, message: dict[str, Any]) -> int:
    """Enqueue one message, visible immediately. Returns its `msg_id`.

    Caller commits — this does one write in whatever transaction the caller
    already holds, same convention as the rest of `app/services/`.
    """
    row = session.execute(
        text("SELECT * FROM pgmq.send(:queue, CAST(:msg AS jsonb))"),
        {"queue": queue_name, "msg": json.dumps(message)},
    ).one()
    return int(row[0])


def read(
    session: Session, queue_name: str, *, vt_seconds: int, qty: int
) -> list[PgmqMessage]:
    """Claim up to `qty` due messages, hiding them for `vt_seconds`.

    `pgmq.read` locks candidates `FOR UPDATE SKIP LOCKED`, so calling this
    concurrently (the post-enqueue kick racing the periodic sweep in
    `app/jobs/manual_single_queue.py`) never claims the same row twice.
    """
    rows = session.execute(
        text("SELECT msg_id, read_ct, message FROM pgmq.read(:queue, :vt, :qty)"),
        {"queue": queue_name, "vt": vt_seconds, "qty": qty},
    ).all()
    return [
        PgmqMessage(msg_id=r.msg_id, read_ct=r.read_ct, message=r.message) for r in rows
    ]


def archive(session: Session, queue_name: str, msg_id: int) -> bool:
    """Move a message to `pgmq.a_<queue>` permanently. True if it existed.

    Used on both success and exhausted-redelivery (decision 32: "archive on
    success too") — the archive table is the record of what the lane
    processed, not a dead-letter queue only. Nothing prunes it yet; that is
    left for a future ticket the same way `docs/multi-user-tenancy-plan.md`
    leaves it (see the module docstring in `app/jobs/manual_single_queue.py`).
    """
    return bool(
        session.execute(
            text("SELECT pgmq.archive(:queue, :msg_id)"),
            {"queue": queue_name, "msg_id": msg_id},
        ).scalar_one()
    )


def delete(session: Session, queue_name: str, msg_id: int) -> bool:
    """Remove a message permanently, with no archive row. True if it existed."""
    return bool(
        session.execute(
            text("SELECT pgmq.delete(:queue, :msg_id)"),
            {"queue": queue_name, "msg_id": msg_id},
        ).scalar_one()
    )


def queue_length(session: Session, queue_name: str) -> int:
    """Messages currently due or in flight — for tests and diagnostics."""
    qtable = f"q_{queue_name}"
    return int(
        session.execute(
            text(f'SELECT count(*) FROM pgmq."{qtable}"')  # noqa: S608 — queue_name is our own constant, never user input
        ).scalar_one()
    )
