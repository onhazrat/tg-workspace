"""Assemble the posts block for AI prompts from a scope, server-side.

Replaces the browser round-trip where every post was shipped to the client,
concatenated into one string, and shipped back. The scope (channels + date
range + the Posts-tab filters + per-channel cap + sort) is resolved with the
same ``list_feed`` the Posts feed uses, so a summary reflects exactly what the
feed shows, and formatted by the byte-identical ``format_posts_for_prompt``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from fastapi import HTTPException
from sqlmodel import Session

from app.prompts.posts import (
    MAX_PROMPT_TOKENS,
    estimate_tokens,
    format_posts_for_prompt,
)
from app.services.post_filters import FORWARDED_FILTERS, MEDIA_FILTERS, PostFilters
from app.services.posts import (
    FEED_CAP_MODES,
    FEED_SORTS,
    count_posts_in_scope,
    list_feed,
)

# Upper bound on how many posts one prompt assembles. Bounds the fetch (so a
# huge scope never materialises a giant result) and, like the token cap, is
# surfaced as a clear error rather than a silent truncation.
MAX_PROMPT_POSTS = 5000


@dataclass(frozen=True)
class PromptScope:
    """Everything needed to reproduce the Posts-feed selection for a prompt."""

    channels: list[str]
    start_date: int | None = None
    end_date: int | None = None
    keyword: str | None = None
    forwarded: str = "all"
    media: str = "all"
    max_per_channel: int = 0
    max_per_channel_mode: str = "latest"
    sort: str = "time"
    seed: int = 0


def assemble_posts_text(session: Session, scope: PromptScope) -> str:
    """Fetch + format the scoped posts, refusing an over-budget selection.

    Raises ``413`` with a clear, actionable message (post count or token
    estimate) instead of silently dropping the user's selected posts.
    """
    if scope.forwarded not in FORWARDED_FILTERS:
        raise HTTPException(422, detail=f"unknown forwarded: {scope.forwarded}")
    if scope.media not in MEDIA_FILTERS:
        raise HTTPException(422, detail=f"unknown media: {scope.media}")
    if scope.sort not in FEED_SORTS:
        raise HTTPException(422, detail=f"unknown sort: {scope.sort}")
    if scope.max_per_channel_mode not in FEED_CAP_MODES:
        raise HTTPException(
            422, detail=f"unknown maxPerChannelMode: {scope.max_per_channel_mode}"
        )
    filters = PostFilters(
        keyword=scope.keyword,
        forwarded=cast("Any", scope.forwarded),
        media=cast("Any", scope.media),
    )
    channel_names = scope.channels or None

    counts = count_posts_in_scope(
        session,
        channel_names=channel_names,
        start_date=scope.start_date,
        end_date=scope.end_date,
        filters=filters,
        max_per_channel=scope.max_per_channel,
    )
    total = sum(counts.values())
    if total > MAX_PROMPT_POSTS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"The selection has {total:,} posts, more than the "
                f"{MAX_PROMPT_POSTS:,} a single prompt can assemble. Narrow the "
                "channel selection or date range, or set a per-channel cap."
            ),
        )

    posts = list_feed(
        session,
        channel_names=channel_names,
        start_date=scope.start_date,
        end_date=scope.end_date,
        filters=filters,
        max_per_channel=scope.max_per_channel,
        max_per_channel_mode=scope.max_per_channel_mode,
        sort=scope.sort,
        seed=scope.seed,
        limit=MAX_PROMPT_POSTS,
        offset=0,
    )
    posts_text = format_posts_for_prompt(posts)

    tokens = estimate_tokens(posts_text)
    if tokens > MAX_PROMPT_TOKENS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"The selected posts are ~{tokens:,} tokens, over the "
                f"{MAX_PROMPT_TOKENS:,}-token limit for a single prompt. Narrow "
                "the channel selection or date range, or set a per-channel cap."
            ),
        )
    return posts_text
