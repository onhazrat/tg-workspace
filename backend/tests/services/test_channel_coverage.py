"""Channel coverage and anchor assignment."""

from __future__ import annotations

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Post
from app.services.channels import update_channel_coverage
from tests.utils.setting_groups import add_test_channel


def test_young_history_sets_incomplete_flag() -> None:
    with Session(engine) as session:
        channel = add_test_channel(session, "cov-ch")
        session.add(
            Post(
                channel_name="cov-ch",
                post_id=1,
                text="recent",
                timestamp=2_000_000_000_000,
            )
        )
        session.commit()

        scrape_cutoff = 1_000_000_000_000
        update_channel_coverage(session, channel, scrape_cutoff)
        session.commit()
        session.refresh(channel)

        assert channel.history_complete_to_cutoff is False
        assert channel.anchor_post_id is None
        assert channel.oldest_stored_post_timestamp == 2_000_000_000_000


def test_anchor_assigned_to_newest_post_before_cutoff() -> None:
    with Session(engine) as session:
        channel = add_test_channel(session, "cov-ch-2")
        session.add(
            Post(
                channel_name="cov-ch-2",
                post_id=1,
                text="old",
                timestamp=500_000_000_000,
            )
        )
        session.add(
            Post(
                channel_name="cov-ch-2",
                post_id=2,
                text="boundary",
                timestamp=900_000_000_000,
            )
        )
        session.add(
            Post(
                channel_name="cov-ch-2",
                post_id=3,
                text="recent",
                timestamp=2_000_000_000_000,
            )
        )
        session.commit()

        scrape_cutoff = 1_000_000_000_000
        update_channel_coverage(session, channel, scrape_cutoff)
        session.commit()
        session.refresh(channel)

        assert channel.history_complete_to_cutoff is True
        assert channel.anchor_post_id == 2

        anchor_row = session.exec(
            select(Post).where(Post.channel_name == "cov-ch-2", Post.post_id == 2)
        ).first()
        assert anchor_row is not None
        assert anchor_row.is_anchor is True
