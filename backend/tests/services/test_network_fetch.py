"""Tests for Telegram web-view fetch validation."""

from __future__ import annotations

import pytest

from app.services.network import (
    _UNAVAILABLE_WEB_VIEW_MSG,
    _validate_telegram_web_view_page,
)


def test_validate_web_view_redirect_to_preview_page_raises() -> None:
    with pytest.raises(ConnectionError, match=_UNAVAILABLE_WEB_VIEW_MSG):
        _validate_telegram_web_view_page(
            request_url="https://t.me/s/AiSegaro",
            final_url="https://t.me/AiSegaro",
            html="<html></html>",
        )


def test_validate_web_view_action_without_messages_raises() -> None:
    with pytest.raises(ConnectionError, match=_UNAVAILABLE_WEB_VIEW_MSG):
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
