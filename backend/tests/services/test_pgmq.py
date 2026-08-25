"""PGMQ wrapper round-trip (ticket 09): send/read/archive/delete against the
real `manual_single_normal` lane the migration installs.

Not mocked — the whole point of ticket 09 is a real durable queue, and a mock
of `pgmq.*` would only prove this module calls the mock correctly.
"""

from __future__ import annotations

from sqlmodel import Session

from app.core.db import engine
from app.services import pgmq
from app.services.sync_lanes import MANUAL_SINGLE_NORMAL_LANE


def test_send_read_archive_round_trip() -> None:
    with Session(engine) as session:
        before = pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE)

        msg_id = pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": "abc123"})
        session.commit()
        assert isinstance(msg_id, int)
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == before + 1

        [claimed] = pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=60, qty=10)
        assert claimed.msg_id == msg_id
        assert claimed.read_ct == 1
        assert claimed.message == {"jobId": "abc123"}

        # Still hidden under its VT — a second read must not reclaim it.
        assert (
            pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=60, qty=10) == []
        )

        assert pgmq.archive(session, MANUAL_SINGLE_NORMAL_LANE, msg_id) is True
        session.commit()
        assert pgmq.queue_length(session, MANUAL_SINGLE_NORMAL_LANE) == before

        # Archiving twice is a clean False, not an error.
        assert pgmq.archive(session, MANUAL_SINGLE_NORMAL_LANE, msg_id) is False


def test_redelivery_after_vt_lapses() -> None:
    with Session(engine) as session:
        msg_id = pgmq.send(session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": "redeliver"})
        session.commit()

        [first] = pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=0, qty=10)
        assert first.msg_id == msg_id
        assert first.read_ct == 1

        # vt_seconds=0 means "visible again immediately" — the next read
        # reclaims the same message with read_ct incremented.
        [second] = pgmq.read(session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=60, qty=10)
        assert second.msg_id == msg_id
        assert second.read_ct == 2

        pgmq.delete(session, MANUAL_SINGLE_NORMAL_LANE, msg_id)
        session.commit()
