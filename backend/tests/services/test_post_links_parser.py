"""Body-link extraction tests (Discover link signal)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from bs4 import BeautifulSoup

from app.services.post_links_parser import channel_from_telegram_url, extract_body_links
from app.services.scraper import scrape_channel_page
from app.services.telegram_web import is_channel_handle

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "live"


def _widget(html: str):
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".tgme_widget_message")
    if el is None:
        pytest.fail("fixture has no .tgme_widget_message")
    return el


def _message(body: str) -> str:
    return f"""
    <div class="tgme_widget_message" data-post="ch/1">
      <div class="tgme_widget_message_text">{body}</div>
    </div>
    """


class TestIsChannelHandle:
    def test_accepts_valid_handles(self) -> None:
        assert is_channel_handle("news_channel")
        assert is_channel_handle("@news_channel")

    def test_rejects_short_digit_leading_and_reserved(self) -> None:
        assert not is_channel_handle("abcd")
        assert not is_channel_handle("1abcde")
        assert not is_channel_handle("joinchat")
        assert not is_channel_handle("a" + "b" * 32)


class TestChannelFromTelegramUrl:
    def test_resolves_bare_webview_and_permalink(self) -> None:
        assert channel_from_telegram_url("https://t.me/alpha_news") == "alpha_news"
        assert channel_from_telegram_url("https://t.me/s/alpha_news") == "alpha_news"
        assert channel_from_telegram_url("https://t.me/alpha_news/42") == "alpha_news"

    def test_rejects_invite_and_private_paths(self) -> None:
        assert channel_from_telegram_url("https://t.me/+SecretInvite") is None
        assert channel_from_telegram_url("https://t.me/joinchat/Secret") is None
        assert channel_from_telegram_url("https://t.me/c/1234567") is None
        assert channel_from_telegram_url("https://t.me/") is None


class TestExtractBodyLinks:
    def test_extracts_masked_link_href(self) -> None:
        el = _widget(
            _message('<a href="https://t.me/hidden_chan">Click here to join</a>')
        )
        assert extract_body_links(el) == [
            {"url": "https://t.me/hidden_chan", "channel": "hidden_chan"}
        ]

    def test_resolves_relative_href(self) -> None:
        el = _widget(_message('<a href="/alpha_news">Alpha</a>'))
        assert extract_body_links(el) == [
            {"url": "https://telegram.me/alpha_news", "channel": "alpha_news"}
        ]

    def test_dedupes_repeated_channel(self) -> None:
        el = _widget(
            _message(
                '<a href="https://t.me/alpha_news">one</a>'
                '<a href="https://t.me/alpha_news/12">two</a>'
            )
        )
        links = extract_body_links(el)
        assert len(links) == 1
        assert links[0]["channel"] == "alpha_news"

    def test_skips_external_and_invite_links(self) -> None:
        el = _widget(
            _message(
                '<a href="https://example.com/alpha_news">ext</a>'
                '<a href="https://t.me/+SecretInvite">invite</a>'
                '<a href="https://t.me/joinchat/Secret">joinchat</a>'
            )
        )
        assert extract_body_links(el) == []

    def test_returns_empty_without_text_element(self) -> None:
        el = _widget('<div class="tgme_widget_message" data-post="ch/1"></div>')
        assert extract_body_links(el) == []

    def test_real_fixture_yields_only_valid_handles(self) -> None:
        """Every link mined from captured Telegram HTML must be a usable handle."""
        html = (FIXTURES_DIR / "TelegramTips_root.html").read_text()
        soup = BeautifulSoup(html, "html.parser")
        seen_any = False
        for el in soup.select(".tgme_widget_message"):
            for link in extract_body_links(el):
                seen_any = True
                assert is_channel_handle(link["channel"])
                assert link["url"].startswith("http")
        assert seen_any, "fixture produced no body links — parser may be broken"


def test_links_survive_scrape_channel_page() -> None:
    """End-to-end: HTML -> post dict, so the sync path has something to persist."""
    html = """
    <html><body>
    <div class="tgme_widget_message" data-post="ch/105">
      <div class="tgme_widget_message_text">
        see <a href="https://t.me/masked_chan">this channel</a>
      </div>
      <time datetime="2024-06-01T12:00:00+00:00"></time>
    </div>
    </body></html>
    """

    async def _run() -> dict:
        with patch(
            "app.services.scraper.fetch_with_retry",
            new_callable=AsyncMock,
            return_value=(html, {"success": True, "totalDuration": 1, "attempts": []}),
        ):
            return await scrape_channel_page("ch", before_id=None)

    result = asyncio.run(_run())
    post = result["posts"][0]
    assert post["links"] == [
        {"url": "https://t.me/masked_chan", "channel": "masked_chan"}
    ]
