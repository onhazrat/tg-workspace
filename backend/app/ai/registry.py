"""Building a Provider from a resolved credential.

**There is no instance cache.** There was one, a module-level dict keyed by
Provider *name* alone, which was harmless while one environment key paid for
every call and is a cross-account credential leak the moment Keys are per
Account: the first caller's client is handed to the second. Keying the cache by
credential would work and buys nothing measurable — constructing a
`genai.Client` is assembling a config object — so the cache is gone rather than
made correct, which is one fewer thing to get wrong when BYOK-02 adds a base
URL to the key.

`get_provider` takes the credential as an argument for the same reason: a
Provider that reads `settings.GEMINI_API_KEY` for itself is a Provider that
cannot be told whose money to spend. Who pays is answered upstream, in
`services/ai_keys.resolve_ai_key`, and nothing here decides it.
"""

from app.ai.base import LLMProvider
from app.ai.providers.gemini import GeminiProvider
from app.core.config import settings


def get_provider(
    *,
    provider: str = "gemini",
    api_key: str,
    base_url: str | None = None,  # noqa: ARG001  (BYOK-02 reads it)
) -> LLMProvider:
    """The client for one credential.

    `base_url` is accepted and unused here: BYOK-01 ships Gemini only, and
    BYOK-02's `OpenAICompatibleProvider` is what reads it. Taking it now keeps
    every call site's shape final, so that ticket adds a branch rather than
    touching eleven callers.
    """
    if provider == "gemini":
        return GeminiProvider(api_key=api_key)
    raise ValueError(f"Unknown provider: {provider}")


async def validate_credential(
    *, provider: str, api_key: str, base_url: str | None = None
) -> bool:
    """Whether the Provider accepts this credential, from one cheap completion.

    Called when a Key is saved, so that a wrong key is found while somebody is
    looking at the form rather than three days later inside a scheduled Summary.
    Nothing calls it on a schedule: a job that spends people's money to check
    whether they can still spend money is the cost BYOK exists to remove.

    Any failure is a `False` rather than a raise. The caller records a boolean
    and shows the Key as unvalidated; distinguishing "rejected" from
    "unreachable" here would be a second status nothing acts on differently —
    both end in "re-save it", and the real rejection surfaces at call time.
    """
    try:
        await get_provider(
            provider=provider, api_key=api_key, base_url=base_url
        ).complete("ping", model=default_model(), temperature=0)
    except Exception:
        return False
    return True


#: What a Provider says when it will not accept the credential, as opposed to
#: when it is briefly unwell. Matched on the pair rather than on the status
#: alone: Gemini answers a bad key with **400 INVALID_ARGUMENT**, the same code
#: it uses for a malformed request, so clearing a Key's validation stamp on a
#: bare 400 would flag a perfectly good Key the first time somebody sent a model
#: id that does not exist.
_REJECTION_STATUSES = frozenset({"UNAUTHENTICATED", "PERMISSION_DENIED"})
_REJECTION_PHRASES = ("api key", "api_key", "unauthorized", "invalid authentication")


def is_credential_rejection(exc: BaseException) -> bool:
    """Whether this failure means the key is no good, rather than "not now".

    Duck-typed on `code`/`status`/`message` rather than caught by class, so that
    BYOK-02's OpenAI-compatible Provider does not need this rewritten around a
    second exception hierarchy. The cost of being wrong is asymmetric and cheap
    either way: a false positive clears a stamp somebody restores by re-saving,
    and a false negative leaves the Key looking healthy until the next call.
    """
    code = getattr(exc, "code", None)
    if code not in (400, 401, 403):
        return False
    if str(getattr(exc, "status", "") or "").upper() in _REJECTION_STATUSES:
        return True
    text = str(getattr(exc, "message", "") or exc).lower()
    return any(phrase in text for phrase in _REJECTION_PHRASES)


def list_all_models() -> list[dict[str, str]]:
    return [
        {"id": m.id, "label": m.label, "provider": m.provider}
        for m in GeminiProvider.list_models_static()
    ]


def default_model() -> str:
    return settings.DEFAULT_AI_MODEL
