from pathlib import Path

from bs4 import BeautifulSoup

from app.services.scraper import _extract_telegram_chat_id, _parse_channel_meta

LIVE_FIXTURES = Path(__file__).parent.parent / "fixtures" / "live"


def test_extract_telegram_chat_id_from_live_fixture_telegram_387() -> None:
    html = (LIVE_FIXTURES / "telegram_387.html").read_text(encoding="utf-8")
    chat_id = _extract_telegram_chat_id(BeautifulSoup(html, "html.parser"))
    assert chat_id == -1005640892


def test_parse_channel_meta_includes_telegram_chat_id() -> None:
    html = (LIVE_FIXTURES / "durov_522.html").read_text(encoding="utf-8")
    meta = _parse_channel_meta(BeautifulSoup(html, "html.parser"), "durov")
    assert meta["telegramChatId"] == -1006503122
