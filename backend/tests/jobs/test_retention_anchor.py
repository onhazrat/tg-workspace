"""Anchor posts survive retention cleanup."""

from __future__ import annotations

from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import save_setting
from app.models_tg import Post


def test_retention_keeps_anchor_posts() -> None:
    with Session(engine) as session:
        save_setting(
            session, "retention", {"postRetentionDays": 30, "logRetentionDays": 0}
        )
        old_ts = 1_000_000_000_000
        anchor = Post(
            channel_name="ret-anchor-ch",
            post_id=10,
            text="anchor",
            timestamp=old_ts,
            is_anchor=True,
        )
        regular = Post(
            channel_name="ret-anchor-ch",
            post_id=11,
            text="old",
            timestamp=old_ts,
            is_anchor=False,
        )
        session.add(anchor)
        session.add(regular)
        session.commit()

        result = run_retention_cleanup(session)
        assert result["deletedPosts"] == 1

        remaining = session.exec(
            select(Post).where(Post.channel_name == "ret-anchor-ch")
        ).all()
        assert len(remaining) == 1
        assert remaining[0].post_id == 10
        assert remaining[0].is_anchor is True
