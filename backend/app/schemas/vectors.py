"""Response models for the corpus-level vector artefacts.

Part of B6b.

**Multi-user seam:** embeddings and translations are keyed by
`(channel_name, post_id)` and carry no `user_id` — they are properties of a
*post*, not of a reader, and two operators following the same channel should
share them rather than each pay to compute their own. Keep it that way; scope at
read time (`MEMORY.md`).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class PostTranslationResponse(BaseModel):
    """One post translated into one language."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    channel_name: str = Field(alias="channelName")
    post_id: int = Field(alias="postId")
    language: str
    translated_text: str = Field(default="", alias="translatedText")
    timestamp: int = 0


class VectorWriteResponse(BaseModel):
    """How many rows a bulk embedding or translation write accepted."""

    upserted: int = 0
