from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    text: str


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
    posts_text: str = Field(..., alias="postsText")
    language: str = "English"
    model: str | None = None
    temperature: float = 0.7
    provider: str = "gemini"

    model_config = {"populate_by_name": True}


class ChatRequest(BaseModel):
    channels: list[str] = []
    posts_text: str = Field("", alias="postsText")
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
