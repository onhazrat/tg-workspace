from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.schemas.analysis_window import AnalysisWindowInput
from app.schemas.post_filter import PostSelection, legacy_selection, select_all
from app.schemas.scope import (
    SortOrder,
    ViewMeasure,
    upgrade_legacy_scope_fields,
)


class ChatMessage(BaseModel):
    role: str
    text: str


class PromptScopeInput(BaseModel):
    """A Posts-feed scope the backend resolves into the prompt's posts block,
    instead of the client shipping a pre-built ``postsText``. Mirrors the
    frontend feed query params."""

    # AW-02: stated, not computed by the browser. See `PostScopeRequest`.
    window: AnalysisWindowInput | None = None
    # PTR-05 (ADR-026): the prompt reads the Post selection, in the order
    # below, spelled as `ScopeSubmission` spells it so a value it refuses is
    # refused here too rather than 200ing a prompt over a Scope nobody can
    # record. The keyword and the cap are part of a Selection rule's filter.
    selection: PostSelection = Field(default_factory=select_all)
    view_measure: ViewMeasure = Field("estimated", alias="viewMeasure")
    sort: SortOrder = "newest"
    group_by_channel: bool = Field(False, alias="groupByChannel")

    # The previous bundle's spelling, keyword and cap, for one release: see
    # `PostScopeRequest` and `legacy_selection`.
    @model_validator(mode="before")
    @classmethod
    def _upgrade_legacy_shape(cls, data: Any) -> Any:
        upgraded = upgrade_legacy_scope_fields(data)
        return legacy_selection(upgraded) if isinstance(upgraded, dict) else upgraded

    # `extra="forbid"`: see `PostScopeRequest`. The blast radius is largest
    # here. A stale client posting the pre-AW-02 pair would resolve to an
    # unbounded window, and this path has no `limit` to bound it — it would
    # assemble a prompt from every Post the account can see and bill it to the
    # caller's own AI Key.
    model_config = {"populate_by_name": True, "extra": "forbid"}


class ModelInfo(BaseModel):
    id: str
    label: str
    provider: str


# A body rather than a query parameter, and a POST rather than a GET, because
# this endpoint stopped being a read: it makes an authenticated outbound call on
# an Account's behalf. `api/deps.py` states the bar for the View-as read-only
# allowlist as "reads a row, writes none, reaches no external service, spends no
# Budget", and refuses `POST /rag/search` on precisely that third clause. This
# route is refused for the same reason, by not appearing there.
#
# In a comment rather than a docstring: a model docstring becomes the schema
# description in `openapi.json` and a JSDoc block in the generated client, so
# internal paths and ticket numbers would ship to every consumer of the SDK.
class ModelListRequest(BaseModel):
    """Which AI key's provider to ask for a model list."""

    #: Which of the caller's AI Keys to ask. `null` means "the one I have".
    #:
    #: **Client-supplied and untrusted.** It is checked against the caller
    #: before the secret is decrypted; a foreign id answers as an absent one.
    ai_key_id: str | None = Field(default=None, alias="aiKeyId")

    model_config = {"populate_by_name": True}


class CompletionResult(BaseModel):
    text: str
    prompt: str
    model: str
    provider: str


class EmbeddingResult(BaseModel):
    vectors: list[list[float]]
    model: str
    provider: str
    dimensions: int


class SummaryRequest(BaseModel):
    channels: list[str]
    channels_text: str = Field("", alias="channelsText")
    # Either the client ships a pre-built postsText (the semantic/related path
    # and generateBackgroundSummary, which the server cannot reproduce), or it
    # sends a `scope` the backend resolves + assembles itself.
    posts_text: str = Field("", alias="postsText")
    scope: PromptScopeInput | None = None
    language: str = "English"
    model: str | None = None
    temperature: float = 0.7
    #: Which of the caller's AI Keys pays for this Artifact. `null` means "the
    #: one I have", resolved by `services/ai_keys.resolve_ai_key` - an Account
    #: with a single Key never sends this, which is why the client shows no
    #: chooser in that case.
    #:
    #: **Client-supplied and untrusted.** It is checked against the caller
    #: before the secret is decrypted; a foreign id answers as an absent one.
    ai_key_id: str | None = Field(default=None, alias="aiKeyId")
    #: The exact prompt to send, when the client already holds it. Generate
    #: fetches it from `/ai/summary/prompt` to file the pending Summary before
    #: the model is asked; sending it back means the model answers the prompt
    #: that was stored, and the posts are read once. Honoured by
    #: `/ai/summary/stream` only. No more trusted than `postsText`, which
    #: already lets a client choose what the model reads.
    prompt: str | None = None

    model_config = {"populate_by_name": True}


class ChatRequest(BaseModel):
    channels: list[str] = []
    channels_text: str = Field("", alias="channelsText")
    posts_text: str = Field("", alias="postsText")
    scope: PromptScopeInput | None = None
    language: str = "English"
    model: str | None = None
    temperature: float = 0.7
    message: str
    history: list[ChatMessage] = []
    rag_mode: bool = Field(False, alias="ragMode")
    #: Which of the caller's AI Keys pays for this Artifact. `null` means "the
    #: one I have", resolved by `services/ai_keys.resolve_ai_key` - an Account
    #: with a single Key never sends this, which is why the client shows no
    #: chooser in that case.
    #:
    #: **Client-supplied and untrusted.** It is checked against the caller
    #: before the secret is decrypted; a foreign id answers as an absent one.
    ai_key_id: str | None = Field(default=None, alias="aiKeyId")

    model_config = {"populate_by_name": True}


class EmbedRequest(BaseModel):
    texts: list[str]
    model: str | None = None


class TranslateRequest(BaseModel):
    posts: list[dict[str, str]]
    target_language: str = Field(..., alias="targetLanguage")
    model: str | None = None

    model_config = {"populate_by_name": True}


class TagRequest(BaseModel):
    channels: list[str]
    channels_text: str = Field("", alias="channelsText")
    posts_text: str = Field("", alias="postsText")
    scope: PromptScopeInput | None = None
    all_tags: str = Field("(none yet)", alias="allTags")
    tag_mode: str = Field("add", alias="tagMode")
    model: str | None = None
    temperature: float = 0.7
    #: Which of the caller's AI Keys pays for this Artifact. `null` means "the
    #: one I have", resolved by `services/ai_keys.resolve_ai_key` - an Account
    #: with a single Key never sends this, which is why the client shows no
    #: chooser in that case.
    #:
    #: **Client-supplied and untrusted.** It is checked against the caller
    #: before the secret is decrypted; a foreign id answers as an absent one.
    ai_key_id: str | None = Field(default=None, alias="aiKeyId")
    tags_per_channel_min: int | None = Field(default=None, alias="tagsPerChannelMin")
    tags_per_channel_max: int | None = Field(default=None, alias="tagsPerChannelMax")

    model_config = {"populate_by_name": True}
