"""Per-proxy asyncio lane pool for gated HTTP concurrency."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator

import httpx

from app.core.config import settings
from app.services.network_settings import clamp_proxy_concurrency, normalize_proxy_url

PROXY_SLOTS_MIN = 1
PROXY_SLOTS_MAX = 20
ACQUIRE_TIMEOUT_SECONDS = 120.0


class ProxyPoolExhausted(Exception):
    """Raised when no proxy lane slot is available within the wait timeout."""


def clamp_proxy_slots(value: int) -> int:
    return clamp_proxy_concurrency(value)


def build_lane_client(proxy_url: str, max_parallel: int) -> httpx.AsyncClient:
    """One long-lived httpx client per proxy lane (connection reuse)."""
    slots = clamp_proxy_slots(max_parallel)
    return httpx.AsyncClient(
        proxy=normalize_proxy_url(proxy_url),
        timeout=settings.NETWORK_FETCH_TIMEOUT_SECONDS,
        follow_redirects=True,
        limits=httpx.Limits(
            max_connections=slots,
            max_keepalive_connections=slots,
        ),
    )


@dataclass
class ProxyLane:
    url: str
    max_parallel: int
    sem: asyncio.Semaphore
    client: httpx.AsyncClient
    in_use: int = 0


class ProxyPoolManager:
    def __init__(self) -> None:
        self._lanes: dict[str, ProxyLane] = {}
        self._rr_counter = 0
        self._configured_default = 1
        self._configured_overrides: dict[str, int] = {}
        self._pending_closes: list[httpx.AsyncClient] = []

    def _queue_client_close(self, client: httpx.AsyncClient) -> None:
        self._pending_closes.append(client)

    async def flush_pending_closes(self) -> None:
        pending = self._pending_closes
        self._pending_closes = []
        for client in pending:
            await client.aclose()

    def configure(
        self,
        proxies: list[str],
        default_slots: int,
        overrides: dict[str, int],
    ) -> None:
        default_slots = clamp_proxy_slots(default_slots)
        norm_overrides = {
            normalize_proxy_url(k): clamp_proxy_slots(v) for k, v in overrides.items()
        }
        normalized = [normalize_proxy_url(p) for p in proxies]

        if (
            tuple(self._lanes.keys()) == tuple(normalized)
            and self._configured_default == default_slots
            and self._configured_overrides == norm_overrides
        ):
            return

        previous = self._lanes
        new_lanes: dict[str, ProxyLane] = {}
        for url in normalized:
            slots = norm_overrides.get(url, default_slots)
            existing = previous.get(url)
            if existing and existing.max_parallel == slots:
                new_lanes[url] = existing
            else:
                if existing is not None:
                    self._queue_client_close(existing.client)
                new_lanes[url] = ProxyLane(
                    url=url,
                    max_parallel=slots,
                    sem=asyncio.Semaphore(slots),
                    client=build_lane_client(url, slots),
                )

        for url, lane in previous.items():
            if url not in new_lanes:
                self._queue_client_close(lane.client)

        self._lanes = new_lanes
        self._configured_default = default_slots
        self._configured_overrides = norm_overrides

    def _proxy_in_cooldown(self, url: str) -> bool:
        from app.services.network import proxy_in_cooldown

        return proxy_in_cooldown(url)

    def _rank_lanes(self, exclude: set[str]) -> list[ProxyLane]:
        ranked: list[tuple[int, int, ProxyLane]] = []
        for idx, lane in enumerate(self._lanes.values()):
            if lane.url in exclude or self._proxy_in_cooldown(lane.url):
                continue
            free = lane.max_parallel - lane.in_use
            ranked.append((-free, idx, lane))
        ranked.sort()
        return [lane for _, _, lane in ranked]

    @asynccontextmanager
    async def acquire(self, exclude: set[str] | None = None) -> AsyncIterator[ProxyLane]:
        excluded = exclude or set()
        deadline = time.monotonic() + ACQUIRE_TIMEOUT_SECONDS

        while True:
            ranked = self._rank_lanes(excluded)
            if not ranked:
                healthy_any = any(
                    not self._proxy_in_cooldown(lane.url) for lane in self._lanes.values()
                )
                if not healthy_any:
                    raise ProxyPoolExhausted("No healthy proxy lanes available")
                if time.monotonic() >= deadline:
                    raise ProxyPoolExhausted("Timed out waiting for proxy lane slot")
                await asyncio.sleep(0.1)
                continue

            lane = ranked[self._rr_counter % len(ranked)]
            self._rr_counter += 1
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProxyPoolExhausted("Timed out waiting for proxy lane slot")
            try:
                await asyncio.wait_for(lane.sem.acquire(), timeout=remaining)
            except TimeoutError:
                continue

            lane.in_use += 1
            try:
                yield lane
            finally:
                lane.in_use -= 1
                lane.sem.release()
            return

    def lane_client(self, proxy_url: str) -> httpx.AsyncClient | None:
        lane = self._lanes.get(normalize_proxy_url(proxy_url))
        return lane.client if lane else None

    def total_capacity(self) -> int:
        return sum(lane.max_parallel for lane in self._lanes.values())

    def snapshot(self) -> list[dict[str, Any]]:
        return [
            {
                "proxyUrl": lane.url,
                "maxParallel": lane.max_parallel,
                "inUse": lane.in_use,
                "inCooldown": self._proxy_in_cooldown(lane.url),
            }
            for lane in self._lanes.values()
        ]


_pool = ProxyPoolManager()
_pool_lock = asyncio.Lock()


def get_proxy_pool() -> ProxyPoolManager:
    return _pool


async def ensure_pool_configured(
    proxies: list[str],
    default_slots: int,
    overrides: dict[str, int],
) -> ProxyPoolManager:
    pool = get_proxy_pool()
    async with _pool_lock:
        pool.configure(proxies, default_slots, overrides)
        await pool.flush_pending_closes()
    return pool


def configure_proxy_pool(
    proxies: list[str],
    default_slots: int,
    overrides: dict[str, int],
) -> ProxyPoolManager:
    """Synchronous configure for diagnostics (runtime-config snapshots)."""
    pool = get_proxy_pool()
    pool.configure(proxies, default_slots, overrides)
    return pool
