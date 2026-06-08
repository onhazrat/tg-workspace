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
from app.jobs.settings import save_setting
from app.jobs.translation_batch import run_translation_batch
from app.models_tg import Channel, Post, Summary
from app.services.scraper_jobs import clear_jobs_for_tests

PREFIX = f"{settings.API_V1_STR}/jobs"


def test_jobs_status_lists_all_jobs(client: TestClient) -> None:
    r = client.get(f"{PREFIX}/status")
    assert r.status_code == 200
    data = r.json()
    for job_id in ("auto_sync", "embeddings", "auto_summary", "retention", "translation_batch"):
        assert job_id in data
        assert "enabled" in data[job_id]
        assert "lastStatus" in data[job_id]


def test_update_job_enabled(client: TestClient) -> None:
    r = client.put(f"{PREFIX}/embeddings", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False

    status = client.get(f"{PREFIX}/status").json()
    assert status["embeddings"]["enabled"] is False

    client.put(f"{PREFIX}/embeddings", json={"enabled": True})


def test_trigger_unknown_job(client: TestClient) -> None:
    r = client.post(f"{PREFIX}/not-a-job/trigger")
    assert r.status_code == 404


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_skips_when_disabled(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    with Session(engine) as session:
        save_setting(session, "sync", {"autoSyncEnabled": False})

    result = asyncio.run(run_auto_sync())
    assert result["skipped"] is True
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
                "autoSyncEnabled": True,
                "autoSyncInterval": 60,
                "consecutiveFailures": 0,
                "autoSyncPauseUntil": None,
            },
        )
        ch = session.get(Channel, "stale-ch")
        if ch:
            ch.last_updated = now - 120 * 60 * 1000
            session.add(ch)
        else:
            session.add(
                Channel(
                    id="stale-ch",
                    name="stale-ch",
                    last_updated=now - 120 * 60 * 1000,
                )
            )
        session.commit()

    mock_job = MagicMock()
    mock_job.job_id = "job-1"
    mock_job.status = "completed"
    mock_job.channels = {"stale-ch": MagicMock(status="success")}
    mock_create.return_value = mock_job

    result = asyncio.run(run_auto_sync())
    assert result.get("channels", 0) >= 1
    mock_create.assert_awaited_once()
    mock_run.assert_awaited_once()
    called_entries = mock_create.await_args.kwargs.get("channel_entries") or mock_create.await_args.args[0]
    assert any(name == "stale-ch" for _id, name in called_entries)


def test_retention_deletes_old_posts() -> None:
    now = int(time.time() * 1000)
    with Session(engine) as session:
        save_setting(session, "retention", {"postRetentionDays": 30, "logRetentionDays": 0})
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
        existing_summary = session.get(Summary, summary_id)
        if existing_summary:
            existing_summary.text = "old"
            existing_summary.channels = ["ch1"]
            existing_summary.start_date = now - 2 * duration
            existing_summary.end_date = now - duration
            existing_summary.extra = {"autoRegenerate": True}
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
