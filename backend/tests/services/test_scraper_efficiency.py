"""Request-count and record-shape guards for the scrape entrypoints."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

from app.services.scraper import resolve_start_time_to_id, scrape_channel

_PAGE = """
<html><body>
<div class="tgme_widget_message" data-post="ch/105">
  <div class="tgme_widget_message_text js-message_text">hello</div>
  <time datetime="2024-06-01T12:00:00+00:00"></time>
</div>
</body></html>
"""

_TELEMETRY = {"success": True, "totalDuration": 1, "attempts": []}


def _fetch_mock() -> AsyncMock:
    return AsyncMock(return_value=(_PAGE, _TELEMETRY))


def test_search_mode_with_known_latest_id_makes_one_request() -> None:
    """A known latest id must suppress the extra channel-page fetch."""
    fetch = _fetch_mock()

    async def _run() -> dict[str, Any]:
        with patch("app.services.scraper.fetch_with_retry", fetch):
            return await scrape_channel(
                "https://t.me/s/ch?before=200", known_latest_id=999
            )

    asyncio.run(_run())
    assert fetch.await_count == 1


def test_search_mode_without_known_latest_id_still_fetches_channel_page() -> None:
    """Contrast case: the second request is what the known id saves."""
    fetch = _fetch_mock()

    async def _run() -> dict[str, Any]:
        with patch("app.services.scraper.fetch_with_retry", fetch):
            return await scrape_channel("https://t.me/s/ch?before=200")

    asyncio.run(_run())
    assert fetch.await_count == 2


def test_resolver_probes_pass_the_known_latest_id() -> None:
    """Otherwise each binary-search probe re-derives an id we already have."""
    channel_info = AsyncMock(
        return_value={"latestId": 1000, "isUnavailableOnWebView": False}
    )
    probe = AsyncMock(return_value={"id": 500, "time": 5_000})

    async def _run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", probe),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("ch", 5_000)

    asyncio.run(_run())
    assert probe.await_count > 0
    for call in probe.await_args_list:
        assert call.kwargs["known_latest_id"] == 1000


def test_both_entrypoints_agree_on_the_post_record_shape() -> None:
    """`scrape_channel` had its own copy of the timestamp enrichment.

    Its copy omitted the `timestamp = 0` fallback, so a post with no date came
    out of one entrypoint with no `timestamp` key and out of the other with 0.
    """
    dateless = """
    <html><body>
    <div class="tgme_widget_message" data-post="ch/106">
      <div class="tgme_widget_message_text js-message_text">no date here</div>
    </div>
    </body></html>
    """

    async def _run() -> dict[str, Any]:
        with patch(
            "app.services.scraper.fetch_with_retry",
            AsyncMock(return_value=(dateless, _TELEMETRY)),
        ):
            return await scrape_channel(
                "https://t.me/s/ch?before=200", known_latest_id=999
            )

    result = asyncio.run(_run())
    post = result["posts"][0]
    assert post["timestamp"] == 0
    assert post["channelName"] == "ch"
