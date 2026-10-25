"""Which Posts an Artifact covers, and the prompt block built from them (ADR-038).

A read model. An Artifact freezes its Scope with every Post its Post selection
reached (`freeze`), and every prompt it gets reads those Covered Posts back
(`covered_posts`, `posts_block`), whoever builds it: Generate, Retry, the
scheduler, or a copied prompt. Re-applying the Selection rules to today's
corpus instead would read Posts synced in after the freeze, or a views ranking
that moved since, while the coverage wall still lists the original Posts.

Takes a `FrozenScope` with its refs loaded; each family's aggregate loads its
own row and payload, so this module never names the Artifact tables.

**Which Posts.** With refs on record, those refs, in recorded order, with
fresh text, through the Follow-scoped seam. A ref that does not come back
(retention reclaimed it, or the Account unfollowed its Channel) is a Missing
Post: left out and counted. With no refs (a derived Scope, or one frozen
before PTR-05), every Post in the window under select all, in the Scope's
order, and none is missing.

**The limits.** A prompt assembles every Covered Post, never a page, up to
`MAX_PROMPT_POSTS` and `MAX_PROMPT_TOKENS`. Past either it is a 413, never a
silent truncation.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.models_tg import Post
from app.prompts.posts import (
    MAX_PROMPT_TOKENS,
    estimate_tokens,
    format_posts_for_prompt,
    format_posts_for_tag_prompt,
)
from app.schemas.post_filter import to_steps
from app.schemas.scope import FrozenScope, ScopeSubmission
from app.services.analysis_window import freeze_scope
from app.services.posts_view import (
    count_selected,
    feed,
    resolve_posts_view,
    selected_refs,
)
from app.services.serialization import post_to_camel
from app.services.tenancy import scoped_select

# A generous fetch-safety bound, so a pathological Scope never materialises a
# giant result. The token budget is the real user-facing limit.
MAX_PROMPT_POSTS = 10_000

Layout = Literal["flat", "tag"]


@dataclass(frozen=True)
class Coverage:
    """The Covered Posts a prompt can read, and how many it could not."""

    #: Camel-cased as the wire has them, in the Scope's order.
    posts: list[dict[str, Any]]
    #: Missing Posts: refs on record that did not come back.
    missing: int

    @property
    def refs(self) -> list[tuple[str, int]]:
        return [(p["channelName"], p["id"]) for p in self.posts]


def freeze(
    session: Session,
    submission: ScopeSubmission,
    *,
    user_id: uuid.UUID,
    now_ms: int | None = None,
) -> FrozenScope:
    """Freeze a submitted Scope with every Post its selection reached.

    The door every Action submits through (PTR-05). The window is frozen
    first, by `freeze_scope`, and the selection is applied over it once, so
    the refs an Artifact keeps are the Posts it covered at that minute.
    """
    frozen = freeze_scope(submission, now_ms=now_ms)
    view = resolve_posts_view(
        session,
        user_id=user_id,
        channel_names=frozen.channels or None,
        start=frozen.start,
        end=frozen.end,
        view_measure=frozen.view_measure,
        sort=frozen.sort,
        steps=to_steps(submission.selection),
    )
    refs = selected_refs(session, view, group_by_channel=frozen.group_by_channel)
    # ponytail: every reference in one JSON column, unbounded as ADR-026 says;
    # a window of a million Posts stores a million refs. Bound it, or store a
    # table of refs, if a deployment ever summarizes windows that size.
    return FrozenScope.model_validate(
        {
            **frozen.stored(),
            "posts": [{"channelName": c, "postId": p} for c, p in refs],
        }
    )


def _too_many(total: int) -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=(
            f"The selection has {total:,} posts, more than the "
            f"{MAX_PROMPT_POSTS:,} a single prompt can assemble. Narrow the "
            "channel selection or date range, or deselect some Posts."
        ),
    )


def _window_posts(
    session: Session, scope: FrozenScope, *, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    view = resolve_posts_view(
        session,
        user_id=user_id,
        channel_names=list(scope.channels) or None,
        start=scope.start,
        end=scope.end,
        view_measure=scope.view_measure,
        sort=scope.sort,
    )
    total = sum(count_selected(session, view).values())
    if total > MAX_PROMPT_POSTS:
        raise _too_many(total)
    return feed(
        session,
        view,
        limit=MAX_PROMPT_POSTS,
        group_by_channel=scope.group_by_channel,
        only_selected=True,
    )


def covered_posts(
    session: Session, scope: FrozenScope, *, user_id: uuid.UUID
) -> Coverage:
    """The Covered Posts `user_id` can read, in order, and how many are missing.

    `scope` must carry its refs: a `scopedPostCount` with no `posts` is a
    list projection, and reading its window instead would cover the wrong
    Posts. 413 past `MAX_PROMPT_POSTS`.
    """
    if scope.scoped_post_count is None:
        return Coverage(_window_posts(session, scope, user_id=user_id), missing=0)
    if scope.posts is None and scope.scoped_post_count:
        raise ValueError("covered_posts needs the Scope's refs loaded")
    refs = [(r.channel_name, r.post_id) for r in scope.posts or []]
    if len(refs) > MAX_PROMPT_POSTS:
        raise _too_many(len(refs))
    if not refs:
        return Coverage([], missing=0)
    stmt = scoped_select(select(Post), Post, user_id).where(
        tuple_(col(Post.channel_name), col(Post.post_id)).in_(refs)
    )
    found = {(p.channel_name, p.post_id): p for p in session.exec(stmt).all()}
    posts = [post_to_camel(found[ref]) for ref in dict.fromkeys(refs) if ref in found]
    return Coverage(posts, missing=len(set(refs)) - len(found))


def posts_block(
    session: Session,
    scope: FrozenScope,
    *,
    user_id: uuid.UUID,
    layout: Layout = "flat",
) -> tuple[str, Coverage]:
    """The prompt's posts block: flat (Summary, Chat) or by Channel (Tag run).

    413 past `MAX_PROMPT_POSTS` or `MAX_PROMPT_TOKENS`.
    """
    coverage = covered_posts(session, scope, user_id=user_id)
    text = (
        format_posts_for_tag_prompt(coverage.posts, list(scope.channels))
        if layout == "tag"
        else format_posts_for_prompt(coverage.posts)
    )
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
    return text, coverage
