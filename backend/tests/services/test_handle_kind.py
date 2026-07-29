"""Best-effort classification of a `t.me/<handle>` page (IDEA-011 D9).

These are heuristics over presentation markup, so they are held to a lower bar
than the structural `isUnavailableOnWebView` check: `unknown` is an acceptable
answer everywhere, and the kind only ever changes the wording of a row, never
whether it is hidden.
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from app.services.scraper import _classify_handle_kind, _parse_channel_meta


def _kind(html: str, handle: str = "something", latest_id: int = 0) -> str:
    return _classify_handle_kind(BeautifulSoup(html, "html.parser"), handle, latest_id)


def test_a_readable_feed_is_a_channel() -> None:
    assert _kind("", latest_id=17) == "channel"


def test_a_subscriber_count_without_a_feed_is_a_private_channel() -> None:
    """Real, but not scrapeable — which is why kind and status are separate."""
    html = '<div class="tgme_page_extra">12 345 subscribers</div>'
    assert _kind(html) == "channel"


def test_a_member_count_is_a_group() -> None:
    html = '<div class="tgme_page_extra">1 234 members, 56 online</div>'
    assert _kind(html) == "group"


def test_a_bot_suffix_is_a_bot() -> None:
    """Telegram requires bot usernames to end in "bot", so this is a rule."""
    html = '<a class="tgme_page_action">Send Message</a>'
    assert _kind(html, handle="translate_bot") == "bot"


def test_a_member_count_beats_the_bot_suffix() -> None:
    """A group named "@somethingbot" is still a group."""
    html = '<div class="tgme_page_extra">300 members</div>'
    assert _kind(html, handle="chatbot") == "group"


def test_a_presence_line_is_a_personal_account() -> None:
    html = '<div class="tgme_page_extra">last seen recently</div>'
    assert _kind(html) == "user"


def test_an_action_button_alone_is_assumed_to_be_a_user() -> None:
    html = '<a class="tgme_page_action">Send Message</a>'
    assert _kind(html) == "user"


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
