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
from app.services.publication_parts import build_parts
from app.services.telegram_web import telegram_web_base_url

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


# --------------------------------------------------------------------------
# Cutting
# --------------------------------------------------------------------------


def _paragraph(chars: int, word: str = "word") -> str:
    """Whole words separated by single spaces, one sentence, about `chars` long."""
    words = (chars // (len(word) + 1)) or 1
    return " ".join([word] * words) + "."


def test_a_long_summary_is_cut_between_paragraphs(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    p1, p2, p3 = _paragraph(1500), _paragraph(1500, "term"), _paragraph(1500, "item")

    _publish(client, superuser_token_headers, f"{p1}\n\n{p2}\n\n{p3}")

    assert telegram.texts == [f"{p1}\n\n{p2}", p3]


def test_a_heading_never_ends_a_part(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    """`p1` and the heading fit together; the heading goes with what it heads."""
    p1, p2 = _paragraph(2500), _paragraph(2000, "term")

    _publish(client, superuser_token_headers, f"{p1}\n\n**Heading**\n\n{p2}")

    assert telegram.texts == [p1, f"Heading\n\n{p2}"]


def test_a_paragraph_too_long_for_a_part_is_cut_at_a_line(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    # No sentence ends, so only the line breaks can keep the lines whole.
    l1, l2, l3 = (_paragraph(2000, w).rstrip(".") for w in ("word", "term", "item"))

    _publish(client, superuser_token_headers, f"{l1}\n{l2}\n{l3}")

    assert telegram.texts == [f"{l1}\n{l2}", l3]


def test_a_line_too_long_for_a_part_is_cut_at_a_sentence_end(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    s1, s2, s3 = _paragraph(2000), _paragraph(2000, "term"), _paragraph(2000, "item")

    _publish(client, superuser_token_headers, f"{s1} {s2} {s3}")

    assert telegram.texts == [f"{s1} {s2}", s3]


def test_a_sentence_too_long_for_a_part_is_cut_between_words(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    sentence = _paragraph(6000)

    _publish(client, superuser_token_headers, sentence)

    assert len(telegram.texts) == 2
    assert all(len(t) <= LIMIT for t in telegram.texts)
    assert telegram.texts[0].split(" ") == ["word"] * len(telegram.texts[0].split())
    assert " ".join(telegram.texts) == sentence


def test_a_word_longer_than_a_part_is_cut_hard_and_flagged() -> None:
    parts = build_parts("x" * 5000)

    assert [(p.text, p.cut_inside) for p in parts] == [
        ("x" * LIMIT, True),
        ("x" * (5000 - LIMIT), False),
    ]


def test_a_cut_inside_a_formatting_pair_is_flagged() -> None:
    """Only the whitespace fallback can land inside `**...**`; the plan says so."""
    parts = build_parts(f"**{_paragraph(6000)}**")

    assert [p.cut_inside for p in parts] == [True, False]


def test_paragraph_cuts_are_not_flagged() -> None:
    parts = build_parts(f"{_paragraph(3000)}\n\n**{_paragraph(3000, 'term')}**")

    assert [p.cut_inside for p in parts] == [False, False]
    assert [p.kind for p in parts] == ["summary", "summary"]


# --------------------------------------------------------------------------
# The limit is Telegram's: after entity parsing, in UTF-16 units
# --------------------------------------------------------------------------


def test_markup_does_not_count_against_the_limit(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    """4,098 characters as written, 4,090 once the `**` pairs are parsed away."""
    bold = f"**{'x' * 2044}**"

    _publish(client, superuser_token_headers, f"{bold}\n\n{bold}")

    assert telegram.texts == [f"{'x' * 2044}\n\n{'x' * 2044}"]


def test_an_emoji_counts_as_two_against_the_limit(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    """3,002 code points but 6,002 UTF-16 units: two Parts, not one."""
    emoji = "😀" * 1500

    _publish(client, superuser_token_headers, f"{emoji}\n\n{emoji}")

    assert telegram.texts == [emoji, emoji]


# --------------------------------------------------------------------------
# Rewrites, so the parser sends what the author meant
# --------------------------------------------------------------------------


def test_bullets_arrive_as_bullets_with_their_bold_labels(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _publish(client, superuser_token_headers, "* **Label:** text\n- other")

    assert telegram.texts == ["• Label: text\n• other"]
    assert telegram.entities == [[{"type": "bold", "offset": 2, "length": 6}]]


def test_a_single_asterisk_label_after_an_emoji_arrives_bold(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _publish(client, superuser_token_headers, "🕒 *Time Range:* today")

    assert telegram.texts == ["🕒 Time Range: today"]
    # The emoji is two UTF-16 units, then a space.
    assert telegram.entities == [[{"type": "bold", "offset": 3, "length": 11}]]


def test_a_handle_with_an_underscore_keeps_it_and_links_to_the_channel(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _publish(client, superuser_token_headers, "Channels: @news_ir, @plain")

    assert telegram.texts == ["Channels: @news_ir, @plain"]
    assert telegram.entities == [
        [
            {
                "type": "text_link",
                "offset": 10,
                "length": 8,
                "url": f"{telegram_web_base_url()}/news_ir",
            }
        ]
    ]


# --------------------------------------------------------------------------
# Metadata
# --------------------------------------------------------------------------


def test_the_metadata_is_its_own_part_and_gets_the_same_fixes(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    bot: str,
    telegram: _FakeTelegram,
) -> None:
    _publish(
        client,
        superuser_token_headers,
        "short body",
        metadata_text="📝 *Posts Analyzed:* 3",
    )

    assert telegram.texts == ["📝 Posts Analyzed: 3", "short body"]
    assert telegram.entities[0] == [{"type": "bold", "offset": 3, "length": 15}]
