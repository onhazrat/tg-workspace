"""Phase 2 secrets migration tests."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.secrets import decrypt_token, encrypt_token

PREFIX = f"{settings.API_V1_STR}/data"
TELEGRAM = f"{settings.API_V1_STR}/telegram"


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


def test_decrypt_rejects_plaintext_in_non_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core import secrets as secrets_mod

    monkeypatch.setattr(secrets_mod.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(
        secrets_mod.settings,
        "TOKEN_ENCRYPTION_KEY",
        "rcVtgNgVUfmbrfU-cOzcseDe66PgU3jo4AjvfUA3X90=",
    )
    with pytest.raises(ValueError, match="not encrypted"):
        decrypt_token("plaintext-token-value")


def test_encrypt_decrypt_roundtrip() -> None:
    plain = "123456789:AAHabcdefghijklmnopqrstuvwxyz"
    encrypted = encrypt_token(plain)
    assert encrypted != plain
    assert decrypt_token(encrypted) == plain


def test_bot_credentials_never_return_token(client: TestClient) -> None:
    headers = _auth(client)
    r = client.put(
        f"{PREFIX}/bot-credentials/sec-bot-1",
        json={"name": "Secret Bot", "token": "999:SECRETTOKEN"},
        headers=headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert "token" not in data
    assert data["hasToken"] is True

    r2 = client.get(f"{PREFIX}/bot-credentials", headers=headers)
    assert r2.status_code == 200
    bot = next(b for b in r2.json() if b["id"] == "sec-bot-1")
    assert "token" not in bot
    assert bot["hasToken"] is True

    client.delete(f"{PREFIX}/bot-credentials/sec-bot-1", headers=headers)


def test_bot_credentials_migrate(client: TestClient) -> None:
    headers = _auth(client)
    payload = [
        {
            "id": "mig-bot-1",
            "name": "Migrated Bot",
            "token": "111:MIGRATETOKEN",
            "username": "migbot",
        }
    ]
    r = client.post(f"{PREFIX}/bot-credentials/migrate", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["migrated"] == 1

    listed = client.get(f"{PREFIX}/bot-credentials", headers=headers).json()
    bot = next(b for b in listed if b["id"] == "mig-bot-1")
    assert bot["username"] == "migbot"
    assert "token" not in bot

    client.delete(f"{PREFIX}/bot-credentials/mig-bot-1", headers=headers)


def test_network_settings_get_put(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/settings/network", headers=headers)
    assert r.status_code == 200
    value = r.json()["value"]
    assert "proxyUrls" in value
    assert isinstance(value["proxyUrls"], list)
    assert "envFallbackConfigured" in value
    assert "defaultProxyUrls" not in value
    assert "torAvailable" in value
    assert "torControlPassword" not in value

    r2 = client.put(
        f"{PREFIX}/settings/network",
        json={
            "proxyEnabled": True,
            "torAutoRotate": True,
            "proxyUrls": [
                "http://proxy1.example:8080",
                "socks5h://proxy2.example:1080",
            ],
        },
        headers=headers,
    )
    assert r2.status_code == 200
    updated = r2.json()["value"]
    assert updated["proxyEnabled"] is True
    assert updated["torAutoRotate"] is True
    assert updated["proxyUrls"] == [
        "http://proxy1.example:8080",
        "socks5h://proxy2.example:1080",
    ]

    r3 = client.get(f"{PREFIX}/settings/network", headers=headers)
    assert r3.json()["value"]["proxyUrls"] == updated["proxyUrls"]


@patch("app.api.routes.telegram.fetch_with_retry", new_callable=AsyncMock)
def test_bot_info_by_credential_id(mock_fetch: AsyncMock, client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/bot-credentials/cred-bot-1",
        json={"name": "Cred Bot", "token": "555:CREDTOKEN"},
        headers=headers,
    )
    mock_fetch.return_value = ({"ok": True, "result": {"username": "credbot"}}, [])

    r = client.post(
        f"{TELEGRAM}/bot-info",
        json={"credentialId": "cred-bot-1", "method": "getMe"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    call_url = mock_fetch.call_args[0][0]
    assert "555:CREDTOKEN" in call_url

    client.delete(f"{PREFIX}/bot-credentials/cred-bot-1", headers=headers)


@patch("app.api.routes.telegram.fetch_with_retry", new_callable=AsyncMock)
def test_publish_by_credential_id(mock_fetch: AsyncMock, client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/bot-credentials/pub-bot-1",
        json={"name": "Pub Bot", "token": "777:PUBTOKEN"},
        headers=headers,
    )
    mock_fetch.return_value = ({"ok": True, "result": {"message_id": 1}}, [])

    r = client.post(
        f"{TELEGRAM}/publish",
        json={
            "credentialId": "pub-bot-1",
            "chatId": "-100123",
            "text": "hello",
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["success"] is True
    call_url = mock_fetch.call_args[0][0]
    assert "777:PUBTOKEN" in call_url

    client.delete(f"{PREFIX}/bot-credentials/pub-bot-1", headers=headers)


@pytest.mark.parametrize(
    ("content_type", "served_as"),
    [("image/jpeg", "image/jpeg"), (None, "application/octet-stream")],
)
@patch("app.api.routes.telegram.fetch_with_retry", new_callable=AsyncMock)
def test_bot_file_is_fetched_as_bytes_through_the_lane(
    mock_fetch: AsyncMock,
    client: TestClient,
    content_type: str | None,
    served_as: str,
) -> None:
    """The file proxy decrypts the stored token server-side and streams back
    whatever Telegram sent, typed, so the browser never holds the token.

    **Mutation:** drop `binary=True` and the payload is decoded as text, which
    corrupts every image.
    """
    headers = _auth(client)
    client.put(
        f"{PREFIX}/bot-credentials/file-bot-1",
        json={"name": "File Bot", "token": "888:FILETOKEN"},
        headers=headers,
    )
    mock_fetch.return_value = ((b"\xff\xd8jpeg", content_type), [])

    r = client.get(
        f"{TELEGRAM}/bot-file/file-bot-1",
        params={"path": "photos/file_1.jpg"},
        headers=headers,
    )

    assert r.status_code == 200
    assert r.content == b"\xff\xd8jpeg"
    assert r.headers["content-type"] == served_as
    assert mock_fetch.call_args[0][0] == (
        "https://api.telegram.org/file/bot888:FILETOKEN/photos/file_1.jpg"
    )
    assert mock_fetch.call_args.kwargs["binary"] is True
    assert mock_fetch.call_args.kwargs["retries"] == settings.TELEGRAM_API_RETRIES

    client.delete(f"{PREFIX}/bot-credentials/file-bot-1", headers=headers)


@patch("app.api.routes.telegram.fetch_with_retry", new_callable=AsyncMock)
def test_a_failed_bot_file_fetch_is_a_502_that_does_not_echo_the_token(
    mock_fetch: AsyncMock, client: TestClient
) -> None:
    """The fetch URL embeds the token, and an `httpx` error's message quotes
    its URL, so passing the exception text through would leak the credential
    into the browser.

    **Mutation:** put `str(exc)` in the 502 detail and the token assertion goes
    red.
    """
    headers = _auth(client)
    client.put(
        f"{PREFIX}/bot-credentials/file-bot-2",
        json={"name": "File Bot", "token": "999:LEAKME"},
        headers=headers,
    )
    mock_fetch.side_effect = RuntimeError(
        "GET https://api.telegram.org/file/bot999:LEAKME/x failed"
    )

    r = client.get(
        f"{TELEGRAM}/bot-file/file-bot-2", params={"path": "x"}, headers=headers
    )

    assert r.status_code == 502
    assert r.json() == {"detail": "Failed to fetch bot file"}
    assert "LEAKME" not in r.text

    client.delete(f"{PREFIX}/bot-credentials/file-bot-2", headers=headers)
