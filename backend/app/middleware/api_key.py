"""Optional API key auth for self-hosted deployment."""

import logging
from collections.abc import Callable

import jwt
from jwt.exceptions import InvalidTokenError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core import security
from app.core.config import settings

logger = logging.getLogger(__name__)

_BASE_PUBLIC_PATHS = {
    "/docs",
    "/redoc",
    "/api/v1/openapi.json",
    "/api/v1/utils/health-check/",
}


def _public_paths() -> set[str]:
    paths = set(_BASE_PUBLIC_PATHS)
    if settings.USERS_OPEN_REGISTRATION:
        paths.add("/api/v1/users/signup")
    return paths


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


def _has_valid_auth(request: Request) -> bool:
    key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")
    if settings.API_KEY and key == settings.API_KEY:
        return True
    token = _bearer_token(request)
    return bool(token and _is_valid_jwt(token))


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if path in _public_paths() or path.startswith("/api/v1/login"):
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
