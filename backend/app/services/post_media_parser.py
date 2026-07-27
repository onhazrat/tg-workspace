"""Extract PostMedia metadata from Telegram web-view message widgets."""

from __future__ import annotations

import re
from copy import copy
from typing import Any

from bs4 import Tag

from app.schemas.post_media import PostMedia
from app.services.post_thumbnails import post_thumb_api_path
from app.services.telegram_html import (
    attr_str,
    extract_telegram_html_text,
    message_body_element,
)

_BACKGROUND_IMAGE_RE = re.compile(r"background-image:\s*url\(['\"]?([^'\"()]+)['\"]?\)")
_LEGACY_MEDIA_PLACEHOLDER = "[Media/No Text Content]"


def _extract_background_url(style: str | None) -> str | None:
    if not style:
        return None
    match = _BACKGROUND_IMAGE_RE.search(style)
    if not match:
        return None
    return match.group(1).strip()


def _extract_caption(el: Tag) -> str | None:
    text_el = message_body_element(el)
    if not text_el:
        return None
    text = extract_telegram_html_text(text_el)
    return text if text else None


# A link preview renders its own player as `link_preview_video_player
# js-message_video_player` — that video belongs to the *linked* post, not this
# one, so it must not become a `video` kind (nor contribute a duration).
_VIDEO_PLAYER_SELECTOR = (
    ".tgme_widget_message_video_player:not(.link_preview_video_player), "
    ".js-message_video_player:not(.link_preview_video_player), "
    ".tgme_widget_message_roundvideo, .tgme_widget_message_roundvideo_player"
)


def _detect_kinds(el: Tag) -> list[str]:
    kinds: list[str] = []
    if el.select_one(".tgme_widget_message_grouped_wrap"):
        kinds.append("grouped")
    # `.grouped_media_wrap` is the generic album *item* wrapper, not a photo
    # marker — genuine photos carry `tgme_widget_message_photo_wrap` on the same
    # node, while video-only albums would otherwise be mislabelled as photos.
    if el.select_one(".tgme_widget_message_photo_wrap, .js-message_photo"):
        if "photo" not in kinds:
            kinds.append("photo")
    if el.select_one(_VIDEO_PLAYER_SELECTOR):
        kinds.append("video")
    if el.select_one(".tgme_widget_message_voice"):
        kinds.append("voice")
    if el.select_one(".tgme_widget_message_audio, .tgme_widget_message_audio_player"):
        kinds.append("audio")
    if el.select_one(".tgme_widget_message_document"):
        kinds.append("document")
    if el.select_one(".tgme_widget_message_poll_question"):
        kinds.append("poll")
    if el.select_one(".tgme_widget_message_sticker_wrap, .tgme_widget_message_sticker"):
        kinds.append("sticker")
    if el.select_one(".tgme_widget_message_link_preview"):
        kinds.append("link_preview")
    return kinds


def _extract_thumb_source_url(el: Tag) -> str | None:
    # Order is priority: real message media first, link-preview imagery last, so
    # a post that has both is represented by its own media. Reply thumbs use
    # `i.tgme_widget_message_reply_thumb` and must never match here — they show
    # the *replied-to* post.
    for selector in (
        ".tgme_widget_message_photo_wrap[style*='background-image']",
        ".grouped_media_wrap[style*='background-image']",
        ".tgme_widget_message_video_thumb[style*='background-image']",
        ".link_preview_image[style*='background-image']",
        ".link_preview_right_image[style*='background-image']",
        ".link_preview_video_thumb[style*='background-image']",
    ):
        node = el.select_one(selector)
        if not node:
            continue
        url = _extract_background_url(attr_str(node.get("style")))
        if url and url.startswith("http"):
            return url
    return None


def _parse_duration_seconds(el: Tag) -> int | None:
    # Scoped to the post's own player: an unscoped lookup picks up the duration
    # rendered inside a link preview, which belongs to the linked post.
    player = el.select_one(_VIDEO_PLAYER_SELECTOR)
    dur_el = (
        player.select_one(".message_video_duration, .js-message_video_duration")
        if player
        else None
    )
    if not dur_el:
        return None
    text = dur_el.get_text(strip=True)
    if not text:
        return None
    parts = text.split(":")
    try:
        if len(parts) == 2:
            minutes, seconds = int(parts[0]), int(parts[1])
            return minutes * 60 + seconds
        if len(parts) == 3:
            hours, minutes, seconds = (int(parts[0]), int(parts[1]), int(parts[2]))
            return hours * 3600 + minutes * 60 + seconds
    except ValueError:
        return None
    return None


def _extract_grouped_count(el: Tag) -> int | None:
    grouped = el.select_one(".tgme_widget_message_grouped_wrap")
    if not grouped:
        return None
    wraps = grouped.select(".tgme_widget_message_photo_wrap, .grouped_media_wrap")
    count = len(wraps)
    return count if count > 0 else None


def _extract_link_preview(el: Tag) -> dict[str, str] | None:
    preview = el.select_one(".tgme_widget_message_link_preview")
    if not preview:
        return None
    title_el = preview.select_one(".link_preview_title")
    desc_el = preview.select_one(".link_preview_description")
    site_el = preview.select_one(".link_preview_site_name")
    data: dict[str, str] = {}
    if title_el:
        title = title_el.get_text(strip=True)
        if title:
            data["title"] = title
    if desc_el:
        description = desc_el.get_text(strip=True)
        if description:
            data["description"] = description
    if site_el:
        site_name = site_el.get_text(strip=True)
        if site_name:
            data["siteName"] = site_name
    return data or None


_COUNT_MULTIPLIERS = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}
_COUNT_RE = re.compile(r"^([\d.,]+)\s*([kmb])?$", re.IGNORECASE)


def parse_abbreviated_count(text: str | None) -> int | None:
    """Turn Telegram's abbreviated counter text into an integer.

    Telegram renders view and reaction counts as `"315"`, `"9.74K"`, `"16.4M"`.
    Returns None for anything unrecognised rather than guessing.
    """
    if not text:
        return None
    match = _COUNT_RE.match(text.strip().replace(" ", "").replace(" ", ""))
    if not match:
        return None
    digits, suffix = match.group(1), match.group(2)
    try:
        value = float(digits.replace(",", ""))
    except ValueError:
        return None
    # round, not int: 16.4 * 1_000_000 is 16399999.999... in binary float, and
    # truncating turns "16.4M" into 16,399,999.
    return round(value * _COUNT_MULTIPLIERS.get((suffix or "").lower(), 1))


def _extract_views(el: Tag) -> str | None:
    views_el = el.select_one(".tgme_widget_message_views")
    if not views_el:
        return None
    views = views_el.get_text(strip=True)
    return views if views else None


def _extract_reactions(el: Tag) -> str | None:
    reactions_el = el.select_one(".tgme_widget_message_reactions")
    if not reactions_el:
        return None
    reactions = reactions_el.get_text(" ", strip=True)
    return reactions if reactions else None


def _extract_reaction_counts(el: Tag) -> list[dict[str, Any]] | None:
    """Per-chip reaction counts.

    The flattened `reactions` string is ambiguous: the leading number belongs to
    an emoji-less paid-stars chip, so which count goes with which emoji cannot be
    recovered from it. Read the chips directly instead.
    """
    reactions_el = el.select_one(".tgme_widget_message_reactions")
    if not reactions_el:
        return None

    out: list[dict[str, Any]] = []
    for chip in reactions_el.select(".tgme_reaction"):
        emoji_el = chip.select_one("i.emoji b")
        custom_emoji_el = chip.select_one("tg-emoji[emoji-id]")

        # Strip the glyph markup so what remains is only the count.
        stripped = copy(chip)
        for node in stripped.select("i.emoji, i.icon, tg-emoji"):
            node.decompose()
        count = parse_abbreviated_count(stripped.get_text(strip=True))
        if count is None:
            continue

        entry: dict[str, Any] = {"count": count}
        emoji = emoji_el.get_text(strip=True) if emoji_el else None
        if emoji:
            entry["emoji"] = emoji
        elif custom_emoji_el is not None:
            # A custom (premium) emoji has no character in the markup at all,
            # only its id — without this the chip would be unidentifiable.
            custom_id = attr_str(custom_emoji_el.get("emoji-id"))
            if custom_id:
                entry["customEmojiId"] = custom_id
        raw_classes = chip.get("class")
        classes = raw_classes if isinstance(raw_classes, list) else [raw_classes or ""]
        if "tgme_reaction_paid" in classes:
            entry["isPaid"] = True
        out.append(entry)
    return out or None


def synthesize_media_only_text(kinds: list[str]) -> str:
    """Stand-in text for a media post with no caption.

    `grouped_count` used to be a parameter with a `> 1` fallback at the end, but
    a non-None count implies a grouped wrap, which implies `"grouped" in kinds`
    and returns on the first branch — it was unreachable.
    """
    if "grouped" in kinds:
        return "[photo album]"
    if "video" in kinds and "photo" not in kinds:
        return "[video]"
    if "photo" in kinds:
        return "[photo]"
    if "voice" in kinds:
        return "[voice]"
    if "audio" in kinds:
        return "[audio]"
    if "document" in kinds:
        return "[document]"
    if "poll" in kinds:
        return "[poll]"
    if "sticker" in kinds:
        return "[sticker]"
    if "link_preview" in kinds:
        return "[link]"
    return "[media]"


def _extract_poll_question(el: Tag) -> str | None:
    """The poll question, which stands in for a caption on poll posts.

    This used to be read only on the no-kinds path, which a poll can never take
    — `.tgme_widget_message_poll_question` is exactly what makes `poll` a
    detected kind — so the question was always discarded and the post stored as
    `[poll]`.
    """
    poll_el = el.select_one(".tgme_widget_message_poll_question")
    if poll_el is None:
        return None
    return extract_telegram_html_text(poll_el) or None


def parse_widget_media(
    el: Tag,
    *,
    channel_name: str | None = None,
    post_id: int | None = None,
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Return synthesized text, media dict (camelCase keys), and thumb source URL."""
    kinds = _detect_kinds(el)
    # A poll question is real text content, so it stands in for a missing
    # caption rather than being replaced by a "[poll]" placeholder.
    caption = _extract_caption(el) or _extract_poll_question(el)
    views = _extract_views(el)
    reactions = _extract_reactions(el)
    reaction_counts = _extract_reaction_counts(el)
    reactions_count = (
        sum(item["count"] for item in reaction_counts) if reaction_counts else None
    )
    thumb_source_url = _extract_thumb_source_url(el) if kinds else None

    if not kinds:
        text = caption or _LEGACY_MEDIA_PLACEHOLDER
        if not (views or reactions):
            return text, None, None
        # Engagement counters exist on plain-text posts too, and were previously
        # dropped by this early return. `kinds: []` keeps such a post `text_only`
        # for both filter implementations (they test the length of `kinds`).
        stats = PostMedia.model_validate(
            {
                "kinds": [],
                "caption": caption,
                "views": views,
                "viewsCount": parse_abbreviated_count(views),
                "reactions": reactions,
                "reactionCounts": reaction_counts,
                "reactionsCount": reactions_count,
                "isMediaOnly": False,
            }
        )
        return text, stats.to_storage_dict(), None

    grouped_count = _extract_grouped_count(el)
    duration_sec = _parse_duration_seconds(el)
    link_preview = _extract_link_preview(el)

    is_media_only = not caption
    text = caption if caption else synthesize_media_only_text(kinds)

    media = PostMedia.model_validate(
        {
            "kinds": kinds,
            "caption": caption,
            "durationSec": duration_sec,
            "views": views,
            "viewsCount": parse_abbreviated_count(views),
            "reactions": reactions,
            "reactionCounts": reaction_counts,
            "reactionsCount": reactions_count,
            "linkPreview": link_preview,
            "groupedCount": grouped_count,
            "isMediaOnly": is_media_only,
        }
    )

    if thumb_source_url and channel_name and post_id is not None:
        media.thumb_api_path = post_thumb_api_path(channel_name, post_id)

    return text, media.to_storage_dict(), thumb_source_url


def finalize_post_media_paths(post: dict[str, Any], channel_name: str) -> None:
    """Set thumb API paths after channel name is attached to a scraped post.

    Keeps ``_thumbSourceUrl`` on the post so sync can download the thumb before
    DB upsert strips internal scrape fields.
    """
    thumb_source = post.get("_thumbSourceUrl")
    media = post.get("media")
    if not isinstance(media, dict):
        return
    post_id = post.get("id")
    if thumb_source and isinstance(post_id, int):
        media["thumbApiPath"] = post_thumb_api_path(channel_name, post_id)
    elif not media.get("thumbApiPath"):
        media.pop("thumbApiPath", None)
