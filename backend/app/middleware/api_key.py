"""Optional API key auth for self-hosted deployment."""

from collections.abc import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import settings

PUBLIC_PATHS = {
    "/docs",
    "/redoc",
    "/api/v1/openapi.json",
    "/api/v1/utils/health-check/",
}


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not settings.API_KEY:
            return await call_next(request)
        path = request.url.path
        if path in PUBLIC_PATHS or path.startswith("/api/v1/login"):
            return await call_next(request)
        key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")
        if key != settings.API_KEY:
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})
        return await call_next(request)
