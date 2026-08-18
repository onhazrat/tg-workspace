"""Per-request timing: a `Server-Timing` header and a slow-request log line.

## Why this exists

Four rounds of performance work on this deployment were found by hand, and the
lesson recorded in `docs/channels-tab-load-investigation.md` is that **every
number that mattered was invisible to server-side measurement**: the bottleneck
moved off the backend after the second round, and only a browser-side
measurement revealed it.

Traefik's access log answers "how long did the client wait". This answers "how
much of that was the application", and the difference is the transfer cost —
the thing that took three rounds to name. `backend/scripts/slow_endpoints.py`
puts the two side by side.

## Time to first byte, not time to last byte

The clock stops at `http.response.start`. For an ordinary JSON response that is
the whole handler, because Starlette sends the start message only once the
handler has returned. For the SSE routes it is the moment the stream opens,
which is the only meaningful "application time" a long-lived stream has — a
sync job's event stream is *supposed* to stay open for minutes.

That choice is what makes this middleware safe for SSE, and it is why it is
plain ASGI rather than `BaseHTTPMiddleware`: nothing here wraps, buffers or
iterates the response body, so a stream passes through untouched.

## Route template, not raw path

The label is `scope["route"].path` (`/api/v1/data/summaries/{summary_id}`), not
the URL. Grouping by URL would make every summary its own row and no aggregate
would ever show a total worth reading. The route is written into the same
`scope` dict by the router, so it is present by the time the response starts
even though it was absent on the way in.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterable

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings

logger = logging.getLogger("app.timing")


def _route_label(scope: Scope) -> str:
    """The templated path if the router matched one, else the raw path.

    An unmatched request (404, or one rejected by an outer middleware) has no
    route, and its raw path is the only thing left to report. Those are low
    volume by definition, so the cardinality risk is theoretical.
    """
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path:
        return path
    raw = scope.get("path")
    return raw if isinstance(raw, str) else "<unknown>"


class TimingMiddleware:
    """Adds `Server-Timing` and logs anything slower than `slow_ms`.

    `slow_ms=0` disables the log line but keeps the header, which is the useful
    setting for local development: the header costs nothing and shows up in the
    DevTools waterfall, while a log line per request would drown `fastapi dev`.
    """

    def __init__(self, app: ASGIApp, *, slow_ms: int | None = None) -> None:
        self.app = app
        self.slow_ms = settings.SLOW_REQUEST_LOG_MS if slow_ms is None else slow_ms

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        reported = False

        async def send_with_timing(message: Message) -> None:
            nonlocal reported
            if message["type"] == "http.response.start" and not reported:
                reported = True
                elapsed_ms = (time.perf_counter() - started) * 1000
                _annotate(message, scope, elapsed_ms)
                if self.slow_ms and elapsed_ms >= self.slow_ms:
                    logger.warning(
                        "slow request %s %s %.0fms status=%s",
                        scope.get("method", "?"),
                        _route_label(scope),
                        elapsed_ms,
                        message.get("status"),
                    )
            await send(message)

        await self.app(scope, receive, send_with_timing)


def _annotate(message: Message, scope: Scope, elapsed_ms: float) -> None:
    headers = MutableHeaders(scope=message)
    headers.append("Server-Timing", f"app;dur={elapsed_ms:.1f}")

    # Cross-origin resources hide their Server-Timing detail from DevTools
    # unless the response opts in, and the dashboard is on a different host
    # from the API. Echoed against the CORS allowlist rather than sent as `*`:
    # the same origins that may read the response may read how long it took.
    origin = _request_origin(scope)
    if origin and origin in settings.all_cors_origins:
        headers.append("Timing-Allow-Origin", origin)


def _request_origin(scope: Scope) -> str | None:
    headers: Iterable[tuple[bytes, bytes]] = scope.get("headers") or ()
    for key, value in headers:
        if key == b"origin":
            return value.decode("latin-1")
    return None
