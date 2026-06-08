"""Security regression: sensitive routes require authentication."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = settings.API_V1_STR


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{PREFIX}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.security
@pytest.mark.parametrize(
    "method,path,json_body",
    [
        ("GET", f"{PREFIX}/ai/models", None),
        ("POST", f"{PREFIX}/ai/summary", {"channels": [], "language": "English", "postsText": ""}),
        ("GET", f"{PREFIX}/rag/status", None),
        ("POST", f"{PREFIX}/rag/search", {"query": "test"}),
        ("GET", f"{PREFIX}/network/proxy-health", None),
        ("POST", f"{PREFIX}/network/test-proxy", {"proxyUrl": "http://127.0.0.1:1"}),
        ("POST", f"{PREFIX}/telegram/scrape", {"url": "https://t.me/test"}),
        ("GET", f"{PREFIX}/jobs/status", None),
        ("POST", f"{PREFIX}/jobs/auto_sync/trigger", None),
    ],
)
def test_sensitive_routes_reject_unauthenticated(
    client: TestClient,
    method: str,
    path: str,
    json_body: dict | None,
) -> None:
    if method == "GET":
        r = client.get(path)
    else:
        r = client.post(path, json=json_body or {})
    assert r.status_code in (401, 403), f"{method} {path} returned {r.status_code}"


@pytest.mark.security
def test_sensitive_routes_accept_jwt(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/ai/models", headers=headers)
    assert r.status_code == 200
    assert "models" in r.json()

    r2 = client.get(f"{PREFIX}/jobs/status", headers=headers)
    assert r2.status_code == 200
    assert "auto_sync" in r2.json()
