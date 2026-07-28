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


def test_reaching_channel_start_completes_young_history() -> None:
    """A channel younger than the cutoff is complete once its start is reached.

    Without this, no post can ever satisfy `oldest_ts < cutoff`, so the channel
    stays flagged partial forever and auto-sync re-backfills it every run.
    """
    with Session(engine) as session:
        channel = add_test_channel(session, "cov-ch-young")
        session.add(
            Post(
                channel_name="cov-ch-young",
                post_id=1,
                text="first post ever",
                timestamp=2_000_000_000_000,
            )
        )
        session.commit()

        scrape_cutoff = 1_000_000_000_000
        update_channel_coverage(
            session, channel, scrape_cutoff, reached_channel_start=True
        )
        session.commit()
        session.refresh(channel)

        assert channel.history_complete_to_cutoff is True
        assert channel.history_reached_channel_start is True
        # Still no post older than the cutoff, so there is nothing to anchor.
        assert channel.anchor_post_id is None


def test_reached_channel_start_survives_later_head_only_sync() -> None:
    """A head-only sync must not undo the completeness it never re-checked."""
    with Session(engine) as session:
        channel = add_test_channel(session, "cov-ch-latched")
        session.add(
            Post(
                channel_name="cov-ch-latched",
                post_id=1,
                text="first post ever",
                timestamp=2_000_000_000_000,
            )
        )
        session.commit()

        scrape_cutoff = 1_000_000_000_000
        update_channel_coverage(
            session, channel, scrape_cutoff, reached_channel_start=True
        )
        session.commit()

        # Incremental pass: stops at the newest stored post, never revisits the
        # beginning, so it reports reached_channel_start=False.
        update_channel_coverage(session, channel, scrape_cutoff)
        session.commit()
        session.refresh(channel)

        assert channel.history_reached_channel_start is True
        assert channel.history_complete_to_cutoff is True


def test_partial_channel_without_reaching_start_stays_incomplete() -> None:
    """An interrupted backward walk is still genuinely partial."""
    with Session(engine) as session:
        channel = add_test_channel(session, "cov-ch-partial")
        session.add(
            Post(
                channel_name="cov-ch-partial",
                post_id=500,
                text="as far back as we got",
                timestamp=2_000_000_000_000,
            )
        )
        session.commit()

        scrape_cutoff = 1_000_000_000_000
        update_channel_coverage(
            session, channel, scrape_cutoff, reached_channel_start=False
        )
        session.commit()
        session.refresh(channel)

        assert channel.history_reached_channel_start is False
        assert channel.history_complete_to_cutoff is False


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
