"""Anchor posts survive retention cleanup; batched deletes cascade."""

from __future__ import annotations

import time

from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import save_settings_section
from app.models_tg import Post, PostEmbedding, PostSyncState, PostTranslation
from app.services.operator import get_operator_user_id


def test_retention_keeps_anchor_posts() -> None:
    with Session(engine) as session:
        save_settings_section(
            session, "retention", {"postRetentionDays": 30, "sharedLogRetentionDays": 0}
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


def test_retention_batches_and_cascades(monkeypatch) -> None:
    """Expired posts across the batch boundary go, with their dependents."""
    # Force several batches from a handful of rows.
    monkeypatch.setattr("app.jobs.retention.POST_DELETE_BATCH", 2)
    old_ts = 1_000_000_000_000
    recent_ts = int(time.time() * 1000)
    ch = "ret-batch-ch"

    with Session(engine) as session:
        save_settings_section(
            session, "retention", {"postRetentionDays": 30, "sharedLogRetentionDays": 0}
        )
        operator_id = get_operator_user_id(session)
        for pid in range(1, 6):  # 5 expired posts -> 3 batches of size 2
            session.add(
                Post(
                    channel_name=ch,
                    post_id=pid,
                    text="old",
                    timestamp=old_ts,
                    is_anchor=False,
                    user_id=operator_id,
                )
            )
        session.add(
            Post(
                channel_name=ch,
                post_id=99,
                text="new",
                timestamp=recent_ts,
                is_anchor=False,
                user_id=operator_id,
            )
        )
        session.add(
            PostEmbedding(
                id=f"{ch}_1",
                channel_name=ch,
                post_id=1,
                vector=[0.1],
                text="e",
                provider="gemini",
                model="m",
                dimensions=1,
            )
        )
        session.add(
            PostTranslation(
                id=f"{ch}_1_fa",
                channel_name=ch,
                post_id=1,
                language="fa",
                translated_text="x",
                timestamp=old_ts,
            )
        )
        session.add(PostSyncState(channel_name=ch, post_id=1, state="confirmed_gap"))
        session.commit()

        result = run_retention_cleanup(session)
        assert result["deletedPosts"] == 5

    with Session(engine) as check:
        remaining = check.exec(select(Post).where(Post.channel_name == ch)).all()
        assert [p.post_id for p in remaining] == [99], "only the recent post survives"
        assert check.get(PostEmbedding, f"{ch}_1") is None, "embedding not cascaded"
        assert (
            check.exec(
                select(PostTranslation).where(PostTranslation.channel_name == ch)
            ).all()
            == []
        ), "translation not cascaded"
        assert (
            check.exec(
                select(PostSyncState).where(PostSyncState.channel_name == ch)
            ).all()
            == []
        ), "sync state not pruned"
