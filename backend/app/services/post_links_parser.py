"""Extract Telegram channel links from a post body's ``<a href>`` targets.

``extract_telegram_html_text`` flattens the message body to plain text, which
discards the href of masked links (custom anchor text over a ``t.me/`` URL).
Those links are a discovery signal, so they are captured separately here.

Deliberately a standalone module called from the scraper rather than part of
``parse_widget_media``: that function early-returns for posts with no media
kinds, which is exactly the text-only case most likely to carry links.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from bs4 import Tag

from app.services.telegram_html import message_body_element
from app.services.telegram_web import (
    is_channel_handle,
    is_telegram_web_url,
    resolve_telegram_href,
)


def _attr_str(value: str | list[str] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return value


def channel_from_telegram_url(url: str) -> str | None:
    """Resolve the channel a Telegram URL points at.

    Handles ``/s/<name>`` (web view) and ``/<name>/<post_id>`` (permalink).
    Mirrors ``channelFromTelegramPath`` in the frontend.
    """
    segments = [seg for seg in (urlparse(url).path or "").split("/") if seg]
    if not segments:
        return None
    candidate = (
        segments[1] if segments[0].lower() == "s" and len(segments) > 1 else segments[0]
    )
    return candidate if is_channel_handle(candidate) else None


def extract_body_links(el: Tag) -> list[dict[str, Any]]:
    """Telegram channel links in the message body, deduped by channel.

    Only Telegram-hosted links are kept — external URLs cannot yield a channel
    and would bloat the stored column.
    """
    text_el = message_body_element(el)
    if text_el is None:
        return []

    links: list[dict[str, Any]] = []
    seen: set[str] = set()

    for anchor in text_el.find_all("a", href=True):
        href = _attr_str(anchor.get("href"))
        if not href:
            continue
        url = resolve_telegram_href(href)
        if not is_telegram_web_url(url):
            continue
        channel = channel_from_telegram_url(url)
        if not channel:
            continue
        key = channel.lower()
        if key in seen:
            continue
        seen.add(key)
        links.append({"url": url, "channel": channel})

    return links
