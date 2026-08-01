"""Response models for tag runs.

Part of B6b. Same light/full projection split as summaries and Discover reports,
and for the same reason: `promptText` holds a full serialized post corpus, so a
history list carrying it re-downloads tens of megabytes of historical prompts.

The split is expressed as two models rather than one optional-field model, so
the list response cannot accidentally acquire the heavy fields as `null`s.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TagRunListItemResponse(BaseModel):
    """A tag run's identity and metadata — the history-list projection.

    Deliberately omits `promptText`, `responseText`, `suggestions` and
    `allTagsSnapshot`. Callers that need those fetch the run by id.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    status: str
    source: str
    mode: str
    channels: list[str] = Field(default_factory=list)
    start_date: int = Field(default=0, alias="startDate")
    end_date: int = Field(default=0, alias="endDate")
    post_count: int = Field(default=0, alias="postCount")
    model: str | None = None
    error: str | None = None
    created_at: int = Field(default=0, alias="createdAt")
    updated_at: int = Field(default=0, alias="updatedAt")


class TagRunResponse(TagRunListItemResponse):
    """A tag run with the corpus-sized fields the list omits.

    The four JSON payloads stay loosely typed: `suggestions` and `applyResult`
    are shaped by the tagging prompt's output contract, which is versioned by the
    prompt rather than by this schema, and pinning them here would make a prompt
    change a schema migration.
    """

    prompt_text: str | None = Field(default=None, alias="promptText")
    response_text: str | None = Field(default=None, alias="responseText")
    all_tags_snapshot: Any = Field(default=None, alias="allTagsSnapshot")
    channel_context_options: Any = Field(default=None, alias="channelContextOptions")
    suggestions: Any = None
    apply_result: Any = Field(default=None, alias="applyResult")
