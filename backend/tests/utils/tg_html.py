"""Helpers for building and locating Telegram web-view message widgets in tests."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

from app.services import scraper

LIVE_FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "live"


def load_live_fixture(name: str) -> str:
    return (LIVE_FIXTURES_DIR / name).read_text(encoding="utf-8")


def recent_page(html: str, channel_name: str, *, age_ms: int = 0) -> dict[str, Any]:
    """A saved page as the sync's page fetch answers it, for the sync seam.

    The live fixtures are years old, older than any retention, so each distinct
    publish time moves to a recent minute (`age_ms` further back) in the same
    order; Posts that shared a time, an Album's, still share one.
    """
    page = scraper._parse_scrape_channel_page(
        html, channel_name, "", None, None, None, None, {}
    )
    stamps = sorted({p["timestamp"] for p in page["posts"]})
    now = int(time.time() * 1000) - age_ms
    for p in page["posts"]:
        p["timestamp"] = now - (len(stamps) - stamps.index(p["timestamp"])) * 60_000
    return page


def live_fixture_paths() -> list[Path]:
    """Non-empty captured pages, for corpus-wide invariant checks."""
    return sorted(p for p in LIVE_FIXTURES_DIR.glob("*.html") if p.stat().st_size > 0)


def widgets(html: str, *, parser: str = "html.parser") -> list[Tag]:
    return list(BeautifulSoup(html, parser).select(".tgme_widget_message"))


def widget_by_post_id(html: str, post_id: int, *, parser: str = "html.parser") -> Tag:
    for el in widgets(html, parser=parser):
        data_post = el.get("data-post")
        if isinstance(data_post, list):
            data_post = data_post[0] if data_post else None
        if data_post and str(data_post).endswith(f"/{post_id}"):
            return el
    raise AssertionError(f"Widget for post {post_id} not found")


def message_widget(inner_html: str, *, data_post: str = "ch/1") -> Tag:
    html = f"""
    <div class="tgme_widget_message" data-post="{data_post}">
      {inner_html}
    </div>
    """
    return widgets(html)[0]


def body_html(text: str) -> str:
    return f'<div class="tgme_widget_message_text js-message_text">{text}</div>'


def reply_block_html(
    *,
    parent_id: int,
    channel: str = "ch",
    author: str = "Someone",
    quote: str = "parent excerpt",
    thumb_url: str | None = None,
) -> str:
    """The reply-preview anchor exactly as t.me renders it.

    Note the quote reuses ``tgme_widget_message_text`` and comes *before* the
    body — that ordering is the whole reason parsers must not select the class
    directly.
    """
    thumb = (
        f'<i class="tgme_widget_message_reply_thumb" '
        f"style=\"background-image:url('{thumb_url}')\"></i>"
        if thumb_url
        else ""
    )
    return f"""
    <a class="tgme_widget_message_reply" href="https://t.me/{channel}/{parent_id}">
      {thumb}
      <div class="tgme_widget_message_author">
        <span class="tgme_widget_message_author_name" dir="auto">{author}</span>
      </div>
      <div class="tgme_widget_message_text js-message_reply_text" dir="auto">{quote}</div>
    </a>
    """


def reply_widget(
    *,
    parent_id: int = 1,
    channel: str = "ch",
    author: str = "Someone",
    quote: str = "parent excerpt",
    body: str = "actual body",
    thumb_url: str | None = None,
    data_post: str = "ch/2",
) -> Tag:
    """A message widget that replies to ``parent_id``."""
    inner = reply_block_html(
        parent_id=parent_id,
        channel=channel,
        author=author,
        quote=quote,
        thumb_url=thumb_url,
    ) + body_html(body)
    return message_widget(inner, data_post=data_post)
