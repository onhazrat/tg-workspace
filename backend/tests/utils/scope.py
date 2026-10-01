"""Building an Artifact's frozen Scope column in a test (AW-07).

That ticket dropped the `channels` / `start_date` / `end_date` trio every
Artifact family carried, so a fixture that seeds a row directly and then expects
the scheduler, the History union or a search to see a window has to write the
`scope` column instead — it is the only copy left.

A helper rather than a literal per test because `FrozenScope.stored()` decides
what the column actually holds (no `posts`, no `durationMinutes`), and a dozen
hand-written dicts is a dozen chances to drift from it.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.schemas.scope import FrozenScope
from tests.utils.tenancy import follow_channels


def stored_scope(*, start: int, end: int, **overrides: Any) -> dict[str, Any]:
    """The `scope` column's value for a window and any filters."""
    return FrozenScope.model_validate(
        {"start": start, "end": end, **overrides}
    ).stored()


def followed_posts(channel: str, count: int, *, at: int) -> list[dict[str, Any]]:
    """Seed `count` Posts of `channel` from `at`, followed by the Operator.

    Since PTR-05 an Artifact records the Posts its selection reached, so a
    test about those references needs Posts for it to reach. Answers their
    references in posting order.
    """
    with Session(engine) as session:
        for n in range(count):
            session.add(
                Post(
                    channel_name=channel,
                    post_id=n,
                    text=f"post {n}",
                    timestamp=at + n * 1000,
                )
            )
        session.commit()
        follow_channels(session, channel)
        session.commit()
    return [{"channelName": channel, "postId": n} for n in range(count)]
