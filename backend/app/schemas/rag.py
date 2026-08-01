"""Response models for the RAG (embedding + semantic search) endpoints.

Part of B6 in `docs/architecture-simplification-plan.md`. All three are closed —
every branch of every service function here returns the same key set.

`RagSearchHit.post` reuses `PostResponse` rather than redeclaring the post
shape: the route builds it with `post_to_camel`, the same serialiser
`PostResponse` was written against in B3, so the two cannot drift. This is the
first place a B-unit model is composed out of another family's.

**Multi-user seam:** embeddings are a corpus-level artefact shared across users
(`MEMORY.md`), so nothing here carries a `user_id`. Operator scoping happens at
read time in the route, by restricting which channels are searched — deliberately
not baked into these shapes.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.posts import PostResponse


class RagStatusResponse(BaseModel):
    """How much of the operator's corpus has been embedded.

    `total` counts non-anchor posts only: anchors are pagination markers, not
    content, so embedding them would make the denominator meaningless.
    """

    model_config = ConfigDict(populate_by_name=True)

    pending: int = 0
    total: int = 0
    last_run: int | None = Field(default=None, alias="lastRun")


class RagEmbedResponse(BaseModel):
    """Result of one backfill pass.

    `pending` is recomputed after the write rather than derived, so a caller can
    drive a progress bar from consecutive calls without tracking totals itself.
    """

    processed: int = 0
    upserted: int = 0
    pending: int = 0


class RagSearchHit(BaseModel):
    """One semantic match.

    `text` is the embedded text, kept separate from `post`: the post row may
    have been pruned by retention since the embedding was written, in which case
    `post` is null but the matched text still renders.
    """

    model_config = ConfigDict(populate_by_name=True)

    score: float
    channel_name: str = Field(alias="channelName")
    post_id: int = Field(alias="postId")
    text: str = ""
    post: PostResponse | None = None


class RagSearchResponse(BaseModel):
    """Ranked matches for a query vector, best first.

    `truncated` and `scanned` describe the *scan*, not the results: similarity
    is computed in Python over a capped window, so a thin result set and a
    capped scan are different failures and callers must be able to tell them
    apart. (pgvector is the real fix — see `docs/ideas-log`.)
    """

    results: list[RagSearchHit] = Field(default_factory=list)
    truncated: bool = False
    scanned: int = 0
