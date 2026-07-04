"""Extract PostMedia metadata from Telegram web-view message widgets."""

from __future__ import annotations

import re
from copy import copy
from typing import Any

from bs4 import Tag

from app.schemas.post_media import PostMedia
from app.services.post_thumbnails import post_thumb_api_path

_BACKGROUND_IMAGE_RE = re.compile(r"background-image:\s*url\(['\"]?([^'\"()]+)['\"]?\)")
_LEGACY_MEDIA_PLACEHOLDER = "[Media/No Text Content]"


def _attr_str(value: str | list[str] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _extract_background_url(style: str | None) -> str | None:
    if not style:
        return None
    match = _BACKGROUND_IMAGE_RE.search(style)
    if not match:
        return None
    return match.group(1).strip()


def _extract_caption(el: Tag) -> str | None:
    text_el = el.select_one(".tgme_widget_message_text")
    if not text_el:
        return None
    text_el = copy(text_el)
    for br in text_el.find_all("br"):
        br.replace_with("\n")
    text = text_el.get_text(strip=True)
    return text if text else None


def _detect_kinds(el: Tag) -> list[str]:
    kinds: list[str] = []
    if el.select_one(".tgme_widget_message_grouped_wrap"):
        kinds.append("grouped")
    if el.select_one(
        ".tgme_widget_message_photo_wrap, .js-message_photo, .grouped_media_wrap"
    ):
        if "photo" not in kinds:
            kinds.append("photo")
    if el.select_one(".tgme_widget_message_video_player, .js-message_video_player"):
        kinds.append("video")
    if el.select_one(".tgme_widget_message_voice"):
        kinds.append("voice")
    if el.select_one(".tgme_widget_message_document"):
        kinds.append("document")
    if el.select_one(".tgme_widget_message_poll_question"):
        kinds.append("poll")
    if el.select_one(".tgme_widget_message_link_preview"):
        kinds.append("link_preview")
    return kinds


def _extract_thumb_source_url(el: Tag) -> str | None:
    for selector in (
        ".tgme_widget_message_photo_wrap[style*='background-image']",
        ".grouped_media_wrap[style*='background-image']",
        ".tgme_widget_message_video_thumb[style*='background-image']",
        "i.tgme_widget_message_video_thumb[style*='background-image']",
    ):
        node = el.select_one(selector)
        if not node:
            continue
        url = _extract_background_url(_attr_str(node.get("style")))
        if url and url.startswith("http"):
            return url
    return None


def _parse_duration_seconds(el: Tag) -> int | None:
    dur_el = el.select_one(
        ".message_video_duration, .js-message_video_duration, "
        ".tgme_widget_message_video_duration"
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


def synthesize_media_only_text(
    kinds: list[str], *, grouped_count: int | None = None
) -> str:
    if "grouped" in kinds:
        return "[photo album]"
    if kinds == ["video"]:
        return "[video]"
    if "video" in kinds and "photo" not in kinds:
        return "[video]"
    if "photo" in kinds:
        return "[photo]"
    if "voice" in kinds:
        return "[voice]"
    if "document" in kinds:
        return "[document]"
    if "poll" in kinds:
        return "[poll]"
    if "link_preview" in kinds:
        return "[link]"
    if grouped_count and grouped_count > 1:
        return "[photo album]"
    return "[media]"


def parse_widget_media(
    el: Tag,
    *,
    channel_name: str | None = None,
    post_id: int | None = None,
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Return synthesized text, media dict (camelCase keys), and thumb source URL."""
    kinds = _detect_kinds(el)
    caption = _extract_caption(el)
    thumb_source_url = _extract_thumb_source_url(el) if kinds else None

    if not kinds:
        if caption:
            return caption, None, None
        poll_el = el.select_one(".tgme_widget_message_poll_question")
        if poll_el:
            for br in poll_el.find_all("br"):
                br.replace_with("\n")
            poll_text = poll_el.get_text(strip=True)
            return poll_text or _LEGACY_MEDIA_PLACEHOLDER, None, None
        return _LEGACY_MEDIA_PLACEHOLDER, None, None

    grouped_count = _extract_grouped_count(el)
    duration_sec = _parse_duration_seconds(el)
    link_preview = _extract_link_preview(el)
    views = _extract_views(el)
    reactions = _extract_reactions(el)

    is_media_only = not caption
    text = (
        caption
        if caption
        else synthesize_media_only_text(kinds, grouped_count=grouped_count)
    )

    media = PostMedia.model_validate(
        {
            "kinds": kinds,
            "caption": caption,
            "durationSec": duration_sec,
            "views": views,
            "reactions": reactions,
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
