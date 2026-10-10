"""SUMTAB-07: every publish goes out as Parts, cut between paragraphs.

Driven through `POST /telegram/publish` (the free-text quick message) with the
outbound Telegram call faked at the one place a publish reaches it,
`app.services.publish.fetch_with_retry`. What is asserted is what Telegram
would receive: one `sendMessage` per Part, in order, its plain text and its
entities. The route used to carry its own copy of the send loop; since the
prefactor it calls `publish_summary_text`, so this file also covers the
scheduler's send, which `test_auto_publish_scoping.py` pins at its own seam.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.services import publish as publish_service
from app.services.credentials import BOT_CREDENTIAL_NOT_FOUND

DATA = f"{settings.API_V1_STR}/data"
TELEGRAM = f"{settings.API_V1_STR}/telegram"
LIMIT = 4096


class _FakeTelegram:
    """Records every `sendMessage` payload and answers ok."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, url: str, **kwargs: Any) -> tuple[Any, Any]:
        self.calls.append({"url": url, **kwargs})
        return {"ok": True, "result": {"message_id": len(self.calls)}}, {}

    @property
    def texts(self) -> list[str]:
        return [c["json_body"]["text"] for c in self.calls]

    @property
    def entities(self) -> list[list[dict[str, Any]]]:
        return [c["json_body"].get("entities", []) for c in self.calls]


@pytest.fixture
def telegram(monkeypatch: pytest.MonkeyPatch) -> _FakeTelegram:
    fake = _FakeTelegram()
    monkeypatch.setattr(publish_service, "fetch_with_retry", fake)
    return fake


@pytest.fixture
def bot(client: TestClient, superuser_token_headers: dict[str, str]) -> Iterator[str]:
    client.put(
        f"{DATA}/bot-credentials/parts-bot",
        json={"name": "Parts Bot", "token": "777:PARTSTOKEN"},
        headers=superuser_token_headers,
    )
    yield "parts-bot"
    client.delete(f"{DATA}/bot-credentials/parts-bot", headers=superuser_token_headers)


def _publish(
    client: TestClient,
    headers: dict[str, str],
    text: str,
    *,
    credential_id: str = "parts-bot",
    metadata_text: str | None = None,
) -> Any:
    body: dict[str, Any] = {
        "credentialId": credential_id,
        "chatId": "-100123",
        "text": text,
    }
    if metadata_text is not None:
        body["metadataText"] = metadata_text
    return client.post(f"{TELEGRAM}/publish", json=body, headers=headers)


# --------------------------------------------------------------------------
# Prefactor: the quick message sends through the shared publish service
# --------------------------------------------------------------------------


def test_the_quick_message_sends_through_the_publish_service(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    r = _publish(client, superuser_token_headers, "hello **world**")

    assert r.status_code == 200
    assert r.json()["success"] is True
    assert len(telegram.calls) == 1
    assert "777:PARTSTOKEN" in telegram.calls[0]["url"]
    assert telegram.calls[0]["json_body"]["chat_id"] == "-100123"
    assert telegram.texts == ["hello world"]
    assert telegram.entities == [[{"type": "bold", "offset": 6, "length": 5}]]


def test_an_absent_credential_is_still_a_404_with_the_family_detail(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: _FakeTelegram,
) -> None:
    r = _publish(client, superuser_token_headers, "hi", credential_id="no-such-bot")

    assert r.status_code == 404
    assert r.json()["detail"] == BOT_CREDENTIAL_NOT_FOUND
    assert telegram.calls == []
