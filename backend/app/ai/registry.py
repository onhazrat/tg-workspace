"""Building a Provider from a resolved credential, and asking it what it offers.

**There is no instance cache.** There was one, a module-level dict keyed by
Provider *name* alone, which was harmless while one environment key paid for
every call and is a cross-account credential leak the moment Keys are per
Account: the first caller's client is handed to the second. Keying the cache by
credential would work and buys nothing measurable — constructing a client is
assembling a config object — so the cache is gone rather than made correct.

`get_provider` takes the credential as an argument for the same reason: a
Provider that reads `settings.GEMINI_API_KEY` for itself is a Provider that
cannot be told whose money to spend. Who pays is answered upstream, in
`services/ai_keys.resolve_ai_key`, and nothing here decides it.

The model *list* is cached, which is a different object with a different risk.
It is public information about an endpoint rather than a credential, it is keyed
by the Key row it was fetched for, and the alternative is an outbound call on
somebody's account every time a dropdown renders.
"""

from __future__ import annotations

import time

from app.ai.base import LLMProvider
from app.ai.models import ModelInfo
from app.ai.providers.gemini import GeminiProvider
from app.ai.providers.openai_compatible import OpenAICompatibleProvider
from app.core.config import settings


def get_provider(
    *,
    provider: str = "gemini",
    api_key: str,
    base_url: str | None = None,
) -> LLMProvider:
    """The client for one credential."""
    if provider == "gemini":
        return GeminiProvider(api_key=api_key)
    if provider == "openai_compatible":
        if not base_url:
            raise ValueError("An OpenAI-compatible key needs a base URL")
        return OpenAICompatibleProvider(api_key=api_key, base_url=base_url)
    raise ValueError(f"Unknown provider: {provider}")


async def validate_credential(
    *, provider: str, api_key: str, base_url: str | None = None
) -> bool:
    """Whether the Provider accepts this credential, from one model listing.

    Called when a Key is saved, so that a wrong key — or, for the second
    Provider kind, a wrong base URL — is found while somebody is looking at the
    form rather than three days later inside a scheduled Summary. Nothing calls
    it on a schedule: a job that spends people's money to check whether they can
    still spend money is the cost BYOK exists to remove.

    **A listing rather than the cheap completion BYOK-01 used.** It reaches the
    same two failures, costs no tokens at all, and needs no model id — which the
    completion did, and which BYOK-02 can no longer supply, because
    `DEFAULT_AI_MODEL` is a Gemini id and an OpenAI-compatible endpoint has its
    own names for everything.

    Any failure is a `False` rather than a raise. The caller records a boolean
    and shows the Key as unvalidated; distinguishing "rejected" from
    "unreachable" here would be a second status nothing acts on differently —
    both end in "re-save it", and the real rejection surfaces at call time. An
    endpoint that serves no listing at all lands here too, and its Key is stored
    unstamped and still used, which `resolve_ai_key` argues for at length.
    """
    try:
        await get_provider(
            provider=provider, api_key=api_key, base_url=base_url
        ).list_models()
    except Exception:
        return False
    return True


#: What a **400** means, when it means the credential rather than the request.
#:
#: Only 400 needs the phrases, and that is the whole point of them: Gemini
#: answers a bad key with **400 INVALID_ARGUMENT**, the same code it uses for a
#: malformed request, so clearing a Key's validation stamp on a bare 400 would
#: flag a perfectly good Key the first time somebody sent a model id that does
#: not exist. 401 and 403 carry no such ambiguity and are matched on the status
#: alone — requiring a phrase there read OpenRouter's
#: `{"error":{"message":"No auth credentials found"}}` as "not now", so a
#: revoked key rendered as a provider offering no models and the settings panel
#: went on calling it healthy.
_REJECTION_STATUSES = frozenset({"UNAUTHENTICATED", "PERMISSION_DENIED"})
_REJECTION_PHRASES = ("api key", "api_key", "unauthorized", "invalid authentication")


def is_credential_rejection(exc: BaseException) -> bool:
    """Whether this failure means the key is no good, rather than "not now".

    Duck-typed on `code`/`status`/`message` rather than caught by class, which
    is what lets one rule serve both Providers — `OpenAICompatibleError` carries
    the same two attributes for exactly this reason, and neither Provider needed
    this function rewritten around its exception hierarchy.

    The cost of being wrong is asymmetric and cheap either way: a false positive
    clears a stamp somebody restores by re-saving, and a false negative leaves
    the Key looking healthy until the next call.
    """
    code = getattr(exc, "code", None)
    if code in (401, 403):
        return True
    if code != 400:
        return False
    if str(getattr(exc, "status", "") or "").upper() in _REJECTION_STATUSES:
        return True
    text = str(getattr(exc, "message", "") or exc).lower()
    return any(phrase in text for phrase in _REJECTION_PHRASES)


#: How long a fetched model list stays good. Long enough that opening the Action
#: tab, changing the model and opening it again is one outbound call; short
#: enough that a new model on OpenRouter shows up the same working day.
MODEL_CACHE_TTL_SECONDS = 600.0

#: `cache key -> (fetched at, models)`. Keyed on the Key row *and* its base URL,
#: so editing a Key to point somewhere else does not serve the old endpoint's
#: catalogue back. Process-local and unbounded in principle, bounded in practice
#: by the number of Keys in the deployment.
_MODEL_CACHE: dict[str, tuple[float, list[ModelInfo]]] = {}


async def list_models_cached(
    *, provider: str, api_key: str, base_url: str | None, cache_key: str
) -> list[ModelInfo]:
    """The Provider's model list, at most once every `MODEL_CACHE_TTL_SECONDS`.

    The cache is what makes this endpoint safe to call from a dropdown. Without
    it every render of the Action tab is an authenticated outbound request on an
    Account's own key, which is the shape of accident this feature exists to
    stop being casual about.

    `cache_key` is supplied rather than derived from the credential, because the
    caller already holds the Key's row id and hashing a secret to reach the same
    answer would put the secret one bug away from a cache dump.
    """
    entry = _MODEL_CACHE.get(cache_key)
    now = time.monotonic()
    if entry and now - entry[0] < MODEL_CACHE_TTL_SECONDS:
        return entry[1]
    models = await get_provider(
        provider=provider, api_key=api_key, base_url=base_url
    ).list_models()
    _MODEL_CACHE[cache_key] = (now, models)
    return models


def forget_cached_models(cache_key_prefix: str) -> None:
    """Drop what was cached for a Key, on a save that may have changed it.

    **Only in the process that served the save.** The API tier scales past one
    replica (`docs/scaling-to-multiple-workers.md`), and this cache is a module
    global, so another worker keeps the old endpoint's catalogue until its own
    entry ages out. That is a bounded wrong answer — at most
    `MODEL_CACHE_TTL_SECONDS`, in a dropdown, against a Key its owner has just
    edited — and the alternative is a shared invalidation channel for a list of
    model names. `NOTIFY` is there if this ever matters; it does not yet.
    """
    for key in [k for k in _MODEL_CACHE if k.startswith(cache_key_prefix)]:
        _MODEL_CACHE.pop(key, None)


def default_model() -> str:
    return settings.DEFAULT_AI_MODEL
