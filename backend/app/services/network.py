"""HTTP client with proxy rotation, Tor support, and telemetry."""

from __future__ import annotations

import asyncio
import random
import re
import time
from typing import Any

import httpx
from stem import Signal
from stem.control import Controller

from app.core.config import settings

_bad_proxies: dict[str, float] = {}
_tor_request_counter = 0
_is_rotating_tor = False


def get_bad_proxies() -> list[dict[str, Any]]:
    now = time.time() * 1000
    return [
        {
            "url": url,
            "cooldownRemaining": max(0, int((cooldown_until - now) / 1000)),
        }
        for url, cooldown_until in _bad_proxies.items()
        if now < cooldown_until
    ]


def _normalize_proxy_url(proxy_url: str) -> str:
    url = proxy_url.strip()
    if "://" not in url:
        if "127.0.0.1" in url or "localhost" in url:
            url = f"socks5h://{url}"
        else:
            url = f"http://{url}"
    if url.startswith("socks5://"):
        url = url.replace("socks5://", "socks5h://", 1)
    return url


def _build_client(proxy_url: str | None) -> httpx.AsyncClient:
    kwargs: dict[str, Any] = {
        "timeout": settings.NETWORK_FETCH_TIMEOUT_SECONDS,
        "follow_redirects": True,
    }
    if proxy_url:
        kwargs["proxy"] = _normalize_proxy_url(proxy_url)
    return httpx.AsyncClient(**kwargs)


async def rotate_tor_identity(control_port: int | None = None, password: str | None = None) -> None:
    global _is_rotating_tor, _tor_request_counter
    if _is_rotating_tor:
        return
    _is_rotating_tor = True
    port = control_port or settings.TOR_CONTROL_PORT
    pwd = password or settings.TOR_CONTROL_PASSWORD or ""
    try:
        with Controller.from_port(port=port) as controller:
            if pwd:
                controller.authenticate(password=pwd)
            else:
                controller.authenticate()
            controller.signal(Signal.NEWNYM)
        _tor_request_counter = 0
        await asyncio.sleep(2)
    finally:
        _is_rotating_tor = False


async def fetch_with_retry(
    url: str,
    *,
    retries: int | None = None,
    initial_delay_ms: int | None = None,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int | None = None,
    tor_control_port: int | None = None,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
) -> tuple[Any, dict[str, Any]]:
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

    for i in range(effective_retries):
        attempt_start = time.time() * 1000
        now = time.time() * 1000
        proxy_url: str | None = None

        if proxies:
            available = [
                p
                for p in proxies
                if p not in tried
                and (_bad_proxies.get(p, 0) <= now)
            ]
            pool = available or [p for p in proxies if _bad_proxies.get(p, 0) <= now] or proxies
            proxy_url = random.choice(pool)
            tried.add(proxy_url)

        is_local_tor = proxy_url and ("127.0.0.1" in proxy_url or "localhost" in proxy_url)
        if is_local_tor and tor_auto_rotate:
            _tor_request_counter += 1
            if _tor_request_counter >= effective_tor_rotation_threshold:
                await rotate_tor_identity(tor_control_port)

        try:
            async with _build_client(proxy_url) as client:
                if method == "POST":
                    response = await client.post(url, json=json_body)
                else:
                    response = await client.get(url)
                response.raise_for_status()
                data = response.text if "t.me" in url else response.json()

            if isinstance(data, str) and "t.me/s/" in url:
                has_action = "tgme_page_action" in data
                has_widgets = "tgme_widget_message_date" in data
                if has_action and not has_widgets:
                    raise ConnectionError("Channel is not available on the web view.")

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
            return data, telemetry

        except Exception as exc:  # noqa: BLE001
            is_soft_block = "not available on the web view" in str(exc)
            is_network = isinstance(exc, (httpx.HTTPError, ConnectionError, OSError)) or is_soft_block
            is_rate_limit = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429

            if proxy_url and is_network and not is_soft_block:
                _bad_proxies[proxy_url] = (
                    time.time() * 1000 + settings.NETWORK_PROXY_COOLDOWN_MS
                )

            telemetry["attempts"].append(
                {
                    "attempt": i + 1,
                    "proxyUrl": proxy_url or "direct",
                    "success": False,
                    "error": str(exc),
                    "latency": int(time.time() * 1000 - attempt_start),
                }
            )

            if i < effective_retries - 1 and (is_network or is_rate_limit):
                backoff = (2**i) * effective_initial_delay_ms + random.randint(0, 1000)
                if is_rate_limit:
                    backoff = max(backoff, 10000)
                await asyncio.sleep(backoff / 1000)
                continue

            telemetry["totalDuration"] = int(time.time() * 1000 - start_total)
            telemetry["success"] = False
            exc.telemetry = telemetry  # type: ignore[attr-defined]
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
        return response.json()["ip"]


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
                    "url": f"https://t.me/{channel}/{post_id}",
                }
            )
        elif match.group(10):
            inner = match.group(11) or ""
            url = match.group(12) or ""
            plain += inner
            entities.append(
                {"type": "text_link", "offset": offset, "length": len(inner), "url": url}
            )

        last_index = match.end()

    plain += text[last_index:]
    return plain, entities
