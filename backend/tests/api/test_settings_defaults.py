"""Tests for GET /data/settings/{key} default merging."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings

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
    assert value["autoSyncEnabled"] is True
    assert value["autoSyncInterval"] == settings.AUTO_SYNC_INTERVAL_MINUTES_DEFAULT
    assert value["syncConcurrency"] == settings.SYNC_CONCURRENCY_DEFAULT


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
