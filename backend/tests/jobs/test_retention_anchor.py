"""Anchor posts survive retention cleanup; batched deletes cascade."""

from __future__ import annotations

import time

from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import save_settings_section
from app.models_tg import Channel, Post, PostEmbedding, PostTranslation
from app.services.follows import get_operator_user_id
from app.services.walked_ranges import Span, channel_ranges, record_page
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
        record_page(session, ch, Span(lo_id=1, hi_id=99, lo_ts=old_ts, hi_ts=recent_ts))
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
        ((low, high),) = [(r.lo_id, r.hi_id) for r in channel_ranges(check, ch)]
        assert (low, high) == (99, 99), "the range still claims swept ids"


def test_retention_repairs_what_the_sweep_left_pointing_at_nothing() -> None:
    """After the sweep, each touched Channel's anchor and Walked ranges are repaired.

    A Channel whose `anchor_post_id` named a swept Post loses it, one whose
    anchor survived keeps it. Its ranges start at its oldest surviving Post and
    no longer claim its first Post (ADR-044); a Channel swept empty keeps none.

    **Mutation:** keep a straddling range's bottom and it claims swept ids.
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
        # A walk from 5 down to the first Post, one wholly below the oldest
        # survivor, and the empty Channel's only walk.
        walked = [
            ("ret-dangle", Span(1, 5, old_ts, recent_ts, reached_start=True)),
            ("ret-kept", Span(9, 10, old_ts, old_ts)),
            ("ret-empty", Span(1, 1, old_ts, old_ts)),
        ]
        for name, span in walked:
            record_page(session, name, span)
        session.commit()

        result = run_retention_cleanup(session)
        assert result["deletedPosts"] == 4

    with Session(engine) as check:
        dangling = check.get(Channel, "ret-dangle")
        kept = check.get(Channel, "ret-kept")
        assert dangling is not None and dangling.anchor_post_id is None
        assert kept is not None and kept.anchor_post_id == 10
        assert channel_ranges(check, "ret-dangle") == [Span(5, 5, recent_ts, recent_ts)]
        assert channel_ranges(check, "ret-empty") == []


def test_a_kept_anchor_does_not_hold_a_range_over_swept_posts() -> None:
    """An anchor outlives the sweep, but the Posts between it and the oldest
    survivor are gone: no range may claim them (ADR-044).

    **Mutation:** trim to the lowest remaining Post, anchor included, and the
    range still starts at the anchor.
    """
    old_ts = 1_000_000_000_000
    recent_ts = int(time.time() * 1000)
    with Session(engine) as session:
        save_settings_section(
            session, "retention", {"postRetentionDays": 30, "sharedLogRetentionDays": 0}
        )
        for post_id, ts, is_anchor in [
            (10, old_ts, True),
            (11, old_ts, False),
            (12, recent_ts, False),
        ]:
            session.add(
                Post(
                    channel_name="ret-anchored",
                    post_id=post_id,
                    text="x",
                    timestamp=ts,
                    is_anchor=is_anchor,
                )
            )
        record_page(session, "ret-anchored", Span(10, 12, old_ts, recent_ts))
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert channel_ranges(check, "ret-anchored") == [
            Span(12, 12, recent_ts, recent_ts)
        ]
