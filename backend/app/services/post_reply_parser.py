"""Extract reply metadata from Telegram web-view message widgets.

A reply renders the post it answers as a preview block *inside* the replying
widget: parent link, author name, thumbnail, and a truncated excerpt of the
parent's text. Capturing it lets a thread be reconstructed without refetching
the parent.

Deliberately a standalone module called from the scraper rather than part of
``parse_widget_media``, for the same reason as ``post_links_parser``: replies to
text-only posts carry no media kinds, which is the case that function
short-circuits.
"""

from __future__ import annotations

import re
from typing import Any

from bs4 import Tag

from app.services.post_links_parser import channel_from_telegram_url
from app.services.telegram_html import (
    attr_str,
    extract_telegram_html_text,
    message_reply_block,
)
from app.services.telegram_web import is_telegram_web_url, resolve_telegram_href

_TRAILING_ID_RE = re.compile(r"/(\d+)$")


def extract_reply(el: Tag) -> tuple[int | None, dict[str, Any] | None]:
    """Return ``(parent post id, reply metadata)`` for a message widget.

    The metadata dict uses camelCase keys for direct JSON storage and omits
    anything absent. Its ``text`` is Telegram's *truncated* excerpt of the
    parent post, not the parent's full body.
    """
    block = message_reply_block(el)
    if block is None:
        return None, None

    href = attr_str(block.get("href"))
    url = resolve_telegram_href(href) if href else None
    if url and not is_telegram_web_url(url):
        url = None

    post_id: int | None = None
    channel: str | None = None
    if url:
        match = _TRAILING_ID_RE.search(url.split("?")[0].split("#")[0])
        if match:
            post_id = int(match.group(1))
        # Returns None for private (`/c/…`) and invite (`/joinchat/…`) parents,
        # which must never be stored as if they were public handles.
        channel = channel_from_telegram_url(url)

    author_el = block.select_one(".tgme_widget_message_author_name")
    author_name = author_el.get_text(strip=True) if author_el else None

    text_el = block.select_one(".js-message_reply_text, .tgme_widget_message_text")
    text = extract_telegram_html_text(text_el)

    reply: dict[str, Any] = {}
    if channel:
        reply["channel"] = channel
    if author_name:
        reply["authorName"] = author_name
    if text:
        reply["text"] = text
    if url:
        reply["url"] = url

    return post_id, reply or None
