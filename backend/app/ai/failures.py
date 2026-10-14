"""What a failed Provider call says, to an Account and to an Attempt.

Shared by the streaming routes and the generation worker, which meet the same
Provider errors and must word them the same way.
"""

from __future__ import annotations

from app.ai.registry import is_credential_rejection
from app.services.ai_keys import AI_KEY_REJECTED_DETAIL, ResolvedKey

#: Status codes that mean "busy, try again": an overloaded model or a gateway
#: that timed out. 529 is Anthropic-compatible gateways' "overloaded". Not 500,
#: which is as often a request the endpoint cannot handle as a passing fault.
BUSY_CODES = frozenset({502, 503, 504, 529})

#: What an Attempt records when the model answered nothing.
EMPTY_ANSWER_DETAIL = "The model returned an empty response."


def provider_code(exc: BaseException) -> int | None:
    """The HTTP status a Provider answered with, or `None` if it never did.

    Both Providers' errors carry an int `code` (the same duck typing
    `is_credential_rejection` relies on). Anything without one is not the
    Provider saying no: a dropped connection, or a bug in this process.
    """
    code = getattr(exc, "code", None)
    return code if isinstance(code, int) else None


def provider_message(exc: BaseException, key: ResolvedKey) -> str:
    """The Provider's own words, safe to show.

    The Key is scrubbed **before** truncating: a Key straddling the cut would
    otherwise survive as a prefix the replace no longer matches. A gateway that
    answers with a whole HTML page is named rather than pasted into a toast.
    """
    message = str(getattr(exc, "message", "") or exc)
    if key.api_key:
        message = message.replace(key.api_key, "***")
    message = " ".join(message.split())
    if message.startswith("<"):
        return "an HTML error page"
    return message[:300] or "no details"


def failure_detail(exc: BaseException, key: ResolvedKey) -> str:
    """One sentence for the Account about a Provider call that failed.

    Only a busy model gets a fixed answer, because its fix is "wait" and the
    Provider's words rarely say so. Everything else carries the Provider's own
    message, since a 429 may be a per-minute limit or a spent daily quota and
    only the Provider knows which.
    """
    if is_credential_rejection(exc):
        return AI_KEY_REJECTED_DETAIL
    code = provider_code(exc)
    if code is None:
        return (
            "The AI request failed unexpectedly. "
            "Try again, and report it if it keeps happening."
        )
    if code in BUSY_CODES:
        return (
            "The AI model is overloaded right now. "
            "Try again in a minute, or pick another model."
        )
    message = provider_message(exc, key)
    if code == 429:
        return f"The AI provider is limiting this key: {message}"
    if code >= 500:
        return f"The AI provider had an internal error ({code}): {message}"
    return f"The AI provider refused the request ({code}): {message}"
