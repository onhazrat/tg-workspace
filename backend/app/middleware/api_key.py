"""Optional API key auth for self-hosted deployment."""

from collections.abc import Callable

import jwt
from jwt.exceptions import InvalidTokenError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core import security
from app.core.config import settings

PUBLIC_PATHS = {
    "/docs",
    "/redoc",
    "/api/v1/openapi.json",
    "/api/v1/utils/health-check/",
    "/api/v1/users/signup",
}


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


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not settings.API_KEY:
            return await call_next(request)
        path = request.url.path
        if path in PUBLIC_PATHS or path.startswith("/api/v1/login"):
            return await call_next(request)

        key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")
        if key == settings.API_KEY:
            return await call_next(request)

        token = _bearer_token(request)
        if token and _is_valid_jwt(token):
            return await call_next(request)

        return JSONResponse(
            status_code=401, content={"detail": "Invalid or missing API key"}
        )
