"""Response models for the post endpoints.

Third family converted under B3 of `docs/architecture-simplification-plan.md`.

Unlike `ChannelResponse` and `SummaryResponse`, `PostResponse` is **closed**:
`post_to_camel` emits exactly seventeen keys and merges nothing conditional, so
there is no open `extra` blob to carry and no reason to allow one. The open
models in this codebase are the exception, not the pattern.

**Why `media` / `links` / `replyTo` stay loose.** All three are JSON columns
with real shapes, and `app/schemas/post_media.py` already models the media one
as `PostMedia`. Declaring `media: PostMedia | None` here would still be wrong:
media is persisted via `PostMedia.to_storage_dict()`, which uses
``exclude_none=True``, so a stored blob omits its empty fields. Round-tripping
it through the declared model on the way out would materialise those as explicit
``null``s and change the payload for every post that has media. FastAPI's
``response_model_exclude_none`` cannot fix this either — it applies to the whole
response, so it would strip legitimate nulls from the top-level fields as well.

The same reasoning that keeps conditional keys undeclared in `SummaryResponse`
applies here one level down: the wire format stays byte-identical, and the
fourteen scalar fields still gain real types.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PostResponse(BaseModel):
    """One post, as `post_to_camel` builds it."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    channel_name: str = Field(alias="channelName")
    text: str = ""
    date: str = ""
    timestamp: int = 0
    forwarded_from: str | None = Field(default=None, alias="forwardedFrom")
    forwarded_from_name: str | None = Field(default=None, alias="forwardedFromName")
    is_anchor: bool = Field(default=False, alias="isAnchor")
    retrieved_at: int | None = Field(default=None, alias="retrievedAt")
    retrieval_job_id: str | None = Field(default=None, alias="retrievalJobId")
    retrieval_pass: str | None = Field(default=None, alias="retrievalPass")
    retrieval_source: str | None = Field(default=None, alias="retrievalSource")
    # Shaped by `app/schemas/post_media.py::PostMedia`, kept loose on purpose —
    # see the module docstring.
    media: dict[str, Any] | None = None
    # Shape: [{"url": str, "channel": str}]
    links: list[Any] | None = None
    reply_to_post_id: int | None = Field(default=None, alias="replyToPostId")
    # Shape: {"channel": str, "authorName": str, "text": str, "url": str}
    reply_to: dict[str, Any] | None = Field(default=None, alias="replyTo")


class BulkUpsertPostsResponse(BaseModel):
    """Result of ``POST /data/posts/bulk``."""

    upserted: int = 0
