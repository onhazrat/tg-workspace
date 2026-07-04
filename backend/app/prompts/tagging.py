from __future__ import annotations

from app.prompts.templates import TAG_PROMPT

TagMode = str

_TAG_MODE_GUIDANCE: dict[str, str] = {
    "add": (
        "Suggest tags to add. Assign missing taxonomy tags that best match each channel's "
        "recent organic content. Do not remove existing tags."
    ),
    "remove": (
        "Suggest tags to remove. Identify current tags that appear incorrect, outdated, or "
        "unsupported by the provided posts."
    ),
}

_TAG_COUNT_DEFAULTS: dict[str, tuple[int, int]] = {
    "add": (2, 4),
    "remove": (0, 3),
}


def normalize_tag_mode(raw_mode: str | None) -> TagMode:
    if raw_mode == "remove":
        return "remove"
    return "add"


def default_tag_limits(tag_mode: TagMode) -> tuple[int, int]:
    return _TAG_COUNT_DEFAULTS.get(tag_mode, _TAG_COUNT_DEFAULTS["add"])


def format_tag_prompt(
    *,
    channels: list[str],
    channels_text: str | None,
    posts_text: str,
    all_tags: str,
    tag_mode: str,
    tags_per_channel_min: int | None = None,
    tags_per_channel_max: int | None = None,
) -> str:
    normalized_mode = normalize_tag_mode(tag_mode)
    default_min, default_max = default_tag_limits(normalized_mode)
    min_tags = (
        default_min if tags_per_channel_min is None else max(0, tags_per_channel_min)
    )
    max_tags = (
        default_max if tags_per_channel_max is None else max(0, tags_per_channel_max)
    )
    if max_tags < min_tags:
        min_tags, max_tags = max_tags, min_tags

    rendered_channels = (channels_text or "").strip() or ", ".join(channels)
    return TAG_PROMPT.format(
        tag_mode_guidance=_TAG_MODE_GUIDANCE[normalized_mode],
        all_tags=all_tags.strip() or "(none yet)",
        tags_per_channel_min=min_tags,
        tags_per_channel_max=max_tags,
        channels=rendered_channels,
        posts_text=posts_text,
    )
