from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    text: str


class ModelInfo(BaseModel):
    id: str
    label: str
    provider: str
    #: Tokens the model accepts, when the Provider says (OpenRouter does, Gemini
    #: by rule). `null` means unknown, and the page then warns about nothing.
    context_length: int | None = Field(
        default=None, serialization_alias="contextLength"
    )


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


class SummaryPromptRequest(BaseModel):
    """Which Summary's prompt to build: the server reads its Covered Posts."""

    # `extra="forbid"`: a stale tab still sending the old `scope` body must be
    # a 422 that one reload fixes, never a prompt over the wrong Posts.
    model_config = {"populate_by_name": True, "extra": "forbid"}

    summary_id: str = Field(alias="summaryId")
    #: The Channel descriptions the browser formats (bios, tags), in place of
    #: the bare names; the Posts are never the browser's.
    channels_text: str = Field("", alias="channelsText")


class ChatRequest(BaseModel):
    """One turn of a Chat: the server reads the Chat's Covered Posts."""

    # `extra="forbid"`, as on `SummaryPromptRequest`: a stale tab still sending
    # the old `scope` body is a 422 that one reload fixes, never a turn over
    # the Posts tab's selection of today.
    model_config = {"populate_by_name": True, "extra": "forbid"}

    chat_id: str = Field(alias="chatId")
    channels_text: str = Field("", alias="channelsText")
    #: Semantic mode only: the Posts a meaning search ranked for this question,
    #: which the server cannot reproduce. When set, it wins over the Chat's
    #: Covered Posts.
    posts_text: str = Field("", alias="postsText")
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


class EmbedRequest(BaseModel):
    texts: list[str]
    model: str | None = None


class TranslateRequest(BaseModel):
    posts: list[dict[str, str]]
    target_language: str = Field(..., alias="targetLanguage")
    model: str | None = None

    model_config = {"populate_by_name": True}


class TagRequest(BaseModel):
    """A Tag run's prompt: the server reads the run's Covered Posts."""

    # `extra="forbid"`: see `ChatRequest`.
    model_config = {"populate_by_name": True, "extra": "forbid"}

    tag_run_id: str = Field(alias="tagRunId")
    channels_text: str = Field("", alias="channelsText")
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
