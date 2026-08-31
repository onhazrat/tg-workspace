from __future__ import annotations

import uuid

from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.auto_sync import CHECK_SOURCE
from app.models_tg import Channel, ChannelSettingGroup, Post, SyncLog
from app.services.follows import get_follow, get_operator_user_id
from app.services.scraper_jobs import SyncJobState
from app.services.sync_orchestrator import (
    _apply_scrape_page,
    _ChannelSyncCtx,
    _finalize_channel_error,
    _finalize_channel_success,
)
from app.services.sync_schedule import (
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at_from_last_updated,
)
from app.services.telegram_web import telegram_web_view_channel_url
from tests.utils.setting_groups import upsert_sync_test_channel


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
        # Seeded under the operator, because that is who `user_id=None`
        # resolves to below. The setting group hangs off the follow since
        # ticket 22, so the follow the orchestrator looks for has to be the
        # one this seeds — under `ANY_READER` there would be no follow for the
        # resolved account and the group lookup answers 500.
        operator_id = get_operator_user_id(session)
        upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=operator_id,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": True,
                "auto_sync_interval_minutes": 60,
                "dynamic_sync_expected_posts": 15,
            },
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
        job=SyncJobState(
            user_id=str(uuid.uuid4()), job_id="job-success", source="Manual"
        ),
        user_id=None,
        total_new_posts=2,
        final_latest_id=2,
        requests_log=[],
        responses_log=[],
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        follow = get_follow(session, user_id=operator_id, channel_id=channel_id)
        assert follow is not None
        group = session.get(ChannelSettingGroup, follow.setting_group_id)
        assert group is not None
        assert channel.last_updated is not None
        assert (
            channel.next_regular_sync_at
            == compute_next_regular_sync_at_from_last_updated(
                channel.last_updated,
                group.auto_sync_interval_minutes,
                channel.last_updated,
            )
        )
        assert channel.next_dynamic_sync_at is not None
        assert channel.next_dynamic_sync_at > channel.last_updated
        implied_hours = (
            channel.next_dynamic_sync_at - channel.last_updated
        ) / 3_600_000
        implied_velocity = group.dynamic_sync_expected_posts / implied_hours
        assert (
            compute_next_dynamic_sync_at_from_last_updated(
                channel.last_updated,
                group.dynamic_sync_expected_posts,
                implied_velocity,
                channel.last_updated,
            )
            == channel.next_dynamic_sync_at
        )


def test_scheduler_failure_backoff_updates_due_schedule_only() -> None:
    channel_id = f"orchestrator-fail-{uuid.uuid4()}"
    with Session(engine) as session:
        upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=None,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": True,
            },
            channel_fields={
                "next_regular_sync_at": 100,
                "next_dynamic_sync_at": 200,
            },
        )

    _finalize_channel_error(
        _ctx(channel_id, channel_id),
        "boom",
        job=SyncJobState(
            user_id=str(uuid.uuid4()), job_id="job-fail", source=CHECK_SOURCE
        ),
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
        upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=None,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": True,
            },
            channel_fields={
                "next_regular_sync_at": 111,
                "next_dynamic_sync_at": 222,
            },
        )

    _finalize_channel_error(
        _ctx(channel_id, channel_id),
        "boom",
        job=SyncJobState(
            user_id=str(uuid.uuid4()), job_id="job-manual", source="Manual sync"
        ),
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


def test_apply_scrape_page_mismatch_freezes_channel_and_logs_failure() -> None:
    channel_id = f"orchestrator-mismatch-{uuid.uuid4()}"
    with Session(engine) as session:
        # Seeded under the operator: the freeze resolves its owner through
        # `resolve_follow_owner(None)` and lands on that account's follow, so
        # the follow being asserted on below has to be theirs.
        channel = upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=get_operator_user_id(session),
            channel_fields={"telegram_chat_id": -1001},
        )
        channel_name = channel.name

    result = _apply_scrape_page(
        _ctx(channel_id, channel_name),
        {
            "fullRequest": {"url": telegram_web_view_channel_url(channel_name)},
            "posts": [],
            "latestId": 0,
            "telegramChatId": -1002,
        },
        job_id="job-mismatch",
        job_source="Manual",
        user_id=None,
        session_seen_ids=set(),
        before_id=None,
    )
    assert result.stop_sync is True
    assert result.sync_failed is True
    assert result.sync_error is not None
    assert "mismatch" in result.sync_error.lower()

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        # The freeze lands on the follow since ticket 22: parking a handle is
        # one account's judgement, and on the Channel it froze the handle for
        # every follower.
        freeze_owner = get_operator_user_id(session)
        assert freeze_owner is not None
        follow = get_follow(session, user_id=freeze_owner, channel_id=channel_id)
        assert follow is not None
        group = session.get(ChannelSettingGroup, follow.setting_group_id)
        assert group is not None
        assert group.name == "Frozen"
        log = session.exec(
            select(SyncLog)
            .where(SyncLog.channel_name == channel_name)
            .order_by(SyncLog.timestamp.desc())
        ).first()
        assert log is not None
        assert log.status == "failed"
        assert log.error is not None
        assert "mismatch" in log.error.lower()
