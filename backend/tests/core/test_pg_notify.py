"""`LISTEN`/`NOTIFY` actually crosses a connection boundary (ticket 10).

The point of `pg_notify.py` is that a process which is *not* running the sync
can still be woken by it. A test that published and received on one connection
would prove nothing about that — so the assertion that matters here is that
`publish` (a SQLAlchemy connection from the pooled engine) and `Listener` (its
own psycopg connection) are two different backends, which is the same boundary
two processes have.
"""

from __future__ import annotations

import asyncio

from app.core import pg_notify

_CHANNEL = "test_sync_job_progress"


def _drain(queue: asyncio.Queue[dict[str, object]], timeout_s: float = 5.0):
    return asyncio.wait_for(queue.get(), timeout=timeout_s)


def test_a_notification_crosses_a_connection_boundary() -> None:
    async def run() -> dict[str, object]:
        pg_notify.reset_listeners_for_tests()
        listener = pg_notify.listener(_CHANNEL)
        queue = listener.subscribe()
        assert await listener.wait_until_listening(), "listener never issued LISTEN"

        await asyncio.to_thread(
            pg_notify.publish, _CHANNEL, {"jobId": "abc", "status": "running"}
        )
        try:
            return await _drain(queue)
        finally:
            listener.unsubscribe(queue)
            pg_notify.reset_listeners_for_tests()

    assert asyncio.run(run()) == {"jobId": "abc", "status": "running"}


def test_every_subscriber_gets_every_notification() -> None:
    """Two browsers watching one job must both see it.

    Fan-out is done in Python precisely so a second watcher costs a queue and
    not a second `LISTEN` connection; if `_dispatch` ever handed the message to
    one subscriber and returned, this is what catches it.
    """

    async def run() -> list[dict[str, object]]:
        pg_notify.reset_listeners_for_tests()
        listener = pg_notify.listener(_CHANNEL)
        first, second = listener.subscribe(), listener.subscribe()
        assert await listener.wait_until_listening()

        await asyncio.to_thread(pg_notify.publish, _CHANNEL, {"jobId": "shared"})
        try:
            return [await _drain(first), await _drain(second)]
        finally:
            pg_notify.reset_listeners_for_tests()

    assert asyncio.run(run()) == [{"jobId": "shared"}, {"jobId": "shared"}]


def test_an_oversized_payload_is_dropped_rather_than_raised() -> None:
    """Postgres rejects a >8000-byte payload at send time, and the send here
    happens inside a running sync — an exception would surface as a scrape
    failure with nothing in it naming the real cause. Dropping with a log line
    keeps a payload bug from being able to fail a sync."""

    async def run() -> bool:
        pg_notify.reset_listeners_for_tests()
        listener = pg_notify.listener(_CHANNEL)
        queue = listener.subscribe()
        assert await listener.wait_until_listening()

        await asyncio.to_thread(
            pg_notify.publish,
            _CHANNEL,
            {"padding": "x" * (pg_notify.MAX_PAYLOAD_BYTES)},
        )
        # Then a well-sized one, to prove the channel still works after the drop.
        await asyncio.to_thread(pg_notify.publish, _CHANNEL, {"jobId": "after"})
        try:
            return await _drain(queue) == {"jobId": "after"}
        finally:
            pg_notify.reset_listeners_for_tests()

    assert asyncio.run(run()), "the oversized payload was delivered, or it raised"
