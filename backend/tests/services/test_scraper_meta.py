"""Tests for Telegram channel metadata parsing."""

from __future__ import annotations

from bs4 import BeautifulSoup

from app.services.scraper import _extract_channel_photo_url, _parse_channel_meta


def test_extract_channel_photo_url_from_nested_img() -> None:
    html = """
    <meta property="og:image" content="https://cdn.example/og.jpg">
    <i class="tgme_page_photo_image bgcolor2">
      <img src="https://cdn.example/avatar.jpg">
    </i>
    """
    soup = BeautifulSoup(html, "html.parser")
    assert (
        _extract_channel_photo_url(soup) == "https://cdn.example/avatar.jpg"
    )


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
