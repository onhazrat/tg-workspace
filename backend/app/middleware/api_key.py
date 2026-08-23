"""Optional API key auth for self-hosted deployment."""

import hmac
import logging
from collections.abc import Awaitable, Callable

import jwt
from jwt.exceptions import InvalidTokenError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core import security
from app.core.config import settings

logger = logging.getLogger(__name__)

# FastAPI's own documentation routes. Not API endpoints, and not covered by the
# route/exemption guard, which only reasons about `APIRoute`s under `/api/v1`.
DOCS_PATHS = frozenset(
    {
        "/docs",
        "/redoc",
        "/api/v1/openapi.json",
    }
)

# Endpoints that carry no auth dependency of their own, so this middleware must
# let them through or they are unreachable outside `local`.
#
# `/users/signup` is exempt unconditionally even though registration can be
# closed: the handler already answers 403 when `USERS_OPEN_REGISTRATION` is off,
# and one gate deciding policy is worth more than two agreeing. This middleware
# answers only "does the route authenticate itself"; whether the route wants to
# serve the caller is the route's business.
PUBLIC_API_PATHS = frozenset(
    {
        "/api/v1/utils/health-check/",
        "/api/v1/users/signup",
        "/api/v1/reset-password/",
    }
)

# Matched with `startswith`, because this runs before routing: there is no
# matched route and no path template here, only the raw URL a client sent.
#
# **Every prefix ends in a separator**, and that is load-bearing rather than
# tidiness. `/api/v1/password-recovery` without one also swallows
# `/api/v1/password-recovery-html-content/{email}`, the superuser-only route that
# renders a live password-reset token for an arbitrary address. `/api/v1/login`
# without one would exempt any future `/api/v1/login-history` on the day someone
# adds it, silently and with nothing failing. `test_public_route_exemptions.py`
# pins both pairs.
PUBLIC_API_PREFIXES = (
    "/api/v1/login/",
    "/api/v1/password-recovery/",
)


def is_public_path(path: str) -> bool:
    """Whether a request path bypasses this middleware entirely.

    A missing trailing slash is treated as the path that has one. FastAPI's
    `redirect_slashes` answers `/reset-password` with a 307 to
    `/reset-password/`, but that happens in the router — which never runs if
    this middleware has already answered 401. Without this, the two layers
    disagree about what the path is, and a caller who omits the slash gets an
    authentication error for a public endpoint.
    """
    return (
        path in DOCS_PATHS
        or path in PUBLIC_API_PATHS
        or f"{path}/" in PUBLIC_API_PATHS
        or path.startswith(PUBLIC_API_PREFIXES)
    )


def _bearer_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization") or request.headers.get("authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    return auth[7:].strip() or None


def _is_valid_jwt(token: str) -> bool:
    try:
        jwt.decode(token, settings.SECRET_KEY, algorithms=[security.ALGORITHM])
        return True
    except InvalidTokenError:
        return False


def _matches_api_key(candidate: str | None) -> bool:
    """Constant-time comparison, so rejection time does not leak the key.

    `==` on `str` short-circuits at the first differing character, which turns
    the response time into an oracle for how many leading characters a guess got
    right — a key recoverable one character at a time. `compare_digest` reads
    both operands whatever they contain.

    Encoded first, because `compare_digest` on `str` raises `TypeError` on any
    non-ASCII character. Starlette decodes headers as latin-1, so a single byte
    above 0x7f in `X-API-Key` would turn a rejected guess into a 500 — a fault
    anyone can trigger with one header.
    """
    if not settings.API_KEY or not candidate:
        return False
    return hmac.compare_digest(
        candidate.encode("utf-8"), settings.API_KEY.encode("utf-8")
    )


def _has_valid_auth(request: Request) -> bool:
    key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")
    if _matches_api_key(key):
        return True
    token = _bearer_token(request)
    return bool(token and _is_valid_jwt(token))


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # Browsers send unauthenticated CORS preflight requests.
        if request.method == "OPTIONS":
            return await call_next(request)

        if is_public_path(request.url.path):
            return await call_next(request)

        if settings.ENVIRONMENT == "local" and not settings.API_KEY:
            return await call_next(request)

        if settings.ENVIRONMENT != "local" and not settings.API_KEY:
            logger.warning(
                "API_KEY is unset in %s; rejecting unauthenticated requests",
                settings.ENVIRONMENT,
            )

        if _has_valid_auth(request):
            return await call_next(request)

        return JSONResponse(
            status_code=401, content={"detail": "Authentication required"}
        )
