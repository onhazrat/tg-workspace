"""Tests for Telegram HTML plain-text extraction."""

from __future__ import annotations

from pathlib import Path

from bs4 import BeautifulSoup

from app.services.post_media_parser import parse_widget_media
from app.services.scraper import _parse_channel_meta
from app.services.telegram_html import extract_telegram_html_text

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "live"


def test_extract_telegram_html_text_preserves_br_and_inline_spacing() -> None:
    html = """
    <div class="tgme_widget_message_text">
      Line one<br/>Line two<br/><br/>Line three with <b>bold</b> word.
    </div>
    """
    soup = BeautifulSoup(html, "html.parser")
    text = extract_telegram_html_text(soup.select_one(".tgme_widget_message_text"))
    assert text == "Line one\nLine two\n\nLine three with bold word."


def test_parse_widget_media_preserves_line_breaks_from_fixture() -> None:
    html = (FIXTURES_DIR / "telegram_root.html").read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.select(".tgme_widget_message"):
        text_el = el.select_one(".tgme_widget_message_text")
        if text_el and text_el.find("br"):
            text, _, _ = parse_widget_media(el)
            assert "\n" in text
            assert "add a tag" in text
            assert "now add a tag next" in text
            break
    else:
        raise AssertionError("Expected a post with <br> tags in telegram_root.html")


def test_parse_channel_meta_bio_preserves_line_breaks_from_fixture() -> None:
    html = (FIXTURES_DIR / "ReutersWorldChannel_root.html").read_text(encoding="utf-8")
    meta = _parse_channel_meta(
        BeautifulSoup(html, "html.parser"), "ReutersWorldChannel"
    )
    assert "\n\n" in meta["bio"]
    assert "Disclaimer:" in meta["bio"]
    assert "reuters.com" in meta["bio"]
