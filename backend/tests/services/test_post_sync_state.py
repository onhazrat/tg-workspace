"""Gap detection for post_sync_state."""

from __future__ import annotations

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Post, PostSyncState
from app.services.post_sync_state import record_gaps_from_page


def test_record_gaps_between_page_neighbors() -> None:
    with Session(engine) as session:
        session.add(
            Post(
                channel_name="gap-ch",
                post_id=100,
                text="a",
                timestamp=1_000,
            )
        )
        session.add(
            Post(
                channel_name="gap-ch",
                post_id=103,
                text="b",
                timestamp=2_000,
            )
        )
        session.commit()

        seen: set[int] = set()
        record_gaps_from_page(
            session,
            "gap-ch",
            [100, 103],
            job_id="job-1",
            session_seen_ids=seen,
        )
        session.commit()

        gaps = session.exec(
            select(PostSyncState).where(PostSyncState.channel_name == "gap-ch")
        ).all()
        gap_ids = sorted(g.post_id for g in gaps)
        assert gap_ids == [101, 102]
        assert all(g.state == "confirmed_gap" for g in gaps)
