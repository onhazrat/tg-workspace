"""Assemble the posts block for AI prompts from a scope, server-side.

Replaces the browser round-trip where every post was shipped to the client,
concatenated into one string, and shipped back. The scope (channels + date
range + the Post selection + order) is resolved with the same ``list_feed``
the Posts feed uses, so a summary reads exactly the Posts the feed marks as
selected, and formatted by the byte-identical ``format_posts_for_prompt``.
"""

from __future__ import annotations

import uuid
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
from app.services.post_filters import FEED_SORTS, VIEW_MEASURES, PostFilters, Step
from app.services.post_selection import PostScope, selection_clause
from app.services.posts import count_selected, list_feed
from app.services.settling_curve import view_reading

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
    #: The Post selection (PTR-05); `None` is select all. The Post filter is
    #: not here: it decides what the Posts tab shows, never what a prompt
    #: reads (ADR-026).
    steps: tuple[Step, ...] | None = None
    #: What the views orders read (PFB-03).
    view_measure: str = "estimated"
    sort: str = "newest"
    group_by_channel: bool = False


def _fetch_scoped_posts(
    session: Session, scope: PromptScope, *, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """All posts in scope (not a page), refusing a selection past the post cap.

    The AI paths summarise/tag *every* matching post, so this deliberately does
    not paginate — it fetches up to ``MAX_PROMPT_POSTS`` and refuses anything
    larger with a clear ``413`` rather than silently truncating.

    ``user_id`` reaches both reads below, and the same one has to reach both:
    the count decides whether the selection is refused, the feed assembles what
    survives, and a count over a wider scope than the feed would 413 a
    selection that would have fit.
    """
    if scope.sort not in FEED_SORTS:
        raise HTTPException(422, detail=f"unknown sort: {scope.sort}")
    if scope.view_measure not in VIEW_MEASURES:
        raise HTTPException(422, detail=f"unknown viewMeasure: {scope.view_measure}")
    filters = PostFilters(
        reading=view_reading(session, cast("Any", scope.view_measure), sort=scope.sort),
    )
    channel_names = scope.channels or None
    selected = selection_clause(
        session,
        scope.steps,
        PostScope(user_id, channel_names, scope.start_date, scope.end_date),
    )

    counts = count_selected(
        session,
        selected,
        user_id=user_id,
        channel_names=channel_names,
        start_date=scope.start_date,
        end_date=scope.end_date,
    )
    total = sum(counts.values())
    if total > MAX_PROMPT_POSTS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"The selection has {total:,} posts, more than the "
                f"{MAX_PROMPT_POSTS:,} a single prompt can assemble. Narrow the "
                "channel selection or date range, or deselect some Posts."
            ),
        )

    return list_feed(
        session,
        user_id=user_id,
        channel_names=channel_names,
        start_date=scope.start_date,
        end_date=scope.end_date,
        filters=filters,
        sort=cast("Any", scope.sort),
        group_by_channel=scope.group_by_channel,
        limit=MAX_PROMPT_POSTS,
        offset=0,
        selected=selected,
        only_selected=True,
    )


def _enforce_token_budget(text: str) -> str:
    tokens = estimate_tokens(text)
    if tokens > MAX_PROMPT_TOKENS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"The selected posts are ~{tokens:,} tokens, over the "
                f"{MAX_PROMPT_TOKENS:,}-token limit for a single prompt. Narrow "
                "the channel selection or date range, or deselect some Posts."
            ),
        )
    return text


def assemble_posts_text(
    session: Session, scope: PromptScope, *, user_id: uuid.UUID
) -> str:
    """Summary/chat posts block for a scope — all matching posts, budget-checked."""
    return _enforce_token_budget(
        format_posts_for_prompt(_fetch_scoped_posts(session, scope, user_id=user_id))
    )


def assemble_tag_posts_text(
    session: Session, scope: PromptScope, *, user_id: uuid.UUID
) -> str:
    """Tag posts block (channel-grouped, chronological) for a scope."""
    posts = _fetch_scoped_posts(session, scope, user_id=user_id)
    return _enforce_token_budget(format_posts_for_tag_prompt(posts, scope.channels))
