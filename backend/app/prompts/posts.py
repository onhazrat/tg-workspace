"""Server-side assembly of the posts block for AI prompts.

Byte-identical to the frontend `formatPostsForPrompt` / `formatPostMediaHints`
(``frontend/src/lib/posts/post-view.ts`` + ``post-media.ts``) so that moving
prompt assembly server-side does not change summary / chat / tag output. Any
change here must be mirrored there, and vice-versa; the parity is covered by
``tests/prompts/test_posts_prompt.py`` against the frontend golden fixture.
"""

from __future__ import annotations

from typing import Any

# A single prompt is capped so an oversized selection is refused with a clear
# error rather than silently truncated (the user's explicit choice) or sent on
# to blow past a model's context window. ~200k tokens is the context limit of
# many models; tokens are estimated at ~4 chars each.
MAX_PROMPT_TOKENS = 200_000
_CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    """Rough token estimate (~4 chars/token). A guardrail, not billing-grade."""
    return len(text) // _CHARS_PER_TOKEN


def _format_duration_label(duration_sec: int) -> str:
    minutes = duration_sec // 60
    seconds = duration_sec % 60
    if minutes <= 0:
        return f"0:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _format_media_hints(post: dict[str, Any]) -> str:
    media = post.get("media")
    if not isinstance(media, dict):
        return ""
    kinds = media.get("kinds")
    if not kinds:
        return ""

    parts = [f"Media: {', '.join(kinds)}"]

    duration = media.get("durationSec")
    if duration is not None and duration > 0:
        parts.append(f"Duration: {_format_duration_label(duration)}")
    views = media.get("views")
    if views:
        parts.append(f"Views: {views}")
    grouped = media.get("groupedCount")
    if grouped is not None and grouped > 1:
        parts.append(f"Album: {grouped} items")

    preview = media.get("linkPreview")
    if isinstance(preview, dict):
        preview_text = " — ".join(
            value
            for value in (preview.get("title"), preview.get("description"))
            if value
        )
        if preview_text:
            site_name = preview.get("siteName")
            site_suffix = f" ({site_name})" if site_name else ""
            parts.append(f"Link preview: {preview_text}{site_suffix}")

    return " | ".join(parts)


def format_posts_for_prompt(posts: list[dict[str, Any]]) -> str:
    """Concatenate posts into the prompt block, byte-identical to the frontend.

    Posts are camelCase dicts as returned by ``post_to_camel`` (the same shape
    the frontend `Post` had), so ``id`` / ``date`` / ``text`` / ``media`` match
    what the browser previously formatted.
    """
    blocks: list[str] = []
    for post in posts:
        hints = _format_media_hints(post)
        lines = [
            f"[{post['channelName']}] ID: {post['id']}",
            f"Date: {post['date']}",
        ]
        if hints:
            lines.append(hints)
        lines.append(f"Content: {post['text']}")
        blocks.append("\n".join(lines))
    return "\n\n---\n\n".join(blocks)
