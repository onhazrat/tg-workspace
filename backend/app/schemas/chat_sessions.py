"""Response models for chat sessions.

Same light/full projection split as summaries, tag runs and Discover reports,
and for the same reason: a transcript is corpus-sized, so a history list
carrying it re-downloads every conversation ever held.

Inheritance runs light -> full, following `tag_runs.py`: the smaller model is
the base and the larger one only ever *adds*. (`summaries.py` runs the other way
round only because its list projection adds `chatMessageCount` to the full one,
which is an artefact of `extra` rather than a convention.)
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.scope import FrozenScope, ScopeSubmission


class ChatSessionListItemResponse(BaseModel):
    """A chat session's identity and metadata — the history-list projection.

    Deliberately omits `messages`. Callers that need the transcript fetch the
    session by id.

    Open (`extra="allow"`) because `ChatSession.extra` is: `isStarred`, `note`,
    `postSearch` and the `semanticSearch*` flags come and go per row exactly as
    they do on `Summary`. Declaring them would emit four-plus explicit `null`s
    on every row. The consequence is that chat-session calls belong in the
    hand-written frontend client, same side as summaries — see ADR-006 and
    `frontend/src/api/client-split.conform.ts`.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    title: str = ""
    channels: list[str] = Field(default_factory=list)
    start_date: int = Field(default=0, alias="startDate")
    end_date: int = Field(default=0, alias="endDate")
    language: str = "English"
    model: str | None = None
    mode: Literal["full_scope", "semantic"] = "full_scope"
    post_count: int | None = Field(default=None, alias="postCount")
    timestamp: int = 0
    message_count: int = Field(default=0, alias="messageCount")
    #: The Scope this chat was frozen at (AW-06), or `null` on a row that
    #: predates the contract — which AW-07 deletes rather than backfills.
    #: Declared, unlike the conditional keys this model leaves to `extra`,
    #: because the client has to render it and `FrozenScope | undefined` is the
    #: type that says so.
    scope: FrozenScope | None = None


class ChatSessionResponse(ChatSessionListItemResponse):
    """A chat session with the transcript the list omits.

    `messages` is always present — `[]` rather than absent when there is no
    payload row. See `chat_session_to_camel` for why this format differs from
    the summary one on that point.

    The turns stay loosely typed: `sources` carries whole posts whose shape is
    the scraper's, and pinning it here would make a scraper change a schema
    migration.
    """

    messages: list[Any] = Field(default_factory=list)


class ChatSessionSubmitRequest(BaseModel):
    """Body for `POST /data/chat-sessions` — opens a chat at a frozen Scope."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    #: Client-chosen, for the reason `SummarySubmitRequest.id` gives: it is the
    #: whole primary key of `tg_chat_sessions`, so it is a UUID and a collision
    #: is a 409 rather than a silent merge into somebody else's row.
    id: str
    scope: ScopeSubmission
    language: str = "English"
    model: str | None = None
    mode: Literal["full_scope", "semantic"] = "full_scope"
    post_count: int | None = Field(default=None, alias="postCount")
    #: The small UI flags a new chat starts with (`postSearch`,
    #: `semanticSearchQuery`, …). Open for the same reason
    #: `ChatSessionListItemResponse` is.
    extra: dict[str, Any] = Field(default_factory=dict)


class ChatSessionUpsertRequest(BaseModel):
    """Body for `PUT /data/chat-sessions/{id}`.

    Permissive like the summary one: unrecognised keys go to `extra`, an
    explicit null removes an `extra` key, and `messages` routes to the payload
    table. `title` and `messageCount` are derived on write and stripped, so a
    client round-tripping a list item cannot shadow them.

    It cannot move the Scope (AW-06). `channels`, `startDate`, `endDate` and
    `scope` are dropped by `upsert_chat_session`, which matters more here than
    it does for a Summary: a chat PUTs its whole session back on every turn, so
    a settable window meant a conversation held across a Live boundary recorded
    whichever slice its final message landed in.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    def to_service_body(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_unset=True)
