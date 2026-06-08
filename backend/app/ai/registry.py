from app.ai.base import LLMProvider
from app.ai.providers.gemini import GeminiProvider
from app.core.config import settings

_providers: dict[str, LLMProvider] = {}


def get_provider(name: str = "gemini") -> LLMProvider:
    if name not in _providers:
        if name == "gemini":
            _providers[name] = GeminiProvider()
        else:
            raise ValueError(f"Unknown provider: {name}")
    return _providers[name]


def list_all_models() -> list[dict[str, str]]:
    from app.ai.providers.gemini import GeminiProvider

    return [
        {"id": m.id, "label": m.label, "provider": m.provider}
        for m in GeminiProvider.list_models_static()
    ]


def default_model() -> str:
    return settings.DEFAULT_AI_MODEL
