"""Tests for GET /data/settings/{key} default merging."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.settings_store import put_global_setting

PREFIX = f"{settings.API_V1_STR}/data"


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


def test_get_retention_settings_merges_defaults(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/settings/retention", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["key"] == "retention"
    value = body["value"]
    assert value["postRetentionDays"] == settings.RETENTION_POST_DAYS_DEFAULT
    assert value["logRetentionDays"] == settings.RETENTION_LOG_DAYS_DEFAULT


def test_get_sync_settings_merges_defaults(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/settings/sync", headers=headers)
    assert r.status_code == 200
    value = r.json()["value"]
    assert (
        value["regularSyncIntervalMinutes"]
        == settings.AUTO_SYNC_INTERVAL_MINUTES_DEFAULT
    )
    assert value["dynamicSyncEnabledDefault"] is False
    assert value["dynamicSyncExpectedPostsDefault"] == 15
    assert value["syncFailureBackoffMinutes"] == 5
    assert value["syncFailureBackoffMinutes"] == 5


def test_get_jobs_settings_merges_defaults(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/settings/jobs", headers=headers)
    assert r.status_code == 200
    value = r.json()["value"]
    assert "auto_sync" in value
    assert value["auto_sync"]["enabled"] == settings.JOBS_AUTO_SYNC_ENABLED_DEFAULT
    assert value["retention"]["enabled"] == settings.JOBS_RETENTION_ENABLED_DEFAULT


def test_get_translation_settings_merges_defaults(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/settings/translation", headers=headers)
    assert r.status_code == 200
    value = r.json()["value"]
    assert value["translationEnabled"] is False
    assert value["autoTranslate"] is False
    assert value["translationModel"] == settings.DEFAULT_AI_MODEL


def test_sync_setting_migrates_legacy_auto_sync_interval(client: TestClient) -> None:
    with Session(engine) as session:
        # Written straight into the global row rather than through
        # `save_settings_section`, which routes by field and so drops a name the
        # registry does not know. That is right for a write and wrong for this
        # setup: nothing writes `autoSyncInterval` any more, an old database
        # simply *has* it — which is the state under test.
        put_global_setting(
            session,
            "sync",
            {"autoSyncInterval": 42, "syncFailureBackoffMinutes": 3},
        )
    headers = _auth(client)
    r = client.get(f"{PREFIX}/settings/sync", headers=headers)
    assert r.status_code == 200
    value = r.json()["value"]
    assert value["regularSyncIntervalMinutes"] == 42
    assert "autoSyncInterval" not in value
    assert "autoSyncEnabled" not in value
