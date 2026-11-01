"""Which Channels a sync just changed, pushed to the browsers that follow them
(WR-02, ADR-044).

The worker announces a Channel's name when a walk applies a page or reads the
head, and when the job row records the Channel's sync as over, since that is
when the window check stops reading it as in flight. The API forwards the names
an Account follows, gathered per second, and the browser asks the check again
for those Channels alone. A name, never a verdict: the check stays on the
server, and a name always fits `pg_notify`'s 8000-byte cap.

A notification is a hint to look, never the only copy (`core/pg_notify.py`):
after a reconnect the browser asks the whole check once.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Iterable

from sqlmodel import Session, col, select

from app.core import pg_notify
from app.core.db import engine
from app.models_tg import Channel
from app.services.async_db import run_db
from app.services.tenancy import scoped_select

logger = logging.getLogger(__name__)

CHANNEL_CHANGED_CHANNEL = "channel_changed"

#: How long a burst is gathered into one frame (user story 44).
GATHER_SECONDS = 1.0


def announce(name: str) -> None:
    """Tell every API process this Channel changed. Blocking; run through
    `run_db`. Never raises: a lost hint must not fail the sync sending it."""
    try:
        pg_notify.publish(CHANNEL_CHANGED_CHANNEL, {"name": name})
    except Exception:  # noqa: BLE001
        logger.warning("could not announce a change to @%s", name)


def _followed(user_id: uuid.UUID, names: Iterable[str]) -> list[str]:
    with Session(engine) as session:
        return sorted(
            session.exec(
                scoped_select(
                    select(Channel.name).where(col(Channel.name).in_(list(names))),
                    Channel,
                    user_id,
                )
            ).all()
        )


async def followed_changes(user_id: uuid.UUID) -> AsyncIterator[list[str]]:
    """The names of Channels `user_id` follows, as their syncs change them.

    An empty list first, once listening, so the browser knows nothing it
    asks from then on can miss a change; no listening, no stream, and the
    browser reconnects. After that, each batch holds what changed within
    `GATHER_SECONDS` of its first name. The Follows are read per batch, so a
    Channel followed or unfollowed while the stream is open counts from its
    next batch.
    """
    listener = pg_notify.listener(CHANNEL_CHANGED_CHANNEL)
    queue = listener.subscribe()
    loop = asyncio.get_running_loop()
    try:
        if not await listener.wait_until_listening():
            return
        yield []
        while True:
            names = {str((await queue.get()).get("name"))}
            deadline = loop.time() + GATHER_SECONDS
            while (left := deadline - loop.time()) > 0:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=left)
                except TimeoutError:
                    break
                names.add(str(message.get("name")))
            followed = await run_db(_followed, user_id, names)
            if followed:
                yield followed
    finally:
        listener.unsubscribe(queue)
