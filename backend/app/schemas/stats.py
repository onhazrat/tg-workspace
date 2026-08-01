"""Response models for the database statistics endpoints.

Shipped with B5 of `docs/architecture-simplification-plan.md`, alongside the log
models — the two families are read by the same admin surface and both count the
same tables.

`DbStatsResponse` is closed and exhaustive. It is one of the payloads where an
untyped `dict` was actively misleading: every value is a count, so the generated
type was `Record<string, unknown>` for an object whose eleven keys are fixed and
whose values are all `number`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DbStatsResponse(BaseModel):
    """Row counts across the corpus, scoped to the operator.

    `embeddedPostCount` is deliberately **not** operator-scoped: embeddings are a
    corpus-level artefact shared across users (see the multi-user seam note in
    the plan), so it counts the whole table while the rest count the operator's
    rows.
    """

    model_config = ConfigDict(populate_by_name=True)

    post_count: int = Field(default=0, alias="postCount")
    channel_count: int = Field(default=0, alias="channelCount")
    summary_count: int = Field(default=0, alias="summaryCount")
    embedded_post_count: int = Field(default=0, alias="embeddedPostCount")
    bot_count: int = Field(default=0, alias="botCount")
    destination_count: int = Field(default=0, alias="destinationCount")
    publish_log_count: int = Field(default=0, alias="publishLogCount")
    sync_log_count: int = Field(default=0, alias="syncLogCount")
    llm_log_count: int = Field(default=0, alias="llmLogCount")
    embedding_log_count: int = Field(default=0, alias="embeddingLogCount")
    network_log_count: int = Field(default=0, alias="networkLogCount")


class TableSizeResponse(BaseModel):
    """Row count and on-disk footprint for one exportable table.

    `size` is the whole physical footprint (heap + TOAST + indexes) straight from
    Postgres, not an estimate: JSON payload columns can dwarf what the row count
    alone suggests.
    """

    name: str
    count: int = 0
    size: int = 0


class ClearTableResponse(BaseModel):
    """How many rows `DELETE /data/tables/{name}` removed."""

    deleted: int = 0
