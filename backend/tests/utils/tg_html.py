"""Helpers for building and locating Telegram web-view message widgets in tests."""

from __future__ import annotations

from pathlib import Path

from bs4 import BeautifulSoup, Tag

LIVE_FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "live"


def load_live_fixture(name: str) -> str:
    return (LIVE_FIXTURES_DIR / name).read_text(encoding="utf-8")


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
