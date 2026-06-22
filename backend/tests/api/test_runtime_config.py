"""Tests for GET /jobs/runtime-config."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.jobs.settings import save_setting
from app.services.scraper_jobs import clear_active_jobs_for_tests


PREFIX = f"{settings.API_V1_STR}/jobs"


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


def test_runtime_config_requires_auth(client: TestClient) -> None:
    r = client.get(f"{PREFIX}/runtime-config")
    assert r.status_code == 401


def test_runtime_config_effective_values(client: TestClient, db: Session) -> None:
    clear_active_jobs_for_tests()
    save_setting(
        db,
        "sync",
        {
            "syncConcurrency": 5,
            "globalStartTimeMode": "relative",
            "globalStartTimeValue": 7,
        },
    )
    save_setting(
        db,
        "retention",
        {"postRetentionDays": 30, "logRetentionDays": 14},
    )

    headers = _auth(client)
    r = client.get(f"{PREFIX}/runtime-config", headers=headers)
    assert r.status_code == 200
    data = r.json()

    assert data["sync"]["syncConcurrency"] == 5
    assert data["retention"]["postRetentionDays"] == 30
    assert data["retention"]["logRetentionDays"] == 14
    assert data["scraper"]["maxPostsPerChannel"] == settings.SCRAPER_MAX_POSTS_PER_CHANNEL
    assert data["scraper"]["iterationLimit"] == settings.SCRAPER_ITERATION_LIMIT
    assert data["network"]["fetchRetries"] == settings.NETWORK_FETCH_RETRIES
    assert data["network"]["proxyDefaultConcurrency"] >= 1
    assert isinstance(data["network"]["proxyConcurrencyOverrides"], dict)
    assert isinstance(data["network"]["effectiveProxyCapacity"], int)
    assert isinstance(data["network"]["proxyLanes"], list)
    assert data["jobs"]["enabled"]["auto_sync"] is True
    assert data["jobs"]["intervals"]["autoSyncCheckSeconds"] == (
        settings.AUTO_SYNC_CHECK_INTERVAL_SECONDS
    )
    assert data["constants"]["syncMaxRetries"] == settings.SYNC_MAX_RETRIES
    assert isinstance(data["nowMs"], int)
    assert isinstance(data["scrapeCutoffMs"], int)
    assert isinstance(data["effectiveGlobalStartTimeMs"], int)
    assert data["globalStartTime"]["mode"] == "relative"
    assert data["globalStartTime"]["value"] == 7
    assert data["activeSyncJob"] is None

    for proxy in data["network"]["resolvedProxies"]:
        assert "password" not in (proxy or "").lower()
