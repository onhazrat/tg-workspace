"""Delete paths converted from fetch-then-Python-loop to bulk SQL.

These had no test coverage at all, which is why converting them did not move
the suite. Each previously materialised every matching row before deleting it
— the same shape that OOM-killed the worker on staging.

The channel cases moved from `delete_channel` to `collect_unfollowed_channel`
when ticket 05 split unfollow from delete. The bulk SQL is the same and still
worth guarding, but nothing reaches it from a request any more: retention calls
it once a Channel has no followers left. What removal does now is guarded in
`test_unfollow.py`.
"""

from __future__ import annotations

from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import Post
from app.services import walked_ranges
from app.services.channels import collect_unfollowed_channel
from app.services.walked_ranges import Span, channel_ranges, record_page
from tests.utils.setting_groups import add_test_channel


def _add_posts(session: Session, channel: str, count: int) -> None:
    for i in range(count):
        session.add(
            Post(
                channel_name=channel,
                post_id=i,
                text=f"{channel}-{i}",
                timestamp=1000 + i,
            )
        )


def _post_ids(channel: str) -> set[int]:
    with Session(engine) as session:
        return {
            p.post_id
            for p in session.exec(
                select(Post).where(col(Post.channel_name) == channel)
            ).all()
        }


def test_collection_removes_its_posts() -> None:
    with Session(engine) as session:
        add_test_channel(session, "doomed", name="doomed")
        _add_posts(session, "doomed", 5)
        session.commit()

        collect_unfollowed_channel(session, "doomed")
        session.commit()

    assert _post_ids("doomed") == set()


def test_collection_leaves_other_channels_alone() -> None:
    """The bulk DELETE must stay scoped to the channel being removed."""
    with Session(engine) as session:
        add_test_channel(session, "doomed", name="doomed")
        add_test_channel(session, "keeper", name="keeper")
        _add_posts(session, "doomed", 3)
        _add_posts(session, "keeper", 4)
        session.commit()

        collect_unfollowed_channel(session, "doomed")
        session.commit()

    assert _post_ids("doomed") == set()
    assert _post_ids("keeper") == {0, 1, 2, 3}


def test_collection_with_no_posts_succeeds() -> None:
    with Session(engine) as session:
        add_test_channel(session, "empty", name="empty")
        session.commit()
        assert collect_unfollowed_channel(session, "empty") == 0
        session.commit()


def test_clearing_ranges_stays_with_its_channel() -> None:
    with Session(engine) as session:
        for name in ("ch", "other"):
            record_page(session, name, Span(lo_id=1, hi_id=9, lo_ts=1, hi_ts=9))
        session.commit()

        walked_ranges.clear(session, "ch")
        session.commit()

        assert channel_ranges(session, "ch") == []
        assert len(channel_ranges(session, "other")) == 1
