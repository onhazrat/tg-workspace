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
the shape of that payload (`app/jobs/sync_queue.py` is the only
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


def send_batch(
    session: Session, queue_name: str, messages: list[dict[str, Any]]
) -> list[int]:
    """Enqueue many messages in one statement. Returns their `msg_id`s.

    `pgmq.send_batch` takes a `jsonb[]`, so this is one round trip and one row
    lock regardless of size. That matters because ticket 10 enqueues **one
    message per Channel**: a `sync_all` on this deployment is ~2,000 messages,
    and sending them one at a time meant 2,000 sequential round trips inside the
    request that started the sync, before it could answer with a job id.

    Caller commits, same convention as `send`.
    """
    if not messages:
        return []
    rows = session.execute(
        text("SELECT * FROM pgmq.send_batch(:queue, CAST(:msgs AS jsonb[]))"),
        {"queue": queue_name, "msgs": [json.dumps(m) for m in messages]},
    ).all()
    return [int(row[0]) for row in rows]


def read(
    session: Session,
    queue_name: str,
    *,
    vt_seconds: int,
    qty: int,
    matching: dict[str, Any] | None = None,
) -> list[PgmqMessage]:
    """Claim up to `qty` due messages, hiding them for `vt_seconds`.

    `pgmq.read` locks candidates `FOR UPDATE SKIP LOCKED`, so calling this
    concurrently (the post-enqueue kick racing the periodic sweep in
    `app/jobs/sync_queue.py`) never claims the same row twice.

    `matching` is PGMQ's own `conditional` parameter: a `jsonb` fragment the
    message must contain (`message @> conditional`). Ticket 12 reads one lane
    once per User with `{"userId": ...}`, which is what makes a lane fair
    across accounts — PGMQ is FIFO by `msg_id`, so a plain read of the head
    hands back 2,000 of the first User's messages and never reaches the second
    User's three, however the caller reorders what it got.

    **Not `pgmq.read_grouped_rr`**, which exists and looks like exactly this
    feature. It layers round-robin across a header group, but only from groups
    whose *head* message is currently visible — so claiming one of an account's
    messages makes every other message of that account unreadable until it is
    archived. That is one sync at a time per account, which trades the fairness
    problem for a worse throughput one.
    """
    rows = session.execute(
        text(
            "SELECT msg_id, read_ct, message "
            "FROM pgmq.read(:queue, :vt, :qty, CAST(:cond AS jsonb))"
        ),
        {
            "queue": queue_name,
            "vt": vt_seconds,
            "qty": qty,
            "cond": json.dumps(matching or {}),
        },
    ).all()
    return [
        PgmqMessage(msg_id=r.msg_id, read_ct=r.read_ct, message=r.message) for r in rows
    ]


#: What `distinct_due_values` returns for a message enqueued with no account.
#: A real value, not a missing row: it takes its own turn in the round-robin and
#: stays distinct from every account. Spelled as the empty string rather than
#: `None` so it can be ordered and compared as a cursor in SQL.
NO_VALUE = ""


def distinct_due_values(
    session: Session,
    queue_name: str,
    field: str,
    *,
    limit: int,
    after: str | None = None,
) -> list[str]:
    """The distinct values of one top-level message field among *due* messages.

    Ticket 12 asks it for `userId`, to learn which accounts have work waiting on
    a lane before reading it. Only due messages count: a value whose every
    message is already claimed and in flight would otherwise take a turn in the
    round-robin and read back nothing, wasting the turn every pass.

    `limit` bounds the answer because it bounds the reads that follow it — one
    read per value.

    **`after` is what stops that bound becoming its own starvation.** Ordering
    by value and taking the first `limit` looks like it self-corrects, on the
    reasoning that the accounts served have their messages claimed out of the
    due set — but that only holds if an account's whole backlog fits in one
    read. With 25 accounts holding a thousand channels each, every pass claims a
    handful from the same 20 lowest-sorted ids, all of whom still have hundreds
    due, and account 21 is never read at all. That is the exact failure this
    function exists to prevent, moved up a level. The caller keeps the last
    value it saw and passes it back, so the window rotates.
    """
    qtable = f"q_{queue_name}"
    where = "WHERE vt <= clock_timestamp()"
    params: dict[str, Any] = {"field": field, "limit": limit}
    if after is not None:
        where += " AND COALESCE(message->>:field, '') > :after"
        params["after"] = after
    rows = session.execute(
        text(
            f"SELECT DISTINCT COALESCE(message->>:field, '') AS v "  # noqa: S608 — queue_name is our own constant, never user input
            f'FROM pgmq."{qtable}" {where} ORDER BY v LIMIT :limit'
        ),
        params,
    ).all()
    return [row.v for row in rows]


def queued_messages(session: Session, queue_name: str) -> list[PgmqMessage]:
    """Every message still on the queue, claimed or not, oldest first.

    Deliberately *not* a `read`: it neither claims anything nor bumps
    `read_ct`. `sync_lane_control.drain_lane` needs to see the messages a
    crashed worker is still holding under its visibility timeout as well as the
    due ones — a purge that skipped them would leave them to be redelivered
    onto a lane the operator has just emptied.
    """
    qtable = f"q_{queue_name}"
    rows = session.execute(
        text(
            f'SELECT msg_id, read_ct, message FROM pgmq."{qtable}" ORDER BY msg_id'  # noqa: S608 — queue_name is our own constant, never user input
        )
    ).all()
    return [
        PgmqMessage(msg_id=r.msg_id, read_ct=r.read_ct, message=r.message) for r in rows
    ]


def archive_batch(session: Session, queue_name: str, msg_ids: list[int]) -> list[int]:
    """Archive many messages in one statement. Returns the ids that existed."""
    if not msg_ids:
        return []
    rows = session.execute(
        text("SELECT * FROM pgmq.archive(:queue, CAST(:ids AS bigint[]))"),
        {"queue": queue_name, "ids": msg_ids},
    ).all()
    return [int(row[0]) for row in rows]


def set_vt(session: Session, queue_name: str, msg_id: int, vt_seconds: int) -> None:
    """Reset a claimed message's visibility timeout.

    Used on worker shutdown to hand back messages that were claimed but never
    finished. Without it they stay invisible for the whole VT (~2.4 hours at
    current defaults) even though the process holding them is gone — and in dev
    that is every file save, because compose restarts the worker on change.

    Errors are the caller's to handle: this runs during shutdown, where a
    failure means the message waits out its VT, which is the status quo it is
    trying to improve on.
    """
    session.execute(
        text("SELECT pgmq.set_vt(:queue, :msg_id, :vt)"),
        {"queue": queue_name, "msg_id": msg_id, "vt": vt_seconds},
    )


def archive(session: Session, queue_name: str, msg_id: int) -> bool:
    """Move a message to `pgmq.a_<queue>` permanently. True if it existed.

    Used on both success and exhausted-redelivery (decision 32: "archive on
    success too") — the archive table is the record of what the lane
    processed, not a dead-letter queue only. Nothing prunes it yet; that is
    left for a future ticket the same way `docs/multi-user-tenancy-plan.md`
    leaves it (see the module docstring in `app/jobs/sync_queue.py`).
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
