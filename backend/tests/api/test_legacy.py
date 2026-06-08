"""Legacy /api/* routes: auth pass-through and deprecation headers."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.config import settings

DATA = f"{settings.API_V1_STR}/data"


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


def test_legacy_publish_requires_auth(client: TestClient) -> None:
    r = client.post(
        "/api/publish",
        json={"credentialId": "x", "chatId": "1", "text": "hi"},
    )
    assert r.status_code in (401, 403)


@patch("app.api.routes.telegram.fetch_with_retry", new_callable=AsyncMock)
def test_legacy_publish_with_jwt(mock_fetch: AsyncMock, client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{DATA}/bot-credentials/leg-bot-1",
        json={"name": "Legacy Bot", "token": "888:LEGTOKEN"},
        headers=headers,
    )
    mock_fetch.return_value = ({"ok": True, "result": {"message_id": 1}}, [])

    r = client.post(
        "/api/publish",
        json={"credentialId": "leg-bot-1", "chatId": "-100123", "text": "hello"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert r.headers.get("Deprecation") == "true"

    client.delete(f"{DATA}/bot-credentials/leg-bot-1", headers=headers)


@patch("app.api.routes.telegram.fetch_with_retry", new_callable=AsyncMock)
def test_legacy_bot_info_with_jwt(mock_fetch: AsyncMock, client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{DATA}/bot-credentials/leg-info-1",
        json={"name": "Info Bot", "token": "999:INFOTOKEN"},
        headers=headers,
    )
    mock_fetch.return_value = ({"ok": True, "result": {"username": "infobot"}}, [])

    r = client.post(
        "/api/bot-info",
        json={"credentialId": "leg-info-1", "method": "getMe"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.headers.get("Deprecation") == "true"

    client.delete(f"{DATA}/bot-credentials/leg-info-1", headers=headers)
