"""Backward page scraper tests."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.services.scraper import scrape_channel_page

SAMPLE_HTML = """
<html><body>
<div class="tgme_widget_message" data-post="ch/105">
  <div class="tgme_widget_message_text">middle</div>
  <time datetime="2024-06-01T12:00:00+00:00"></time>
</div>
<div class="tgme_widget_message" data-post="ch/110">
  <div class="tgme_widget_message_text">newest</div>
  <time datetime="2024-06-01T13:00:00+00:00"></time>
</div>
</body></html>
"""


def test_scrape_channel_page_returns_next_before_id() -> None:
    async def _run() -> dict:
        with patch(
            "app.services.scraper.fetch_with_retry",
            new_callable=AsyncMock,
            return_value=(
                SAMPLE_HTML,
                {"success": True, "totalDuration": 1, "attempts": []},
            ),
        ):
            return await scrape_channel_page("ch", before_id=None)

    result = asyncio.run(_run())
    assert len(result["posts"]) == 2
    assert result["nextBeforeId"] == 105
    assert result["posts"][0]["id"] == 105
    assert result["posts"][0]["timestamp"] > 0
