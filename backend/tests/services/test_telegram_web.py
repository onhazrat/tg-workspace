"""Tests for Telegram web-view URL helpers."""

from __future__ import annotations

from app.services.telegram_web import (
    extract_channel_name_from_href,
    is_telegram_web_url,
    is_telegram_web_view_url,
    parse_telegram_web_view_url,
    resolve_telegram_href,
    telegram_channel_post_url,
    telegram_web_view_channel_url,
    telegram_web_view_post_url,
)


def test_default_domain_builds_t_me_urls() -> None:
    assert telegram_web_view_channel_url("durov") == "https://t.me/s/durov"
    assert (
        telegram_web_view_channel_url("durov", before_id=100)
        == "https://t.me/s/durov?before=100"
    )
    assert (
        telegram_web_view_channel_url("durov", after_id=99)
        == "https://t.me/s/durov?after=99"
    )
    assert telegram_web_view_post_url("durov", 123) == "https://t.me/s/durov/123"
    assert telegram_channel_post_url("durov", 123) == "https://t.me/durov/123"


def test_resolve_relative_href_uses_configured_domain() -> None:
    assert resolve_telegram_href("/s/durov?before=50") == (
        "https://t.me/s/durov?before=50"
    )
    assert (
        resolve_telegram_href("https://telegram.me/s/durov")
        == "https://telegram.me/s/durov"
    )


def test_extract_channel_name_from_legacy_and_current_domains() -> None:
    assert extract_channel_name_from_href("https://t.me/durov") == "durov"
    assert extract_channel_name_from_href("https://telegram.me/durov") == "durov"


def test_parse_telegram_web_view_url_accepts_both_domains() -> None:
    after = parse_telegram_web_view_url("https://t.me/s/durov?after=10")
    assert after is not None
    assert after.channel_name == "durov"
    assert after.start_id == 11
    assert after.is_search_mode is True

    before = parse_telegram_web_view_url("https://telegram.me/s/durov?before=20")
    assert before is not None
    assert before.channel_name == "durov"
    assert before.start_id == 1

    single = parse_telegram_web_view_url("https://telegram.me/s/durov/42")
    assert single is not None
    assert single.channel_name == "durov"
    assert single.start_id == 42
    assert single.is_search_mode is False


def test_is_telegram_web_view_url_matches_both_domains() -> None:
    assert is_telegram_web_view_url("https://telegram.me/s/test")
    assert is_telegram_web_view_url("https://t.me/s/test")
    assert not is_telegram_web_view_url("https://api.telegram.org/bot")


def test_is_telegram_web_url_matches_both_domains() -> None:
    assert is_telegram_web_url("https://telegram.me/durov/1")
    assert is_telegram_web_url("https://t.me/durov/1")
    assert not is_telegram_web_url("https://example.com/t.me/durov")
