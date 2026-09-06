"""Tests for Telegram channel metadata parsing."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

from bs4 import BeautifulSoup

from app.services.scraper import (
    _extract_channel_photo_url,
    _parse_channel_meta,
    get_channel_info,
)


def test_extract_channel_photo_url_from_nested_img() -> None:
    html = """
    <meta property="og:image" content="https://cdn.example/og.jpg">
    <i class="tgme_page_photo_image bgcolor2">
      <img src="https://cdn.example/avatar.jpg">
    </i>
    """
    soup = BeautifulSoup(html, "html.parser")
    assert _extract_channel_photo_url(soup) == "https://cdn.example/avatar.jpg"


def test_extract_channel_photo_url_falls_back_to_og_image() -> None:
    html = """
    <meta property="og:image" content="https://cdn.example/og.jpg">
    <i class="tgme_page_photo_image bgcolor2"></i>
    """
    soup = BeautifulSoup(html, "html.parser")
    assert _extract_channel_photo_url(soup) == "https://cdn.example/og.jpg"


def test_parse_channel_meta_includes_photo_url() -> None:
    html = """
    <div class="tgme_channel_info_header_title"><span>Test Channel</span></div>
    <i class="tgme_page_photo_image"><img src="https://cdn.example/avatar.jpg"></i>
    """
    meta = _parse_channel_meta(BeautifulSoup(html, "html.parser"), "testchannel")
    assert meta["displayName"] == "Test Channel"
    assert meta["photoUrl"] == "https://cdn.example/avatar.jpg"


# --------------------------------------------------------------------------
# The samples flag (ticket 02)
# --------------------------------------------------------------------------
#
# `get_channel_info` is the seam for whether the parser returns samples. The
# flag is opt-in and the Discover probe is the only caller that sets it, so
# what matters here is that the *default* path is byte-identical to what it was
# and that nothing about latest-post-id derivation moves either way.
#
# Watched to fail:
#   * set `samples` unconditionally -> the absent-key test fails
#   * derive `latestId` from the parsed posts -> the identical-either-way test
#     fails on the page whose newest widget carries no readable body
#   * keep `finalize_post_media_paths` for samples -> the thumb test fails

_SAMPLE_PAGE = """
<html><body>
<div class="tgme_channel_info">
  <div class="tgme_channel_info_header_title"><span>Sample News</span></div>
</div>
<div class="tgme_widget_message" data-post="samplenews/41">
  <div class="tgme_widget_message_text js-message_text">older</div>
  <a class="tgme_widget_message_date" href="https://t.me/samplenews/41"></a>
  <time datetime="2026-09-01T09:00:00+00:00"></time>
</div>
<div class="tgme_widget_message" data-post="samplenews/42">
  <div class="tgme_widget_message_text js-message_text">newer</div>
  <a class="tgme_widget_message_photo_wrap"
     style="background-image:url('https://cdn.example/thumb.jpg')"></a>
  <a class="tgme_widget_message_date" href="https://t.me/samplenews/42"></a>
  <time datetime="2026-09-01T10:00:00+00:00"></time>
  <span class="tgme_widget_message_views">9.7K</span>
</div>
</body></html>
"""

_TELEMETRY = {"success": True, "totalDuration": 1, "attempts": []}


def _info(*, with_samples: bool) -> dict[str, Any]:
    fetch = AsyncMock(return_value=(_SAMPLE_PAGE, _TELEMETRY))
    photo = AsyncMock(side_effect=lambda _c, url, **_kw: url)

    async def _run() -> dict[str, Any]:
        with (
            patch("app.services.scraper.fetch_with_retry", fetch),
            patch("app.services.scraper.resolve_cached_photo_url", photo),
        ):
            return await get_channel_info("samplenews", with_samples=with_samples)

    return asyncio.run(_run())


def test_the_meta_dict_carries_no_samples_key_unless_it_was_asked_for() -> None:
    """Absent, not empty.

    The write path reads the difference: a missing key means "this fetch did
    not look", where an empty list means "there are no recent Posts". Shipping
    an empty list by default would make every metadata-only fetch clear the
    snapshot it never looked at.
    """
    assert "samples" not in _info(with_samples=False)
    assert _info(with_samples=True)["samples"] != []


def test_latest_post_id_is_identical_whether_or_not_samples_were_parsed() -> None:
    """It feeds handle-kind classification and the unavailability check.

    Derived by regex over the widget ids inside `_parse_channel_meta`, never
    from the parsed Posts — so re-deriving it from `samples` would change
    verdicts on exactly the pages where the two disagree.
    """
    without = _info(with_samples=False)
    with_them = _info(with_samples=True)

    assert without["latestId"] == with_them["latestId"] == 42
    assert without["kind"] == with_them["kind"] == "channel"
    assert without["isUnavailableOnWebView"] == with_them["isUnavailableOnWebView"]


def test_the_counters_and_the_chat_id_still_ride_on_the_meta_dict() -> None:
    """Ticket 01's five columns are read off this same payload."""
    info = _info(with_samples=True)
    for key in ("photos", "videos", "files", "links", "telegramChatId"):
        assert key in info


def test_sample_media_is_parsed_but_never_pointed_at_our_own_cache() -> None:
    """A probe downloads nothing, so a local thumb path names a file that never arrives.

    `finalize_post_media_paths` is what rewrites it, and samples skip it. The
    media block itself is kept — the view and reaction counts live inside it,
    and they are most of what makes a sample worth reading.
    """
    samples = _info(with_samples=True)["samples"]
    by_id = {post["id"]: post for post in samples}

    assert set(by_id) == {41, 42}
    media = by_id[42]["media"]
    assert media["views"] == "9.7K"
    assert "thumbApiPath" not in media, (
        "a probe fills no thumb cache, so the rewritten path would render broken"
    )
    assert by_id[42]["timestamp"] > 0, "samples still get their millisecond timestamp"
