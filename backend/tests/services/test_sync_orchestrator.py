from __future__ import annotations

import uuid

from sqlmodel import Session

from app.core.db import engine
from app.jobs.auto_sync import CHECK_SOURCE
from app.models_tg import Channel, Post
from app.services.scraper_jobs import SyncJobState
from app.services.sync_orchestrator import (
    _ChannelSyncCtx,
    _finalize_channel_error,
    _finalize_channel_success,
)
from app.services.sync_schedule import (
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at_from_last_updated,
)


def _ctx(channel_id: str, channel_name: str) -> _ChannelSyncCtx:
    return _ChannelSyncCtx(
        channel_id=channel_id,
        channel_name=channel_name,
        display_name=channel_name,
        photo_url=None,
        language="en",
        auto_follow=False,
        proxies=[],
        proxy_concurrency=(1, {}),
        tor_auto_rotate=False,
        tor_rotation_threshold=10,
        tor_control_enabled=False,
        tor_control_port=9051,
        retrieval_pass="incremental",
        needs_backfill=False,
        min_stored_post_id=None,
        scrape_cutoff_ms=0,
        effective_start_time=0,
    )


def test_finalize_channel_success_recomputes_deadlines() -> None:
    channel_id = f"orchestrator-success-{uuid.uuid4()}"
    now_ms = 1_725_000_000_000

    with Session(engine) as session:
        session.add(
            Channel(
                id=channel_id,
                name=channel_id,
                regular_sync_enabled=True,
                dynamic_sync_enabled=True,
                auto_sync_interval_minutes=60,
                dynamic_sync_expected_posts=15,
            )
        )
        session.add(
            Post(
                channel_name=channel_id,
                post_id=1,
                text="a",
                timestamp=now_ms - 3_600_000,
            )
        )
        session.add(
            Post(
                channel_name=channel_id,
                post_id=2,
                text="b",
                timestamp=now_ms - 1_800_000,
            )
        )
        session.commit()

    _finalize_channel_success(
        _ctx(channel_id, channel_id),
        job=SyncJobState(job_id="job-success", source="Manual"),
        user_id=None,
        total_new_posts=2,
        final_latest_id=2,
        requests_log=[],
        responses_log=[],
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        assert channel.last_updated is not None
        assert (
            channel.next_regular_sync_at
            == compute_next_regular_sync_at_from_last_updated(
                channel.last_updated,
                channel.auto_sync_interval_minutes,
                channel.last_updated,
            )
        )
        assert channel.next_dynamic_sync_at is not None
        assert channel.next_dynamic_sync_at > channel.last_updated
        implied_hours = (
            channel.next_dynamic_sync_at - channel.last_updated
        ) / 3_600_000
        implied_velocity = channel.dynamic_sync_expected_posts / implied_hours
        assert (
            compute_next_dynamic_sync_at_from_last_updated(
                channel.last_updated,
                channel.dynamic_sync_expected_posts,
                implied_velocity,
                channel.last_updated,
            )
            == channel.next_dynamic_sync_at
        )


def test_scheduler_failure_backoff_updates_due_schedule_only() -> None:
    channel_id = f"orchestrator-fail-{uuid.uuid4()}"
    with Session(engine) as session:
        session.add(
            Channel(
                id=channel_id,
                name=channel_id,
                regular_sync_enabled=True,
                dynamic_sync_enabled=True,
                next_regular_sync_at=100,
                next_dynamic_sync_at=200,
            )
        )
        session.commit()

    _finalize_channel_error(
        _ctx(channel_id, channel_id),
        "boom",
        job=SyncJobState(job_id="job-fail", source=CHECK_SOURCE),
        user_id=None,
        total_new_posts=0,
        requests_log=[],
        responses_log=[],
        due_reason="regular",
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        assert channel.next_regular_sync_at is not None
        assert channel.next_regular_sync_at > 100
        assert channel.next_dynamic_sync_at == 200


def test_manual_failure_does_not_apply_backoff() -> None:
    channel_id = f"orchestrator-manual-{uuid.uuid4()}"
    with Session(engine) as session:
        session.add(
            Channel(
                id=channel_id,
                name=channel_id,
                regular_sync_enabled=True,
                dynamic_sync_enabled=True,
                next_regular_sync_at=111,
                next_dynamic_sync_at=222,
            )
        )
        session.commit()

    _finalize_channel_error(
        _ctx(channel_id, channel_id),
        "boom",
        job=SyncJobState(job_id="job-manual", source="Manual sync"),
        user_id=None,
        total_new_posts=0,
        requests_log=[],
        responses_log=[],
        due_reason="both",
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        assert channel.next_regular_sync_at == 111
        assert channel.next_dynamic_sync_at == 222
