"""Fixture-based tests for post media parsing."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from app.services.post_media_parser import (
    finalize_post_media_paths,
    parse_abbreviated_count,
    parse_widget_media,
)
from app.services.scraper import _parse_posts_from_html
from tests.utils.tg_html import LIVE_FIXTURES_DIR as FIXTURES_DIR
from tests.utils.tg_html import (
    body_html,
    live_fixture_paths,
    message_widget,
    reply_widget,
    widgets,
)
from tests.utils.tg_html import (
    load_live_fixture as _load_fixture,
)
from tests.utils.tg_html import (
    widget_by_post_id as _widget_by_post_id,
)


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


# --- Reply handling -------------------------------------------------------
# Telegram reuses `tgme_widget_message_text` for the reply quote and the body,
# with the quote first in DOM order. These pin that the body wins.

REPLY_POSTS = (
    (444, "🚨 Last Call", "ContestBot is now ready"),
    (450, "4th PLACE", "🏆 Design Contest 2025: Results"),
    (454, "Hairy Goose", "🏆 Contest for Artists: Results"),
)


@pytest.mark.parametrize(("post_id", "body_start", "quote_start"), REPLY_POSTS)
def test_reply_post_text_is_the_body_not_the_quote(
    post_id: int, body_start: str, quote_start: str
) -> None:
    el = _widget_by_post_id(_load_fixture("contest_root.html"), post_id)
    text, _media, _thumb = parse_widget_media(el)
    assert text.startswith(body_start)
    assert quote_start not in text


def test_reply_thumb_is_never_treated_as_post_media() -> None:
    el = reply_widget(
        parent_id=443,
        thumb_url="https://cdn4.telesco.pe/file/parent-thumb.jpg",
        body="a text-only reply",
    )
    text, media, thumb_source = parse_widget_media(el)
    assert text == "a text-only reply"
    assert media is None
    assert thumb_source is None


def test_reply_quote_alone_does_not_become_the_caption() -> None:
    el = reply_widget(parent_id=1, quote="parent text", body="actual body")
    text, _media, _thumb = parse_widget_media(el)
    assert text == "actual body"


# --- Link previews must not lend their media to the post ------------------


def test_link_preview_video_is_not_the_posts_own_video() -> None:
    el = _widget_by_post_id(_load_fixture("durov_200.html"), 181)
    _text, media, _thumb = parse_widget_media(el)
    assert media is not None
    assert media["kinds"] == ["link_preview"]
    assert media.get("durationSec") is None


def test_link_preview_image_is_cached_as_a_thumbnail() -> None:
    el = _widget_by_post_id(_load_fixture("durov_512.html"), 504)
    _text, _media, thumb_source = parse_widget_media(el)
    assert thumb_source is not None
    assert thumb_source.startswith("https://")


# --- Album kinds ----------------------------------------------------------


@pytest.mark.parametrize(
    ("fixture", "post_id"), (("durov_400.html", 373), ("TelegramTips_246.html", 244))
)
def test_video_only_album_is_not_tagged_photo(fixture: str, post_id: int) -> None:
    el = _widget_by_post_id(_load_fixture(fixture), post_id)
    _text, media, _thumb = parse_widget_media(el)
    assert media is not None
    assert "grouped" in media["kinds"]
    assert "video" in media["kinds"]
    assert "photo" not in media["kinds"]


def test_photo_album_is_still_detected() -> None:
    el = _widget_by_post_id(_load_fixture("durov_512.html"), 510)
    _text, media, _thumb = parse_widget_media(el)
    assert media is not None
    assert "grouped" in media["kinds"]
    assert "photo" in media["kinds"]


# --- Previously invisible posts -------------------------------------------


def test_sticker_post_is_detected() -> None:
    el = _widget_by_post_id(_load_fixture("durov_50.html"), 41)
    text, media, _thumb = parse_widget_media(el)
    assert media is not None
    assert media["kinds"] == ["sticker"]
    assert text == "[sticker]"


def test_views_survive_on_a_post_with_no_media_kinds() -> None:
    el = message_widget(
        body_html("plain text post")
        + '<span class="tgme_widget_message_views">1.2K</span>'
    )
    text, media, _thumb = parse_widget_media(el)
    assert text == "plain text post"
    assert media is not None
    assert media["kinds"] == []
    assert media["views"] == "1.2K"
    # `kinds: []` keeps the post `text_only` for both filter implementations.
    assert media["isMediaOnly"] is False


def test_no_media_object_when_there_is_nothing_to_record() -> None:
    el = message_widget(body_html("plain text post"))
    _text, media, _thumb = parse_widget_media(el)
    assert media is None


# --- Corpus-wide invariants ------------------------------------------------
# These run over every captured page, so a future selector change that
# reintroduces one of the fixed defects fails here even without a targeted test.


@pytest.mark.parametrize("fixture", live_fixture_paths(), ids=lambda p: p.name)
def test_corpus_invariants(fixture: Path) -> None:
    for el in widgets(fixture.read_text(encoding="utf-8")):
        text, media, _thumb = parse_widget_media(el)
        kinds = media["kinds"] if media else []
        post = el.get("data-post") or fixture.name

        reply = el.select_one("a.tgme_widget_message_reply")
        if reply is not None:
            quote = reply.select_one(".js-message_reply_text")
            if quote is not None and quote.get_text(strip=True):
                assert text.strip() != quote.get_text(strip=False).strip(), (
                    f"{post}: post text is the replied-to post's quote"
                )

        if "photo" in kinds:
            grouped = el.select_one(".tgme_widget_message_grouped_wrap")
            if grouped is not None:
                assert grouped.select(".tgme_widget_message_photo_wrap"), (
                    f"{post}: album tagged photo but holds no photo items"
                )

        if media and media.get("durationSec") is not None:
            assert "video" in kinds, f"{post}: duration without a video kind"

        if media is None:
            assert not el.select_one(".tgme_widget_message_views"), (
                f"{post}: views counter dropped"
            )


# --- Numeric engagement counters ------------------------------------------
# `views` / `reactions` remain display strings; these are the sortable forms.


@pytest.mark.parametrize(
    ("text", "expected"),
    (
        ("315", 315),
        ("1.68K", 1_680),
        ("9.74K", 9_740),
        # 16.4 * 1_000_000 is 16399999.999... as a binary float.
        ("16.4M", 16_400_000),
        ("1,234", 1_234),
        ("5B", 5_000_000_000),
        ("", None),
        ("not a number", None),
        (None, None),
    ),
)
def test_parse_abbreviated_count(text: str | None, expected: int | None) -> None:
    assert parse_abbreviated_count(text) == expected


def test_views_are_also_stored_numerically() -> None:
    el = _widget_by_post_id(_load_fixture("Premium_root.html"), 153)
    _text, media, _thumb = parse_widget_media(el)
    assert media is not None
    assert media["views"] == "16.4M"
    assert media["viewsCount"] == 16_400_000


def test_reaction_chips_are_split_per_emoji() -> None:
    """The flattened string cannot say which count belongs to which emoji."""
    el = _widget_by_post_id(_load_fixture("durov_20.html"), 6)
    _text, media, _thumb = parse_widget_media(el)
    assert media is not None
    chips = media["reactionCounts"]
    # The leading count is an emoji-less paid-stars chip, not 👍's.
    assert chips[0] == {"count": 1_680, "isPaid": True}
    assert {"emoji": "👍", "count": 25_100} in chips
    assert {"emoji": "👎", "count": 383} in chips
    assert media["reactionsCount"] == sum(chip["count"] for chip in chips)


def test_custom_emoji_reactions_keep_their_id() -> None:
    """Premium emoji have no character in the markup, only an id."""
    el = _widget_by_post_id(_load_fixture("durov_512.html"), 512)
    _text, media, _thumb = parse_widget_media(el)
    assert media is not None
    custom = [c for c in media["reactionCounts"] if "customEmojiId" in c]
    assert custom
    assert all("emoji" not in chip for chip in custom)
    assert {"customEmojiId": "5465587407350942612", "count": 48_900} in custom


def test_posts_without_reactions_have_no_reaction_fields() -> None:
    el = _widget_by_post_id(_load_fixture("ReutersWorldChannel_151505.html"), 151505)
    _text, media, _thumb = parse_widget_media(el)
    assert media is not None
    assert "reactionCounts" not in media
    assert "reactionsCount" not in media


# --- Selector contract for kinds absent from the fixture corpus ------------
# SYNTHETIC markup. The live corpus has no voice/document/poll/audio/roundvideo
# post — `tests/fixtures/live/README.md` records that Telegram's web view does
# not render them, so no capture can cover these. These cases pin the selector
# strings so a future refactor cannot silently drop a kind; they are NOT
# evidence that the markup matches today's Telegram.


@pytest.mark.parametrize(
    ("inner_html", "expected_kind", "expected_text"),
    (
        ('<div class="tgme_widget_message_voice"></div>', "voice", "[voice]"),
        ('<div class="tgme_widget_message_document"></div>', "document", "[document]"),
        ('<div class="tgme_widget_message_audio"></div>', "audio", "[audio]"),
        (
            '<div class="tgme_widget_message_audio_player"></div>',
            "audio",
            "[audio]",
        ),
        (
            '<div class="tgme_widget_message_sticker_wrap"></div>',
            "sticker",
            "[sticker]",
        ),
        ('<i class="tgme_widget_message_sticker"></i>', "sticker", "[sticker]"),
    ),
)
def test_media_kind_selectors(
    inner_html: str, expected_kind: str, expected_text: str
) -> None:
    text, media, _thumb = parse_widget_media(message_widget(inner_html))
    assert media is not None
    assert media["kinds"] == [expected_kind]
    assert text == expected_text


@pytest.mark.parametrize(
    "inner_html",
    (
        '<div class="tgme_widget_message_roundvideo"></div>',
        '<div class="tgme_widget_message_roundvideo_player"></div>',
    ),
)
def test_video_notes_count_as_video(inner_html: str) -> None:
    """A round video *is* a video; it does not warrant its own kind."""
    text, media, _thumb = parse_widget_media(message_widget(inner_html))
    assert media is not None
    assert media["kinds"] == ["video"]
    assert text == "[video]"


def test_poll_question_becomes_the_text() -> None:
    el = message_widget(
        '<div class="tgme_widget_message_poll_question">Which one?</div>'
    )
    text, media, _thumb = parse_widget_media(el)
    assert media is not None
    assert media["kinds"] == ["poll"]
    assert text == "Which one?"
