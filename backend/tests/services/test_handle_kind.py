"""Classification of a `t.me/<handle>` page (IDEA-011 D9, ADR-047).

The rules on hand-written markup. The real pages Telegram serves for each
Handle kind are pinned end to end in `tests/api/test_directory_handle_kinds.py`,
which is the restyle guard; `unknown` is an acceptable answer for a page that
matches no known shape.
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from app.services.scraper import _classify_handle_kind, _parse_channel_meta


def _kind(html: str, latest_id: int = 0) -> str:
    return _classify_handle_kind(BeautifulSoup(html, "html.parser"), latest_id)


def test_a_readable_feed_is_a_channel() -> None:
    assert _kind("", latest_id=17) == "channel"


def test_a_subscriber_count_without_a_feed_is_a_hidden_channel() -> None:
    """Real, but not scrapeable — which is why kind and status are separate."""
    html = '<div class="tgme_page_extra">12 345 subscribers</div>'
    assert _kind(html) == "channel"


def test_a_member_count_is_a_group() -> None:
    html = '<div class="tgme_page_extra">1 234 members, 56 online</div>'
    assert _kind(html) == "group"


def test_an_unrecognizable_page_is_unknown() -> None:
    assert _kind("<div>nothing useful here</div>") == "unknown"


def test_meta_reports_whether_the_page_came_from_telegram() -> None:
    """The signal that keeps a proxy error page from becoming a verdict."""
    telegram = _parse_channel_meta(
        BeautifulSoup('<div class="tgme_page_action">Join</div>', "html.parser"),
        "somechannel",
    )
    assert telegram["isTelegramPage"] is True

    garbage = _parse_channel_meta(
        BeautifulSoup("<html><body>403 Forbidden</body></html>", "html.parser"),
        "somechannel",
    )
    assert garbage["isTelegramPage"] is False
    # It would otherwise look exactly like a resolvable "unavailable" handle.
    assert garbage["isUnavailableOnWebView"] is False
