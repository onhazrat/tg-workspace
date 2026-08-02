"""The `/api/v1` version boundary, after E2 deleted the legacy alias router.

`routes/legacy.py` used to mount eleven pre-versioning aliases (`/api/publish`,
`/api/tor-status`, …) in every non-production environment, each a call-through
to its `/api/v1` handler with a `Deprecation` header. Nothing in this repo
called them — the frontend has only ever used `/api/v1` — and production
already answered 410, so they served no live client.

What survives the deletion is the boundary itself, and that is what these tests
pin: **outside** `/api/v1` there is nothing, and production says so with a 410
rather than a bare 404.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings

# One path per handler family legacy.py used to re-export, so the check is not
# accidentally satisfied by a single path that was never routed anyway.
REMOVED_ALIASES = [
    "/api/publish",
    "/api/bot-info",
    "/api/channel-info",
    "/api/scrape",
    "/api/resolve-start-time",
    "/api/test-proxy",
    "/api/proxy-health",
    "/api/tor-status",
    "/api/tor-ip",
    "/api/tor-restart",
    "/api/tor-new-identity",
]


@pytest.mark.parametrize("path", REMOVED_ALIASES)
def test_legacy_alias_is_not_routed(client: TestClient, path: str) -> None:
    """No environment serves the aliases any more — not even local dev.

    A 401 here would mean the route still exists behind auth, which is the
    regression this guards against: re-mounting the router would make every one
    of these answer again.
    """
    assert client.post(path, json={}).status_code == 404


def test_unversioned_api_paths_are_gone_in_production(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """410, not 404, so a stale caller learns the surface was withdrawn."""
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    response = client.post("/api/publish", json={"credentialId": "x"})

    assert response.status_code == 410
    assert "/api/v1" in response.json()["detail"]


def test_versioned_paths_are_untouched_by_the_middleware(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The 410 must not swallow `/api/v1` — it is a prefix of `/api/`."""
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    response = client.post(f"{settings.API_V1_STR}/telegram/publish", json={})

    assert response.status_code != 410
