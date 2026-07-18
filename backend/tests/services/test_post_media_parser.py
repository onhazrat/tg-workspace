"""Fixture-based tests for post media parsing."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from app.services.post_media_parser import finalize_post_media_paths, parse_widget_media
from app.services.scraper import _parse_posts_from_html

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "live"


def _load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def _widget_by_post_id(html: str, post_id: int):
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.select(".tgme_widget_message"):
        data_post = el.get("data-post")
        if isinstance(data_post, list):
            data_post = data_post[0] if data_post else None
        if data_post and str(data_post).endswith(f"/{post_id}"):
            return el
    pytest.fail(f"Widget for post {post_id} not found")


def test_photo_only_post_durov_522() -> None:
    html = _load_fixture("durov_522.html")
    el = _widget_by_post_id(html, 522)
    text, media, thumb_source = parse_widget_media(
        el, channel_name="durov", post_id=522
    )
    assert text == "[photo]"
    assert media is not None
    assert media["kinds"] == ["photo"]
    assert media["isMediaOnly"] is True
    assert thumb_source and thumb_source.startswith("https://")
    assert media["thumbApiPath"] == "/api/v1/telegram/post-thumb/durov/522"


def test_grouped_photo_post_durov_510() -> None:
    html = _load_fixture("durov_512.html")
    el = _widget_by_post_id(html, 510)
    text, media, _thumb = parse_widget_media(el, channel_name="durov", post_id=510)
    assert "grouped" in media["kinds"]
    assert "photo" in media["kinds"]
    assert media.get("groupedCount", 0) >= 2
    assert isinstance(text, str) and text


def test_link_preview_post_durov_504() -> None:
    html = _load_fixture("durov_512.html")
    el = _widget_by_post_id(html, 504)
    _text, media, _thumb = parse_widget_media(el, channel_name="durov", post_id=504)
    assert media is not None
    assert "link_preview" in media["kinds"]
    preview = media.get("linkPreview") or {}
    assert preview.get("title") or preview.get("description")


def test_reuters_photo_caption_and_views() -> None:
    html = _load_fixture("ReutersWorldChannel_151505.html")
    el = _widget_by_post_id(html, 151505)
    text, media, _thumb = parse_widget_media(
        el, channel_name="ReutersWorldChannel", post_id=151505
    )
    assert "photo" in media["kinds"]
    assert text and text != "[photo]"
    assert media.get("views")
    assert media.get("reactions") is None


def test_durov_reactions_present() -> None:
    html = _load_fixture("durov_512.html")
    el = _widget_by_post_id(html, 512)
    _text, media, _thumb = parse_widget_media(el, channel_name="durov", post_id=512)
    assert media is not None
    assert media.get("reactions")


def test_video_duration_when_present() -> None:
    html = _load_fixture("durov_512.html")
    el = _widget_by_post_id(html, 512)
    _text, media, _thumb = parse_widget_media(el, channel_name="durov", post_id=512)
    assert "video" in media["kinds"]
    assert media.get("durationSec") == 9


def test_parse_posts_from_html_regression_batch() -> None:
    for fixture_name in (
        "durov_522.html",
        "durov_512.html",
        "ReutersWorldChannel_151505.html",
        "TelegramTips_246.html",
    ):
        html = _load_fixture(fixture_name)
        posts, _next = _parse_posts_from_html(
            BeautifulSoup(html, "html.parser"), 0, set()
        )
        assert posts, f"No posts parsed from {fixture_name}"
        media_posts = [p for p in posts if p.get("media")]
        assert media_posts, f"No media posts in {fixture_name}"
        placeholders = [p for p in posts if p.get("text") == "[Media/No Text Content]"]
        assert not placeholders, (
            f"Legacy placeholders remain in {fixture_name}: "
            f"{[p['id'] for p in placeholders]}"
        )


def test_meta_json_post_ids_have_media_in_html() -> None:
    meta_path = FIXTURES_DIR / "durov_522.meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    html = _load_fixture("durov_522.html")
    posts, _next = _parse_posts_from_html(BeautifulSoup(html, "html.parser"), 0, set())
    by_id = {p["id"]: p for p in posts}
    for post_id in meta.get("post_ids_found", []):
        if post_id == 522:
            assert by_id[post_id]["text"] == "[photo]"
            finalize_post_media_paths(by_id[post_id], "durov")
            assert by_id[post_id]["media"]["kinds"] == ["photo"]


def test_finalize_post_media_paths_keeps_thumb_source_for_sync_cache() -> None:
    html = _load_fixture("durov_522.html")
    posts, _next = _parse_posts_from_html(BeautifulSoup(html, "html.parser"), 0, set())
    post = next(p for p in posts if p.get("id") == 522)
    assert post.get("_thumbSourceUrl")

    from app.services.scraper import _enrich_posts_with_timestamps

    enriched = _enrich_posts_with_timestamps([post], "durov")
    enriched_post = enriched[0]
    assert enriched_post["media"]["thumbApiPath"] == (
        "/api/v1/telegram/post-thumb/durov/522"
    )
    assert enriched_post.get("_thumbSourceUrl")
