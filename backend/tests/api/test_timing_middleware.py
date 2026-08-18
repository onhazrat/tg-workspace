"""`Server-Timing`, the slow-request log, and the SSE routes surviving both.

The middleware exists because every performance problem on this deployment so
far was found by hand. The two things that would make it useless are pinned
here: a header nobody can read (cross-origin without `Timing-Allow-Origin`),
and a middleware that breaks the sync job's event stream — which is the one
route where "how long did the response take" is a meaningless question and a
buffering wrapper would be fatal.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.middleware.timing import TimingMiddleware

PREFIX = settings.API_V1_STR


@contextmanager
def captured_warnings() -> Iterator[list[str]]:
    """Collect `app.timing` warnings via an explicit handler.

    Not `caplog`: under pytest 9 it captures nothing in this suite — a direct
    `logger.warning` inside `caplog.at_level` produces an empty
    `caplog.records`. Attaching a handler is three lines, depends on no plugin
    behaviour, and cannot silently start passing on an upgrade.
    """
    messages: list[str] = []

    class Collector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            messages.append(record.getMessage())

    logger = logging.getLogger("app.timing")
    handler = Collector(level=logging.WARNING)
    previous = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        yield messages
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous)


def _app(slow_ms: int = 1000) -> FastAPI:
    app = FastAPI()
    app.add_middleware(TimingMiddleware, slow_ms=slow_ms)

    @app.get("/quick")
    def quick() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/items/{item_id}")
    def item(item_id: str) -> dict[str, str]:
        # Deliberately slower than any threshold a test sets: relying on a
        # trivial handler to exceed 1 ms is how this test flakes on a fast box.
        time.sleep(0.02)
        return {"id": item_id}

    @app.get("/stream")
    def stream() -> StreamingResponse:
        def events() -> object:
            yield "data: one\n\n"
            yield "data: two\n\n"

        return StreamingResponse(events(), media_type="text/event-stream")

    return app


def test_every_response_carries_server_timing() -> None:
    with TestClient(_app()) as client:
        response = client.get("/quick")

    assert response.status_code == 200
    assert response.headers["server-timing"].startswith("app;dur=")


def test_an_sse_stream_still_streams_and_is_still_timed() -> None:
    """The whole reason this is plain ASGI rather than BaseHTTPMiddleware.

    The clock stops at the response *start*, so a stream that stays open for
    minutes is not reported as a minutes-long request, and nothing here wraps
    the body — the chunks arrive unchanged.
    """
    with TestClient(_app()) as client, client.stream("GET", "/stream") as response:
        assert response.headers["server-timing"].startswith("app;dur=")
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join(response.iter_text())

    assert body == "data: one\n\ndata: two\n\n"


def test_a_slow_request_is_logged_with_the_route_template() -> None:
    """Templated, not the URL.

    Grouping by URL would give every item its own row and no aggregate would
    ever show a total worth reading.
    """
    with captured_warnings() as messages, TestClient(_app(slow_ms=1)) as client:
        client.get("/items/abc123")

    slow = [m for m in messages if "slow request" in m]
    assert slow, f"nothing logged; saw {messages}"
    assert "/items/{item_id}" in slow[0]
    assert "abc123" not in slow[0]


def test_a_fast_request_is_not_logged() -> None:
    with captured_warnings() as messages, TestClient(_app(slow_ms=60_000)) as client:
        client.get("/quick")

    assert not [m for m in messages if "slow request" in m]


def test_the_log_can_be_disabled_without_losing_the_header() -> None:
    """`SLOW_REQUEST_LOG_MS=0` is the local-development setting."""
    with captured_warnings() as messages, TestClient(_app(slow_ms=0)) as client:
        response = client.get("/quick")

    assert response.headers["server-timing"].startswith("app;dur=")
    assert not [m for m in messages if "slow request" in m]


def test_timing_allow_origin_is_echoed_only_for_allowed_origins() -> None:
    """Without this the dashboard's DevTools shows no Server-Timing at all.

    The API and the dashboard are different hosts, and a cross-origin response
    hides its timing detail unless it opts in. Echoed against the CORS
    allowlist rather than sent as `*`: the origins that may read the response
    are the origins that may read how long it took.
    """
    allowed = settings.all_cors_origins[0]
    with TestClient(_app()) as client:
        ok = client.get("/quick", headers={"Origin": allowed})
        stranger = client.get("/quick", headers={"Origin": "https://evil.example"})
        none = client.get("/quick")

    assert ok.headers["timing-allow-origin"] == allowed
    assert "timing-allow-origin" not in stranger.headers
    assert "timing-allow-origin" not in none.headers


def test_it_is_mounted_on_the_real_app(client: TestClient) -> None:
    """The middleware is worth nothing if it is not actually registered."""
    response = client.get(f"{PREFIX}/utils/health-check/")

    assert response.status_code == 200
    assert response.headers["server-timing"].startswith("app;dur=")
