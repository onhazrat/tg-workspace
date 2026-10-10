"""SUMTAB-08: the Account's Publishing settings shape every send.

Three personal settings live under the `publishing` key: the citation style,
link previews and the time zone. They are read where the token is decrypted,
in `publish_summary_text`, so the quick message, the Summary tab and the
scheduler all apply them without being told. Driven through
`POST /telegram/publish` with the outbound Telegram call faked, asserting what
Telegram would receive.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.services import publish as publish_service
from app.services.telegram_web import telegram_web_base_url

DATA = f"{settings.API_V1_STR}/data"
TELEGRAM = f"{settings.API_V1_STR}/telegram"


class _FakeTelegram:
    def __init__(self) -> None:
        self.bodies: list[dict[str, Any]] = []

    async def __call__(self, url: str, **kwargs: Any) -> tuple[Any, Any]:
        self.bodies.append(kwargs["json_body"])
        return {"ok": True, "result": {"message_id": len(self.bodies)}}, {}

    @property
    def texts(self) -> list[str]:
        return [b["text"] for b in self.bodies]

    def links(self, i: int = 0) -> list[tuple[str, str]]:
        """(linked text, url) for every text_link in the i-th message."""
        text = self.bodies[i]["text"]
        return [
            (text[e["offset"] : e["offset"] + e["length"]], e["url"])
            for e in self.bodies[i].get("entities", [])
            if e["type"] == "text_link"
        ]


@pytest.fixture
def telegram(monkeypatch: pytest.MonkeyPatch) -> _FakeTelegram:
    fake = _FakeTelegram()
    monkeypatch.setattr(publish_service, "fetch_with_retry", fake)
    return fake


@pytest.fixture
def bot(client: TestClient, superuser_token_headers: dict[str, str]) -> Iterator[str]:
    client.put(
        f"{DATA}/bot-credentials/settings-bot",
        json={"name": "Settings Bot", "token": "888:SETTINGSTOKEN"},
        headers=superuser_token_headers,
    )
    yield "settings-bot"
    client.delete(
        f"{DATA}/bot-credentials/settings-bot", headers=superuser_token_headers
    )


def _set(client: TestClient, headers: dict[str, str], **fields: Any) -> None:
    r = client.put(f"{DATA}/settings/publishing", json=fields, headers=headers)
    assert r.status_code == 200, r.text


def _publish(
    client: TestClient,
    headers: dict[str, str],
    text: str,
    metadata_text: str | None = None,
) -> None:
    body: dict[str, Any] = {
        "credentialId": "settings-bot",
        "chatId": "-100123",
        "text": text,
    }
    if metadata_text is not None:
        body["metadataText"] = metadata_text
    r = client.post(f"{TELEGRAM}/publish", json=body, headers=headers)
    assert r.status_code == 200, r.text


def _post(channel: str, post_id: int) -> str:
    return f"{telegram_web_base_url()}/{channel}/{post_id}"


CITED = "Rates rose [news_ir #5] and fell [tech #9] [news_ir #5]."


# --------------------------------------------------------------------------
# Citation style
# --------------------------------------------------------------------------


def test_numbered_citations_share_one_numbering_across_metadata_and_prose(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _set(client, superuser_token_headers, citationStyle="numbered")

    _publish(
        client,
        superuser_token_headers,
        CITED,
        metadata_text="Source of the week [tech #9]",
    )

    assert telegram.texts == [
        "Source of the week [1]",
        "Rates rose [2] and fell [1] [2].",
    ]
    assert telegram.links(0) == [("[1]", _post("tech", 9))]
    assert telegram.links(1) == [
        ("[2]", _post("news_ir", 5)),
        ("[1]", _post("tech", 9)),
        ("[2]", _post("news_ir", 5)),
    ]


def test_channel_name_citations_group_side_by_side_ones_in_parentheses(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _set(client, superuser_token_headers, citationStyle="channelName")

    _publish(client, superuser_token_headers, CITED)

    assert telegram.texts == ["Rates rose (news_ir) and fell (tech, news_ir)."]
    assert telegram.links() == [
        ("news_ir", _post("news_ir", 5)),
        ("tech", _post("tech", 9)),
        ("news_ir", _post("news_ir", 5)),
    ]


def test_citations_go_out_as_written_until_the_account_chooses(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _publish(client, superuser_token_headers, CITED)

    assert telegram.texts == [CITED]
    assert [url for _, url in telegram.links()] == [
        _post("news_ir", 5),
        _post("tech", 9),
        _post("news_ir", 5),
    ]


# --------------------------------------------------------------------------
# Link previews
# --------------------------------------------------------------------------


def test_every_part_goes_out_with_link_previews_off_by_default(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _publish(client, superuser_token_headers, CITED, metadata_text="Meta")

    assert len(telegram.bodies) == 2
    assert all(
        b["link_preview_options"] == {"is_disabled": True} for b in telegram.bodies
    )


def test_an_account_that_turned_link_previews_on_gets_them(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _set(client, superuser_token_headers, linkPreviews=True)

    _publish(client, superuser_token_headers, CITED, metadata_text="Meta")

    assert len(telegram.bodies) == 2
    assert all("link_preview_options" not in b for b in telegram.bodies)
