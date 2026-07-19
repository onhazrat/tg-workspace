"""Tests for APScheduler job status, trigger, and job functions."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.jobs import scheduler as sched
from app.jobs.auto_summary import run_auto_summary
from app.jobs.auto_sync import run_auto_sync
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import default_job_enabled, save_setting
from app.jobs.translation_batch import run_translation_batch
from app.models_tg import Channel, Post, Summary
from app.services.network_settings import get_network_setting_row
from app.services.operator import get_operator_user_id
from app.services.scraper_jobs import clear_jobs_for_tests
from tests.utils.setting_groups import freeze_channels_except, upsert_sync_test_channel

PREFIX = f"{settings.API_V1_STR}/jobs"


def _freeze_channels_except(session: Session, keep_ids: set[str]) -> None:
    freeze_channels_except(session, keep_ids)


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_jobs_status_lists_all_jobs(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/status", headers=headers)
    assert r.status_code == 200
    data = r.json()
    for job_id in (
        "auto_sync",
        "embeddings",
        "auto_summary",
        "retention",
        "translation_batch",
    ):
        assert job_id in data
        assert "enabled" in data[job_id]
        assert "lastStatus" in data[job_id]


def test_embeddings_default_from_env(client: TestClient) -> None:
    headers = _auth(client)
    status = client.get(f"{PREFIX}/status", headers=headers).json()
    assert status["embeddings"]["enabled"] is default_job_enabled("embeddings")


def test_translation_batch_default_from_env(client: TestClient) -> None:
    headers = _auth(client)
    status = client.get(f"{PREFIX}/status", headers=headers).json()
    assert status["translation_batch"]["enabled"] is default_job_enabled(
        "translation_batch"
    )


def test_update_job_enabled(client: TestClient) -> None:
    headers = _auth(client)
    r = client.put(f"{PREFIX}/embeddings", json={"enabled": False}, headers=headers)
    assert r.status_code == 200
    assert r.json()["enabled"] is False

    status = client.get(f"{PREFIX}/status", headers=headers).json()
    assert status["embeddings"]["enabled"] is False

    client.put(f"{PREFIX}/embeddings", json={"enabled": True}, headers=headers)


def test_trigger_unknown_job(client: TestClient) -> None:
    headers = _auth(client)
    r = client.post(f"{PREFIX}/not-a-job/trigger", headers=headers)
    assert r.status_code == 404


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_skips_when_no_due_channels(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    clear_jobs_for_tests()
    now = int(time.time() * 1000)
    with Session(engine) as session:
        save_setting(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        operator_id = get_operator_user_id(session)
        _freeze_channels_except(session, {"not-due-ch"})
        upsert_sync_test_channel(
            session,
            channel_id="not-due-ch",
            user_id=operator_id,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": False,
                "is_frozen": False,
            },
            channel_fields={"next_regular_sync_at": now + 60_000},
        )

    result = asyncio.run(run_auto_sync())
    assert result["skipped"] is True
    assert result["reason"] == "no_due_channels"
    mock_create.assert_not_awaited()
    mock_run.assert_not_awaited()


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_triggers_stale_channels(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    clear_jobs_for_tests()
    now = int(time.time() * 1000)

    with Session(engine) as session:
        save_setting(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        operator_id = get_operator_user_id(session)
        net_row = get_network_setting_row(session)
        if net_row and operator_id:
            net_row.user_id = operator_id
            session.add(net_row)

        upsert_sync_test_channel(
            session,
            channel_id="stale-ch",
            user_id=operator_id,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": False,
                "is_frozen": False,
            },
            channel_fields={"next_regular_sync_at": now - 1_000},
        )
        _freeze_channels_except(session, {"stale-ch"})

    mock_job = MagicMock()
    mock_job.job_id = "job-1"
    mock_job.status = "completed"
    mock_job.channels = {"stale-ch": MagicMock(status="success")}
    mock_create.return_value = mock_job

    result = asyncio.run(run_auto_sync())
    assert result.get("channels", 0) >= 1
    mock_create.assert_awaited_once()
    mock_run.assert_awaited_once()
    called_entries = (
        mock_create.await_args.kwargs.get("channel_entries")
        or mock_create.await_args.args[0]
    )
    assert any(name == "stale-ch" for _id, name in called_entries)


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_includes_fresh_partial_history_channels(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    clear_jobs_for_tests()
    now = int(time.time() * 1000)

    with Session(engine) as session:
        save_setting(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        operator_id = get_operator_user_id(session)
        net_row = get_network_setting_row(session)
        if net_row and operator_id:
            net_row.user_id = operator_id
            session.add(net_row)

        _freeze_channels_except(session, {"partial-ch"})
        upsert_sync_test_channel(
            session,
            channel_id="partial-ch",
            user_id=operator_id,
            group_fields={
                "regular_sync_enabled": False,
                "dynamic_sync_enabled": False,
                "is_frozen": False,
            },
            channel_fields={
                "history_complete_to_cutoff": False,
                "next_regular_sync_at": now + 60_000,
            },
        )

    mock_job = MagicMock()
    mock_job.job_id = "job-partial"
    mock_job.status = "completed"
    mock_job.channels = {"partial-ch": MagicMock(status="success")}
    mock_create.return_value = mock_job

    result = asyncio.run(run_auto_sync())
    assert result.get("partialChannels") == 1
    assert result.get("dueChannels") == 0
    mock_create.assert_awaited_once()
    called_entries = (
        mock_create.await_args.kwargs.get("channel_entries")
        or mock_create.await_args.args[0]
    )
    assert any(name == "partial-ch" for _id, name in called_entries)


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_dynamic_only_channel_due_by_velocity(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    clear_jobs_for_tests()
    now = int(time.time() * 1000)

    with Session(engine) as session:
        save_setting(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        operator_id = get_operator_user_id(session)
        _freeze_channels_except(session, {"dynamic-only-ch"})
        upsert_sync_test_channel(
            session,
            channel_id="dynamic-only-ch",
            user_id=operator_id,
            group_fields={
                "regular_sync_enabled": False,
                "dynamic_sync_enabled": True,
                "is_frozen": False,
            },
            channel_fields={"next_dynamic_sync_at": now - 1_000},
        )
        session.add(
            Post(
                channel_name="dynamic-only-ch",
                post_id=100,
                text="p1",
                timestamp=now - 60_000,
            )
        )
        session.add(
            Post(
                channel_name="dynamic-only-ch",
                post_id=101,
                text="p2",
                timestamp=now - 10_000,
            )
        )
        session.commit()

    mock_job = MagicMock()
    mock_job.job_id = "job-dynamic-only"
    mock_job.status = "completed"
    mock_job.channels = {"dynamic-only-ch": MagicMock(status="success")}
    mock_create.return_value = mock_job

    result = asyncio.run(run_auto_sync())
    assert result.get("dueDynamic") == 1
    called_entries = (
        mock_create.await_args.kwargs.get("channel_entries")
        or mock_create.await_args.args[0]
    )
    assert any(name == "dynamic-only-ch" for _id, name in called_entries)


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_skips_channels_with_both_schedules_disabled(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    clear_jobs_for_tests()
    now = int(time.time() * 1000)

    with Session(engine) as session:
        save_setting(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        operator_id = get_operator_user_id(session)
        _freeze_channels_except(session, {"disabled-both-ch"})
        upsert_sync_test_channel(
            session,
            channel_id="disabled-both-ch",
            user_id=operator_id,
            group_fields={
                "regular_sync_enabled": False,
                "dynamic_sync_enabled": False,
                "is_frozen": False,
            },
            channel_fields={
                "next_regular_sync_at": now - 1_000,
                "next_dynamic_sync_at": now - 1_000,
            },
        )

    result = asyncio.run(run_auto_sync())
    assert result["skipped"] is True
    assert result["reason"] == "no_due_channels"
    mock_create.assert_not_awaited()
    mock_run.assert_not_awaited()


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_syncs_all_due_channels_in_one_job(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    clear_jobs_for_tests()
    now = int(time.time() * 1000)

    with Session(engine) as session:
        save_setting(
            session,
            "sync",
            {
                "regularSyncIntervalMinutes": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        operator_id = get_operator_user_id(session)
        _freeze_channels_except(session, {"due-1", "due-2"})
        for cid in ("due-1", "due-2"):
            upsert_sync_test_channel(
                session,
                channel_id=cid,
                user_id=operator_id,
                group_fields={
                    "regular_sync_enabled": True,
                    "dynamic_sync_enabled": False,
                    "is_frozen": False,
                },
                channel_fields={"next_regular_sync_at": now - 1_000},
            )

    mock_job = MagicMock()
    mock_job.job_id = "job-all-due"
    mock_job.status = "completed"
    mock_job.channels = {
        "due-1": MagicMock(status="success"),
        "due-2": MagicMock(status="success"),
    }
    mock_create.return_value = mock_job

    result = asyncio.run(run_auto_sync())
    assert result.get("channels") == 2
    called_entries = (
        mock_create.await_args.kwargs.get("channel_entries")
        or mock_create.await_args.args[0]
    )
    assert sorted(name for _id, name in called_entries) == ["due-1", "due-2"]


def test_retention_deletes_old_posts() -> None:
    now = int(time.time() * 1000)
    with Session(engine) as session:
        save_setting(
            session, "retention", {"postRetentionDays": 30, "logRetentionDays": 0}
        )
        session.add(
            Post(
                channel_name="ret-ch",
                post_id=1,
                text="old",
                timestamp=now - 40 * 24 * 60 * 60 * 1000,
            )
        )
        session.commit()
        result = run_retention_cleanup(session)
        assert result["deletedPosts"] >= 1


def test_retention_runs_at_startup_by_default() -> None:
    kwargs = sched._retention_startup_kwargs()
    assert "next_run_time" in kwargs, (
        "retention must fire near boot, not just start+interval, or a "
        "frequently-redeployed backend keeps resetting the sweep"
    )


def test_retention_startup_run_can_be_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "RETENTION_JOB_STARTUP_DELAY_SECONDS", 0)
    assert sched._retention_startup_kwargs() == {}


def test_retention_job_tolerates_a_busy_event_loop() -> None:
    # A strict grace drops the run when scraping blocks the loop past 1s,
    # which is how the sweep silently never fired on staging.
    kwargs = sched._retention_job_kwargs()
    assert kwargs["misfire_grace_time"] is None
    assert kwargs["coalesce"] is True


@patch("app.jobs.translation_batch.get_provider")
def test_translation_batch_skips_when_disabled(mock_provider) -> None:
    with Session(engine) as session:
        save_setting(
            session,
            "translation",
            {"translationEnabled": False, "autoTranslate": False},
        )
    result = asyncio.run(run_translation_batch())
    assert result["skipped"] is True
    mock_provider.assert_not_called()


@patch("app.jobs.auto_summary.get_provider")
def test_auto_summary_regenerates_due_summary(mock_get_provider) -> None:
    now = int(time.time() * 1000)
    duration = 60 * 60 * 1000
    summary_id = "auto-sum-test"

    mock_provider = AsyncMock()
    mock_provider.complete.return_value = MagicMock(
        text="Generated summary [ch1 #1]",
        model_dump=lambda: {"text": "Generated summary [ch1 #1]"},
    )
    mock_get_provider.return_value = mock_provider

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        net_row = get_network_setting_row(session)
        if net_row and operator_id:
            net_row.user_id = operator_id
            session.add(net_row)

        ch1 = session.get(Channel, "ch1")
        if ch1:
            ch1.user_id = operator_id
            ch1.last_updated = now
            session.add(ch1)
        elif operator_id:
            upsert_sync_test_channel(
                session,
                channel_id="ch1",
                user_id=operator_id,
                group_fields={"is_frozen": False},
                channel_fields={"last_updated": now},
            )

        for other in session.exec(select(Summary)).all():
            if other.id != summary_id and (other.extra or {}).get("autoRegenerate"):
                other.extra = {**(other.extra or {}), "autoRegenerate": False}
                session.add(other)

        existing_summary = session.get(Summary, summary_id)
        if existing_summary:
            existing_summary.text = "old"
            existing_summary.channels = ["ch1"]
            existing_summary.start_date = now - 2 * duration
            existing_summary.end_date = now - duration
            existing_summary.extra = {"autoRegenerate": True}
            existing_summary.user_id = operator_id
            session.add(existing_summary)
        else:
            session.add(
                Summary(
                    id=summary_id,
                    text="old",
                    channels=["ch1"],
                    start_date=now - 2 * duration,
                    end_date=now - duration,
                    language="English",
                    model="gemini-3-flash-preview",
                    extra={"autoRegenerate": True},
                    user_id=operator_id,
                )
            )
        post = session.exec(
            select(Post).where(Post.channel_name == "ch1", Post.post_id == 1)
        ).first()
        if post:
            post.text = "hello"
            post.timestamp = now - duration // 2
            session.add(post)
        else:
            session.add(
                Post(
                    channel_name="ch1",
                    post_id=1,
                    text="hello",
                    timestamp=now - duration // 2,
                )
            )
        session.commit()

    with patch("app.jobs.auto_summary.settings.GEMINI_API_KEY", "test-key"):
        result = asyncio.run(run_auto_summary())

    assert len(result["regenerated"]) == 1
    with Session(engine) as session:
        old = session.get(Summary, summary_id)
        assert old is not None
        assert old.extra.get("autoRegenerate") is False


@patch("app.jobs.scheduler.run_auto_sync", new_callable=AsyncMock)
def test_trigger_job_runs_runner(mock_run: AsyncMock) -> None:
    entry = asyncio.run(sched.trigger_job("auto_sync"))
    mock_run.assert_awaited_once()
    assert entry["lastStatus"] == "ok"
