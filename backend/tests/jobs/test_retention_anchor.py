"""Anchor posts survive retention cleanup; batched deletes cascade."""

from __future__ import annotations

import time

from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import save_settings_section
from app.models_tg import Channel, Post, PostEmbedding, PostSyncState, PostTranslation
from app.services.follows import get_operator_user_id
from tests.utils.setting_groups import add_test_channel


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


def test_retention_repairs_what_the_sweep_left_pointing_at_nothing() -> None:
    """After the sweep, each touched Channel's anchor and sync state are repaired.

    A Channel whose `anchor_post_id` named a swept Post loses it, one whose
    anchor survived keeps it, and sync-state rows below the oldest surviving
    Post go even when no swept Post carried them. A Channel swept empty has no
    oldest Post to measure from, so its stray sync state stays.
    """
    old_ts = 1_000_000_000_000
    recent_ts = int(time.time() * 1000)

    with Session(engine) as session:
        save_settings_section(
            session, "retention", {"postRetentionDays": 30, "sharedLogRetentionDays": 0}
        )
        add_test_channel(session, "ret-dangle", anchor_post_id=2)
        add_test_channel(session, "ret-kept", anchor_post_id=10)
        add_test_channel(session, "ret-empty")
        for ch, pid, ts, is_anchor in [
            ("ret-dangle", 1, old_ts, False),
            ("ret-dangle", 2, old_ts, False),
            ("ret-dangle", 5, recent_ts, False),
            ("ret-kept", 9, old_ts, False),
            ("ret-kept", 10, old_ts, True),
            ("ret-empty", 1, old_ts, False),
        ]:
            session.add(
                Post(
                    channel_name=ch,
                    post_id=pid,
                    text="x",
                    timestamp=ts,
                    is_anchor=is_anchor,
                )
            )
        # Gap rows no swept Post carries: 3 is below the oldest survivor (5),
        # 7 is above it, and the empty Channel's 50 has nothing to compare to.
        session.add(PostSyncState(channel_name="ret-dangle", post_id=3, state="gap"))
        session.add(PostSyncState(channel_name="ret-dangle", post_id=7, state="gap"))
        session.add(PostSyncState(channel_name="ret-empty", post_id=50, state="gap"))
        session.commit()

        result = run_retention_cleanup(session)
        assert result["deletedPosts"] == 4

    with Session(engine) as check:
        dangling = check.get(Channel, "ret-dangle")
        kept = check.get(Channel, "ret-kept")
        assert dangling is not None and dangling.anchor_post_id is None
        assert kept is not None and kept.anchor_post_id == 10
        states = check.exec(
            select(PostSyncState.channel_name, PostSyncState.post_id)
        ).all()
        assert sorted(states) == [("ret-dangle", 7), ("ret-empty", 50)]
