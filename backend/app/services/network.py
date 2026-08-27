"""HTTP client with proxy lane pool, Tor support, and telemetry."""

from __future__ import annotations

import asyncio
import random
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import httpx
from stem import Signal
from stem.control import Controller

from app.core.config import settings
from app.core.request_meter import record_telegram_request
from app.services.network_settings import normalize_proxy_url
from app.services.proxy_pool import ProxyLane
from app.services.telegram_web import (
    TelegramWebViewUnavailable,
    is_telegram_web_url,
    is_telegram_web_view_url,
    telegram_channel_post_url,
)

_bad_proxies: dict[str, float] = {}
_tor_counter_lock = asyncio.Lock()
_tor_request_counter = 0
_is_rotating_tor = False


def _prune_expired_cooldowns(now_ms: float) -> None:
    """Expired entries were only filtered on read, so the dict grew forever."""
    for url in [u for u, until in _bad_proxies.items() if until <= now_ms]:
        _bad_proxies.pop(url, None)


def get_bad_proxies() -> list[dict[str, Any]]:
    now = time.time() * 1000
    _prune_expired_cooldowns(now)
    return [
        {
            "url": url,
            "cooldownRemaining": max(0, int((cooldown_until - now) / 1000)),
        }
        for url, cooldown_until in _bad_proxies.items()
        if now < cooldown_until
    ]


def proxy_in_cooldown(proxy_url: str) -> bool:
    now = time.time() * 1000
    return _bad_proxies.get(proxy_url, 0) > now


def _validate_telegram_web_view_page(
    *, request_url: str, final_url: str, html: str
) -> None:
    if is_telegram_web_view_url(request_url) and not is_telegram_web_view_url(
        final_url
    ):
        raise TelegramWebViewUnavailable()
    if is_telegram_web_view_url(request_url):
        has_action = "tgme_page_action" in html
        has_widgets = "tgme_widget_message_date" in html
        if has_action and not has_widgets:
            raise TelegramWebViewUnavailable()


def _build_client(proxy_url: str | None) -> httpx.AsyncClient:
    kwargs: dict[str, Any] = {
        "timeout": settings.NETWORK_FETCH_TIMEOUT_SECONDS,
        "follow_redirects": True,
    }
    if proxy_url:
        kwargs["proxy"] = normalize_proxy_url(proxy_url)
    return httpx.AsyncClient(**kwargs)


async def _fetch_once(
    url: str,
    proxy_url: str | None,
    *,
    client: httpx.AsyncClient | None = None,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
    binary: bool = False,
) -> Any:
    async def _request(http_client: httpx.AsyncClient) -> Any:
        if method == "POST":
            response = await http_client.post(url, json=json_body)
        else:
            response = await http_client.get(url)
        response.raise_for_status()
        if binary:
            content_type = (
                response.headers.get("content-type", "").split(";")[0].strip()
            )
            return response.content, content_type
        data = response.text if is_telegram_web_url(url) else response.json()
        if isinstance(data, str) and is_telegram_web_view_url(url):
            _validate_telegram_web_view_page(
                request_url=url,
                final_url=str(response.url),
                html=data,
            )
        return data

    if client is not None:
        return await _request(client)

    async with _build_client(proxy_url) as ephemeral:
        return await _request(ephemeral)


def _rotate_tor_identity_sync(control_port: int, password: str) -> None:
    with Controller.from_port(port=control_port) as controller:
        if password:
            controller.authenticate(password=password)
        else:
            controller.authenticate()
        controller.signal(Signal.NEWNYM)


async def rotate_tor_identity(
    control_port: int | None = None, password: str | None = None
) -> None:
    global _is_rotating_tor, _tor_request_counter
    if _is_rotating_tor:
        return
    _is_rotating_tor = True
    port = control_port or settings.TOR_CONTROL_PORT
    pwd = password or settings.TOR_CONTROL_PASSWORD or ""
    try:
        await asyncio.to_thread(_rotate_tor_identity_sync, port, pwd)
        _tor_request_counter = 0
        await asyncio.sleep(2)
    finally:
        _is_rotating_tor = False


@asynccontextmanager
async def _proxy_acquire(
    proxies: list[str],
    tried: set[str],
    *,
    proxy_concurrency: tuple[int, dict[str, int]] | None,
) -> AsyncIterator[ProxyLane]:
    from app.services.proxy_pool import (
        ProxyPoolExhausted,
        bound_proxy_url,
        ensure_pool_configured,
    )

    default_slots, overrides = proxy_concurrency if proxy_concurrency else (1, {})
    pool = await ensure_pool_configured(proxies, default_slots, overrides)

    # **A bound worker does not hop, including on retry** (ticket 13). The
    # partition assigns one proxy per queued message, so every attempt this
    # call makes goes out the same egress: that is the whole of "the rate any
    # one proxy sees is predictable".
    #
    # The fallback a reader will want to add here — try another lane when this
    # one fails — is the mechanism that turns one bad proxy into several. It
    # moves a dead proxy's load onto the healthy ones at the exact moment
    # Telegram is already pushing back. Capacity is supposed to *drop* when a
    # proxy dies; redistributing hides the number this ticket exists to make
    # honest, and the Channel is picked up next sweep by a worker bound to a
    # proxy that works.
    bound = bound_proxy_url()
    if bound is not None:
        lane = pool.lane_by_url(bound)
        if lane is not None:
            # Same translation as the free-choice path below: a saturated bound
            # lane is a network fault from the caller's point of view, so it
            # goes round the retry loop and ends up in the sync log rather than
            # escaping as a type nothing above here handles.
            try:
                async with pool.hold(lane) as held:
                    yield held
            except ProxyPoolExhausted as exc:
                raise ConnectionError(str(exc)) from exc
            return
        # The operator removed this proxy while the walk was in flight. Falling
        # through to free choice is right: the alternative fails a sync for a
        # settings edit, and there is no longer a lane to be predictable about.

    try:
        async with pool.acquire(exclude=tried) as lane:
            tried.add(lane.url)
            yield lane
    except ProxyPoolExhausted as exc:
        raise ConnectionError(str(exc)) from exc


async def fetch_with_retry(
    url: str,
    *,
    retries: int | None = None,
    initial_delay_ms: int | None = None,
    proxies: list[str] | None = None,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int | None = None,
    tor_control_port: int | None = None,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
    binary: bool = False,
) -> tuple[Any, dict[str, Any]]:
    """Fetch with proxy-lane retries and telemetry.

    With ``binary=True`` the payload is ``(bytes, content_type)`` instead of
    decoded text/JSON — used for media that must travel the same proxy or Tor
    lane as the page fetches, so scraping over Tor does not leak the real
    egress IP to Telegram's CDN.

    **One Request for quota purposes is one attempt Telegram answered** (ticket
    08), charged to whatever `core/request_meter` block is active — nothing, for
    the callers that are not a sync.

    Per *answered attempt*, not per call. An attempt that dies in transport —
    dead proxy, connect timeout — is charged nothing and retried for free, which
    is decision 15's "a flaky proxy is not the User's doing". An attempt that
    came back with a status code, any status code, is charged, because Telegram
    spent the same resources on it that it spends on a 200 (decision 20). The
    two rules meet here rather than at the exit: a 404 satisfies `is_network`
    and so goes round the retry branch up to `NETWORK_FETCH_RETRIES` times, and
    charging once per call would bill eight real round trips as one.
    """
    global _tor_request_counter
    effective_retries = (
        retries if retries is not None else settings.NETWORK_FETCH_RETRIES
    )
    effective_initial_delay_ms = (
        initial_delay_ms
        if initial_delay_ms is not None
        else settings.NETWORK_FETCH_INITIAL_DELAY_MS
    )
    effective_tor_rotation_threshold = (
        tor_rotation_threshold
        if tor_rotation_threshold is not None
        else settings.NETWORK_TOR_ROTATION_THRESHOLD
    )
    tried: set[str] = set()
    telemetry: dict[str, Any] = {"attempts": []}
    start_total = time.time() * 1000
    counts_towards_quota = is_telegram_web_url(url)

    for i in range(effective_retries):
        attempt_start = time.time() * 1000
        proxy_url: str | None = None

        try:
            if proxies:
                async with _proxy_acquire(
                    proxies,
                    tried,
                    proxy_concurrency=proxy_concurrency,
                ) as lane:
                    proxy_url = lane.url
                    pool_client = lane.client
                    is_local_tor = proxy_url and (
                        "127.0.0.1" in proxy_url or "localhost" in proxy_url
                    )
                    if is_local_tor and tor_auto_rotate:
                        async with _tor_counter_lock:
                            _tor_request_counter += 1
                            due = (
                                _tor_request_counter >= effective_tor_rotation_threshold
                            )
                        if due:
                            await rotate_tor_identity(tor_control_port)
                    data = await _fetch_once(
                        url,
                        proxy_url,
                        client=pool_client,
                        method=method,
                        json_body=json_body,
                        binary=binary,
                    )
            else:
                data = await _fetch_once(
                    url, None, method=method, json_body=json_body, binary=binary
                )

            if proxy_url:
                _bad_proxies.pop(proxy_url, None)

            telemetry["attempts"].append(
                {
                    "attempt": i + 1,
                    "proxyUrl": proxy_url or "direct",
                    "success": True,
                    "latency": int(time.time() * 1000 - attempt_start),
                }
            )
            telemetry["totalDuration"] = int(time.time() * 1000 - start_total)
            telemetry["success"] = True
            if counts_towards_quota:
                record_telegram_request()
            return data, telemetry

        except Exception as exc:  # noqa: BLE001
            is_soft_block = isinstance(exc, TelegramWebViewUnavailable)
            is_network = (
                isinstance(exc, (httpx.HTTPError, ConnectionError, OSError))
                or is_soft_block
            )
            is_rate_limit = (
                isinstance(exc, httpx.HTTPStatusError)
                and exc.response.status_code == 429
            )
            # A status code means Telegram answered; a soft-blocked web view is
            # a page it served. Both cost Telegram what a 200 costs it, so both
            # are charged (decision 20). A `TelegramWebViewUnavailable` is a
            # `ConnectionError` subclass, so the obvious `is_network` test files
            # it with the dead proxies — which is why this reads the soft-block
            # flag rather than the exception's base class.
            #
            # Charged here, per attempt, and not once at the exit below. An
            # `HTTPStatusError` satisfies `is_network` (it subclasses
            # `httpx.HTTPError`), so the retry branch takes 404s and 429s round
            # again — up to `NETWORK_FETCH_RETRIES`, which is **8**. A per-call
            # charge would bill one Request for eight round trips Telegram
            # actually served, and would do it worst for the accounts under the
            # most rate-limit pressure, which are the ones generating the most
            # load. See `docs/quota-ledger-plan.md`.
            if counts_towards_quota and (
                isinstance(exc, httpx.HTTPStatusError) or is_soft_block
            ):
                record_telegram_request()

            if proxy_url and is_network and not is_soft_block:
                now_ms = time.time() * 1000
                _prune_expired_cooldowns(now_ms)
                _bad_proxies[proxy_url] = now_ms + settings.NETWORK_PROXY_COOLDOWN_MS

            telemetry["attempts"].append(
                {
                    "attempt": i + 1,
                    "proxyUrl": proxy_url or "direct",
                    "success": False,
                    "error": str(exc),
                    "latency": int(time.time() * 1000 - attempt_start),
                }
            )

            if (
                i < effective_retries - 1
                and not is_soft_block
                and (is_network or is_rate_limit)
            ):
                backoff = (2**i) * effective_initial_delay_ms + random.randint(0, 1000)
                if is_rate_limit:
                    backoff = max(backoff, 10000)
                await asyncio.sleep(backoff / 1000)
                continue

            telemetry["totalDuration"] = int(time.time() * 1000 - start_total)
            telemetry["success"] = False
            cast(Any, exc).telemetry = telemetry
            raise

    raise RuntimeError("fetch_with_retry exhausted retries")


async def test_proxy(proxy_url: str) -> dict[str, Any]:
    start = time.time() * 1000
    try:
        async with _build_client(proxy_url) as client:
            response = await client.get("https://api.ipify.org?format=json")
            response.raise_for_status()
            data = response.json()
            return {
                "success": True,
                "ip": data.get("ip"),
                "latency": int(time.time() * 1000 - start),
                "proxyUrl": proxy_url,
            }
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": str(exc), "proxyUrl": proxy_url}


async def get_tor_ip() -> str:
    proxy = settings.TOR_SOCKS_PROXY
    async with _build_client(proxy) as client:
        response = await client.get("https://api.ipify.org?format=json")
        response.raise_for_status()
        data = response.json()
        ip = data.get("ip")
        if not isinstance(ip, str):
            raise ValueError("Unexpected response from ipify")
        return ip


async def is_port_in_use(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


async def get_tor_status() -> dict[str, Any]:
    socks = await is_port_in_use(9050)
    control = await is_port_in_use(settings.TOR_CONTROL_PORT)
    return {
        "running": socks and control,
        "socksInUse": socks,
        "controlInUse": control,
        "autoSpawned": False,
    }


def parse_telegram_entities(text: str) -> tuple[str, list[dict[str, Any]]]:
    regex = re.compile(
        r"(\*\*(.*?)\*\*)|(\*(.*?)\*)|(_(.*?)_)|"
        r"(\[([a-zA-Z0-9_]+)\s+#(\d+)\])|(\[(.*?)\]\((.*?)\))"
    )
    plain = ""
    entities: list[dict[str, Any]] = []
    last_index = 0

    for match in regex.finditer(text):
        plain += text[last_index : match.start()]
        offset = len(plain)

        if match.group(1):
            inner = match.group(2) or ""
            plain += inner
            entities.append({"type": "bold", "offset": offset, "length": len(inner)})
        elif match.group(3):
            inner = match.group(4) or ""
            plain += inner
            entities.append({"type": "italic", "offset": offset, "length": len(inner)})
        elif match.group(5):
            inner = match.group(6) or ""
            plain += inner
            entities.append({"type": "italic", "offset": offset, "length": len(inner)})
        elif match.group(7):
            channel = match.group(8) or ""
            post_id = match.group(9) or ""
            inner = match.group(7)
            plain += inner
            entities.append(
                {
                    "type": "text_link",
                    "offset": offset,
                    "length": len(inner),
                    "url": telegram_channel_post_url(channel, int(post_id)),
                }
            )
        elif match.group(10):
            inner = match.group(11) or ""
            url = match.group(12) or ""
            plain += inner
            entities.append(
                {
                    "type": "text_link",
                    "offset": offset,
                    "length": len(inner),
                    "url": url,
                }
            )

        last_index = match.end()

    plain += text[last_index:]
    return plain, entities
