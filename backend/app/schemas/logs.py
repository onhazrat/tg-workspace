"""Response models for the five log resources.

Fifth family converted under B5 of `docs/architecture-simplification-plan.md`.

Every log serialiser is `{"id": row.id, **model_to_camel(row)}`, and
`model_to_camel` skips exactly `id`, `user_id` and `updated_at` before
camelising whatever columns remain. The wire shape of a log is therefore *the
table*, which is why these models can be closed and exhaustive: adding a column
to a log table changes the payload, and now it will also fail a test rather than
silently widening an untyped `dict`.

The five tables genuinely differ — a publish log records a destination, a
network log records a proxy — so this module declares five models rather than
one. **Workstream D genericises the handling, not the storage**, and the
`log_type → schema` registry it needs is exactly the mapping at the bottom of
this file.

`SyncLogResponse` is the one that is not purely its own table: the request and
response bodies moved to `tg_sync_log_payloads`, and `sync_log_to_camel` folds
them back in so the wire shape did not change. They are declared here as always
present and nullable, because the payload row can be truncated at any time to
reclaim disk and the log must still list with null bodies.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

#: JSON captured verbatim from an upstream request or response. Left loose on
#: purpose: it is whatever the provider sent, which is not ours to model.
type LogPayload = dict[str, Any] | list[Any] | None


class PublishLogResponse(BaseModel):
    """One attempt to publish a summary to a Telegram chat."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    summary_id: str = Field(alias="summaryId")
    bot_id: str = Field(alias="botId")
    bot_name: str = Field(alias="botName")
    chat_id: str = Field(alias="chatId")
    chat_name: str = Field(alias="chatName")
    status: str
    error: str | None = None
    timestamp: int = 0
    full_request: LogPayload = Field(default=None, alias="fullRequest")
    full_response: LogPayload = Field(default=None, alias="fullResponse")
    text_sent: str | None = Field(default=None, alias="textSent")


class SyncLogResponse(BaseModel):
    """One channel sync attempt, with its payload row folded back in.

    `fullRequest` / `fullResponse` live in `tg_sync_log_payloads` and are joined
    on an OUTER join: that table is truncatable, so a log whose payload has been
    reclaimed still lists and simply reports nulls.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    channel_name: str = Field(alias="channelName")
    status: str
    posts_count: int = Field(default=0, alias="postsCount")
    new_latest_id: int | None = Field(default=None, alias="newLatestId")
    error: str | None = None
    timestamp: int = 0
    source: str = "manual"
    full_request: LogPayload = Field(default=None, alias="fullRequest")
    full_response: LogPayload = Field(default=None, alias="fullResponse")


class LLMLogResponse(BaseModel):
    """One model call: the prompt, the response, and what it cost.

    `protected_namespaces=()` is required, not decorative. Pydantic v2 reserves
    the `model_` prefix for its own API, and this table has both a `model` column
    and a `model_config_json` one — the latter collides with `BaseModel.model_config`
    itself. Without the override, declaring these fields raises at class-creation
    time. Renaming the columns is not an option: they are the wire format.
    """

    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    id: str
    model: str
    prompt: str
    response: str
    system_instruction: str | None = Field(default=None, alias="systemInstruction")
    #: Wire key is `modelConfig`, **not** `modelConfigJson` — `_CAMEL_OVERRIDES`
    #: in `services/serialization.py` maps this column explicitly. See the module
    #: docstring: the override table, not `to_camel`, is what defines these names.
    model_config_json: dict[str, Any] | None = Field(default=None, alias="modelConfig")
    full_request: LogPayload = Field(default=None, alias="fullRequest")
    full_response: LogPayload = Field(default=None, alias="fullResponse")
    tokens: int | None = None
    duration: float | None = None
    status: str
    error: str | None = None
    timestamp: int = 0
    #: Which call site produced this — `summary`, `chat`, `tagging`, and so on.
    #: Wire key is the bare `type`, another explicit override. Unrelated to the
    #: five log *resources* despite the name.
    log_type: str = Field(default="", alias="type")


class EmbeddingLogResponse(BaseModel):
    """One embedding batch."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    text_count: int = Field(default=0, alias="textCount")
    tokens_estimated: int | None = Field(default=None, alias="tokensEstimated")
    duration: float = 0.0
    status: str
    error: str | None = None
    timestamp: int = 0


class NetworkLogResponse(BaseModel):
    """One outbound HTTP fetch, including which proxy lane carried it."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    url: str
    method: str
    status: str
    status_code: int | None = Field(default=None, alias="statusCode")
    error: str | None = None
    duration: float = 0.0
    timestamp: int = 0
    source: str = ""
    proxy_used: str | None = Field(default=None, alias="proxyUsed")
    attempts: int | None = None
    #: Per-attempt timing/retry detail. Shape varies by source; deliberately loose.
    telemetry: dict[str, Any] | None = None


class LogWriteResponse(BaseModel):
    """Result of a bulk log write: how many rows were accepted."""

    upserted: int = 0


class PurgeLogsResponse(BaseModel):
    """Result of `DELETE /data/logs`.

    Three call shapes share one response. A retention sweep (`olderThanDays`)
    deletes across every table and reports the per-type breakdown plus a
    `total`; deleting one entry or clearing one type reports a bare `deleted`
    count and no breakdown. `deleted` is therefore declared loose — it is an
    `int` in two of the three cases and a `dict[str, int]` in the third — and
    `total` is genuinely absent rather than null for the other two, so it stays
    undeclared and travels through `extra`.
    """

    model_config = ConfigDict(extra="allow")

    deleted: dict[str, int] | int = 0


# --- list projections -------------------------------------------------------
#
# `GET /data/logs/sync` returned 56.28 MB for one page of 500 rows, 99.7% of it
# request/response bodies, none of which the viewer renders until a row is
# expanded. The list dropped them; `GET /data/logs/{type}/{id}` returns the row
# in full for the one row that was opened.
#
# These are separate models rather than the full ones with the heavy fields made
# optional. A declared-but-absent field serialises as an explicit `null`, which
# would claim every log has no body — the wire-format trap this repo documents
# in `app/schemas/summaries.py`. Undeclared means absent.
#
# Embedding and network have no list model: neither has a heavy column, so their
# list and detail shapes are the same object.


class PublishLogListItemResponse(BaseModel):
    """A publish log without `fullRequest` / `fullResponse` / `textSent`."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    summary_id: str = Field(alias="summaryId")
    bot_id: str = Field(alias="botId")
    bot_name: str = Field(alias="botName")
    chat_id: str = Field(alias="chatId")
    chat_name: str = Field(alias="chatName")
    status: str
    error: str | None = None
    timestamp: int = 0


class SyncLogListItemResponse(BaseModel):
    """A sync log without its bodies — the list no longer joins the payload table."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    channel_name: str = Field(alias="channelName")
    status: str
    posts_count: int = Field(default=0, alias="postsCount")
    new_latest_id: int | None = Field(default=None, alias="newLatestId")
    error: str | None = None
    timestamp: int = 0
    source: str = "manual"


class LLMLogListItemResponse(BaseModel):
    """An LLM log without the prompt, the response, or the raw bodies.

    `modelConfig` stays: it is `{"temperature": 0.7}`, and dropping it would be
    churn rather than a saving.
    """

    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    id: str
    model: str
    model_config_json: dict[str, Any] | None = Field(default=None, alias="modelConfig")
    tokens: int | None = None
    duration: float | None = None
    status: str
    error: str | None = None
    timestamp: int = 0
    log_type: str = Field(default="", alias="type")


#: The wire type of `GET /data/logs/{log_type}`.
#:
#: A plain union, not a discriminated one: the five payloads share no tag field,
#: and adding one would change the wire format of all five to serve the type
#: system. The route already knows `log_type` from the path, so it validates
#: with the exact model and the union only describes the result — which is also
#: how the generated TypeScript reads it.
type LogEntryResponse = (
    PublishLogListItemResponse
    | SyncLogListItemResponse
    | LLMLogListItemResponse
    | EmbeddingLogResponse
    | NetworkLogResponse
)


#: The wire type of `GET /data/logs/{log_type}/{log_id}` — the same five kinds
#: in full, bodies included.
type LogDetailResponse = (
    PublishLogResponse
    | SyncLogResponse
    | LLMLogResponse
    | EmbeddingLogResponse
    | NetworkLogResponse
)


#: `log_type` → response model, the mirror of `services.logs.LOG_MODELS`.
#: Workstream D1 uses exactly this to serve every log type from one pair of
#: endpoints; it is declared here so the two registries stay adjacent to the
#: shapes they describe.
LOG_SCHEMAS: dict[str, type[BaseModel]] = {
    "publish": PublishLogResponse,
    "sync": SyncLogResponse,
    "llm": LLMLogResponse,
    "embedding": EmbeddingLogResponse,
    "network": NetworkLogResponse,
}

#: `log_type` -> the model a *list* page validates against. Embedding and
#: network reuse their detail model because they have nothing heavy to drop;
#: `services.logs.LOG_HEAVY_COLUMNS` is the same statement on the query side,
#: and `tests/api/test_generic_logs.py` pins the two against each other.
LOG_LIST_SCHEMAS: dict[str, type[BaseModel]] = {
    "publish": PublishLogListItemResponse,
    "sync": SyncLogListItemResponse,
    "llm": LLMLogListItemResponse,
    "embedding": EmbeddingLogResponse,
    "network": NetworkLogResponse,
}
