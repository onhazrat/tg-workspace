"""Tests for Telegram web-view fetch validation."""

from __future__ import annotations

import pytest

from app.services.network import _validate_telegram_web_view_page
from app.services.telegram_web import (
    UNAVAILABLE_WEB_VIEW_MESSAGE,
    TelegramWebViewUnavailable,
)


def test_validate_web_view_redirect_to_preview_page_raises() -> None:
    with pytest.raises(TelegramWebViewUnavailable, match=UNAVAILABLE_WEB_VIEW_MESSAGE):
        _validate_telegram_web_view_page(
            request_url="https://t.me/s/AiSegaro",
            final_url="https://t.me/AiSegaro",
            html="<html></html>",
        )


def test_validate_web_view_action_without_messages_raises() -> None:
    with pytest.raises(TelegramWebViewUnavailable, match=UNAVAILABLE_WEB_VIEW_MESSAGE):
        _validate_telegram_web_view_page(
            request_url="https://t.me/s/testchannel",
            final_url="https://t.me/s/testchannel",
            html='<div class="tgme_page_action"></div>',
        )


def test_validate_web_view_public_channel_passes() -> None:
    _validate_telegram_web_view_page(
        request_url="https://t.me/s/testchannel",
        final_url="https://t.me/s/testchannel",
        html=(
            '<div class="tgme_widget_message_date"></div>'
            '<div class="tgme_page_action"></div>'
        ),
    )


def test_soft_block_is_still_a_connection_error() -> None:
    """Callers that only know about network failures must keep working."""
    assert issubclass(TelegramWebViewUnavailable, ConnectionError)
    assert str(TelegramWebViewUnavailable()) == UNAVAILABLE_WEB_VIEW_MESSAGE
