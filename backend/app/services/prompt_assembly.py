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
    format_posts_for_tag_prompt,
)
from app.services.post_filters import FORWARDED_FILTERS, MEDIA_FILTERS, PostFilters
from app.services.posts import (
    FEED_CAP_MODES,
    FEED_SORTS,
    count_posts_in_scope,
    list_feed,
)

# Upper bound on how many posts one prompt assembles. The token budget is the
# real user-facing limit; this is a generous fetch-safety bound so a pathological
# scope never materialises a giant result. Like the token cap, exceeding it is a
# clear error, never a silent truncation. The AI paths assemble *all* posts in
# scope (not a page) up to these limits — pagination is display-only.
MAX_PROMPT_POSTS = 10_000


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


def _fetch_scoped_posts(session: Session, scope: PromptScope) -> list[dict[str, Any]]:
    """All posts in scope (not a page), refusing a selection past the post cap.

    The AI paths summarise/tag *every* matching post, so this deliberately does
    not paginate — it fetches up to ``MAX_PROMPT_POSTS`` and refuses anything
    larger with a clear ``413`` rather than silently truncating.
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

    return list_feed(
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


def _enforce_token_budget(text: str) -> str:
    tokens = estimate_tokens(text)
    if tokens > MAX_PROMPT_TOKENS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"The selected posts are ~{tokens:,} tokens, over the "
                f"{MAX_PROMPT_TOKENS:,}-token limit for a single prompt. Narrow "
                "the channel selection or date range, or set a per-channel cap."
            ),
        )
    return text


def assemble_posts_text(session: Session, scope: PromptScope) -> str:
    """Summary/chat posts block for a scope — all matching posts, budget-checked."""
    return _enforce_token_budget(
        format_posts_for_prompt(_fetch_scoped_posts(session, scope))
    )


def assemble_tag_posts_text(session: Session, scope: PromptScope) -> str:
    """Tag posts block (channel-grouped, chronological) for a scope."""
    posts = _fetch_scoped_posts(session, scope)
    return _enforce_token_budget(format_posts_for_tag_prompt(posts, scope.channels))
