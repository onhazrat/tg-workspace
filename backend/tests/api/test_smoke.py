"""API smoke tests (most run without a Gemini key; AI tests adapt if one is set)."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


def _auth_headers() -> dict[str, str]:
    login = client.post(
        "/api/v1/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_health_check() -> None:
    r = client.get("/api/v1/utils/health-check/")
    assert r.status_code == 200
    assert r.json() is True


def test_proxy_health() -> None:
    r = client.get("/api/proxy-health", headers=_auth_headers())
    assert r.status_code == 200
    assert "badProxies" in r.json()


def test_tor_status() -> None:
    r = client.get("/api/tor-status", headers=_auth_headers())
    assert r.status_code == 200
    data = r.json()
    assert "running" in data


def test_ai_models_without_key() -> None:
    r = client.get("/api/v1/ai/models", headers=_auth_headers())
    assert r.status_code == 200
    data = r.json()
    assert len(data["models"]) >= 1
    assert data["default"]


def test_jobs_status() -> None:
    r = client.get("/api/v1/jobs/status", headers=_auth_headers())
    assert r.status_code == 200
    data = r.json()
    for job_id in ("auto_sync", "embeddings", "auto_summary", "retention", "translation_batch"):
        assert job_id in data
        assert "lastStatus" in data[job_id]


def test_sync_job_requires_auth() -> None:
    r = client.post("/api/v1/jobs/sync", json={"channelIds": ["x"]})
    assert r.status_code in (401, 403)


def test_data_channels_crud() -> None:
    headers = _auth_headers()
    r = client.put(
        "/api/v1/data/channels/smoke-test",
        json={"name": "smoke-test", "displayName": "Smoke Test"},
        headers=headers,
    )
    assert r.status_code == 200
    r2 = client.get("/api/v1/data/channels", headers=headers)
    assert r2.status_code == 200
    names = [c["name"] for c in r2.json()]
    assert "smoke-test" in names


def test_scrape_invalid_url() -> None:
    r = client.post(
        "/api/scrape", json={"url": "not-a-url"}, headers=_auth_headers()
    )
    assert r.status_code == 400


def test_ai_embeddings() -> None:
    r = client.post(
        "/api/v1/ai/embeddings", json={"texts": ["hi"]}, headers=_auth_headers()
    )
    if settings.GEMINI_API_KEY:
        assert r.status_code == 200
        data = r.json()
        assert len(data["vectors"]) == 1
        assert data["dimensions"] > 0
    else:
        assert r.status_code == 503


def test_rag_search() -> None:
    if settings.GEMINI_API_KEY:
        pytest.skip("Live Gemini RAG is verified against a running server; sync TestClient hits event-loop issues")
    r = client.post(
        "/api/v1/rag/search", json={"query": "test"}, headers=_auth_headers()
    )
    assert r.status_code == 503


def test_openapi() -> None:
    r = client.get("/api/v1/openapi.json")
    assert r.status_code == 200
    assert "openapi" in r.json()
