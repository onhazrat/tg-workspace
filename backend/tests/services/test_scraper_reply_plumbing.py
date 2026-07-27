"""Reply metadata must survive every hop from HTML to the DB payload.

Each hop drops unknown fields *silently* rather than raising, so these guard the
seams rather than the parsing itself (see test_post_reply_parser.py for that).
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

from app.services.scraper import _parse_posts_from_html, make_soup, scrape_channel
from app.services.sync_orchestrator import _posts_to_save
from tests.utils.tg_html import load_live_fixture


def _contest_posts() -> list[dict[str, Any]]:
    html = load_live_fixture("contest_root.html")
    posts, _next = _parse_posts_from_html(make_soup(html), 0, set())
    return posts


def test_scraper_emits_reply_fields() -> None:
    by_id = {p["id"]: p for p in _contest_posts()}
    post = by_id[444]
    assert post["replyToPostId"] == 443
    assert post["replyTo"]["channel"] == "contest"
    assert post["replyTo"]["authorName"] == "Telegram Contests"
    assert post["replyTo"]["url"] == "https://t.me/contest/443"
    assert post["replyTo"]["text"]


def test_non_reply_posts_carry_no_reply_keys() -> None:
    by_id = {p["id"]: p for p in _contest_posts()}
    non_reply = next(p for pid, p in by_id.items() if pid not in (444, 450, 454))
    assert "replyToPostId" not in non_reply
    assert "replyTo" not in non_reply


def test_posts_to_save_forwards_reply_fields() -> None:
    """`_posts_to_save` is an allowlist — a missing key is dropped in silence."""
    saved = _posts_to_save("contest", _contest_posts())
    assert saved
    for item in saved:
        assert "replyToPostId" in item
        assert "replyTo" in item

    by_id = {item["id"]: item for item in saved}
    assert by_id[444]["replyToPostId"] == 443
    assert by_id[444]["replyTo"]["channel"] == "contest"


def test_scrape_channel_with_known_latest_id_does_not_raise() -> None:
    """`meta` used to be bound only when the channel page was fetched."""
    html = """
    <html><body>
    <div class="tgme_widget_message" data-post="ch/105">
      <div class="tgme_widget_message_text js-message_text">hello</div>
      <time datetime="2024-06-01T12:00:00+00:00"></time>
    </div>
    </body></html>
    """

    async def _run() -> dict[str, Any]:
        with patch(
            "app.services.scraper.fetch_with_retry",
            new_callable=AsyncMock,
            return_value=(html, {"success": True, "totalDuration": 1, "attempts": []}),
        ):
            return await scrape_channel(
                "https://t.me/s/ch/105",
                known_latest_id=999,
                known_display_name="Ch",
            )

    result = asyncio.run(_run())
    assert result["latestId"] == 999
    assert result["telegramChatId"] is None
    assert result["posts"]
