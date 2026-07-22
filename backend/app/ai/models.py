from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    text: str


class PromptScopeInput(BaseModel):
    """A Posts-feed scope the backend resolves into the prompt's posts block,
    instead of the client shipping a pre-built ``postsText``. Mirrors the
    frontend feed query params."""

    start_date: int | None = Field(None, alias="startDate")
    end_date: int | None = Field(None, alias="endDate")
    keyword: str | None = None
    forwarded: str = "all"
    media: str = "all"
    max_per_channel: int = Field(0, alias="maxPerChannel")
    max_per_channel_mode: str = Field("latest", alias="maxPerChannelMode")
    sort: str = "time"
    seed: int = 0

    model_config = {"populate_by_name": True}


class ModelInfo(BaseModel):
    id: str
    label: str
    provider: str


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
    provider: str = "gemini"

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
    provider: str = "gemini"

    model_config = {"populate_by_name": True}


class EmbedRequest(BaseModel):
    texts: list[str]
    model: str | None = None
    provider: str = "gemini"


class TranslateRequest(BaseModel):
    posts: list[dict[str, str]]
    target_language: str = Field(..., alias="targetLanguage")
    model: str | None = None
    provider: str = "gemini"

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
    provider: str = "gemini"
    tags_per_channel_min: int | None = Field(default=None, alias="tagsPerChannelMin")
    tags_per_channel_max: int | None = Field(default=None, alias="tagsPerChannelMax")

    model_config = {"populate_by_name": True}
