"""Tests for proxy lane pool."""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest

from app.services.network import _bad_proxies, proxy_in_cooldown
from app.services.network_settings import (
    compute_proxy_pool_capacity,
    normalize_proxy_url,
)
from app.services.proxy_pool import (
    ProxyPoolExhausted,
    ProxyPoolManager,
    build_lane_client,
    configure_proxy_pool,
    get_proxy_pool,
)


@pytest.fixture(autouse=True)
def _clear_bad_proxies() -> None:
    _bad_proxies.clear()
    yield
    _bad_proxies.clear()


@pytest.fixture
def pool() -> ProxyPoolManager:
    manager = ProxyPoolManager()
    yield manager
    manager.configure([], 1, {})
    asyncio.run(manager.flush_pending_closes())


def _cleanup_singleton_pool() -> None:
    singleton = get_proxy_pool()
    singleton.configure([], 1, {})
    asyncio.run(singleton.flush_pending_closes())


def test_lane_with_one_slot_allows_single_acquire(pool: ProxyPoolManager) -> None:
    pool.configure(["http://proxy-a:8080"], 1, {})
    second_acquired = asyncio.Event()

    async def hold() -> None:
        async with pool.acquire():
            await asyncio.sleep(0.2)

    async def try_second() -> None:
        await asyncio.sleep(0.05)
        async with pool.acquire():
            second_acquired.set()

    async def run() -> None:
        task1 = asyncio.create_task(hold())
        task2 = asyncio.create_task(try_second())
        await asyncio.wait_for(task1, timeout=1.0)
        await asyncio.wait_for(task2, timeout=1.0)

    asyncio.run(run())
    assert second_acquired.is_set()


def test_lane_with_three_slots_allows_three_concurrent(pool: ProxyPoolManager) -> None:
    pool.configure(["http://proxy-b:8080"], 3, {})
    active = 0
    peak = 0
    lock = asyncio.Lock()

    async def worker() -> None:
        nonlocal active, peak
        async with pool.acquire():
            async with lock:
                active += 1
                peak = max(peak, active)
            await asyncio.sleep(0.1)
            async with lock:
                active -= 1

    async def run() -> None:
        await asyncio.gather(*(worker() for _ in range(3)))

    asyncio.run(run())
    assert peak == 3


def test_overrides_beat_default(pool: ProxyPoolManager) -> None:
    url = "http://proxy-c:8080"
    norm = normalize_proxy_url(url)
    pool.configure([url], 1, {norm: 2})
    lane = pool._lanes[norm]
    assert lane.max_parallel == 2


def test_lane_client_is_reused_per_lane(pool: ProxyPoolManager) -> None:
    url = "http://proxy-limits:8080"
    pool.configure([url], 3, {})
    lane = pool._lanes[normalize_proxy_url(url)]
    assert lane.max_parallel == 3
    assert isinstance(lane.client, httpx.AsyncClient)


def test_configure_reuses_client_when_unchanged(pool: ProxyPoolManager) -> None:
    url = "http://proxy-reuse:8080"
    pool.configure([url], 2, {})
    client_before = pool._lanes[normalize_proxy_url(url)].client
    pool.configure([url], 2, {})
    client_after = pool._lanes[normalize_proxy_url(url)].client
    assert client_before is client_after


def test_configure_replaces_client_when_slots_change(pool: ProxyPoolManager) -> None:
    url = "http://proxy-replace:8080"
    norm = normalize_proxy_url(url)
    pool.configure([url], 1, {})
    old_client = pool._lanes[norm].client
    pool.configure([url], 3, {})
    new_client = pool._lanes[norm].client
    assert old_client is not new_client
    assert pool._lanes[norm].max_parallel == 3
    assert len(pool._pending_closes) == 1
    asyncio.run(pool.flush_pending_closes())


def test_compute_proxy_pool_capacity_sums_slots() -> None:
    proxies = ["http://a:1", "http://b:2"]
    overrides = {normalize_proxy_url("http://a:1"): 3}
    assert compute_proxy_pool_capacity(proxies, 1, overrides) == 4


def test_cooldown_proxy_excluded_from_acquire(pool: ProxyPoolManager) -> None:
    url = "http://proxy-d:8080"
    pool.configure([url], 1, {})
    _bad_proxies[url] = time.time() * 1000 + 60_000
    assert proxy_in_cooldown(url) is True

    async def run() -> None:
        with pytest.raises(ProxyPoolExhausted, match="No healthy proxy"):
            async with pool.acquire():
                pass

    asyncio.run(run())


def test_acquire_releases_slot_on_exit(pool: ProxyPoolManager) -> None:
    async def run() -> None:
        async with pool.acquire():
            pass
        async with pool.acquire() as lane:
            assert lane.url == "http://proxy-e:8080"
            assert lane.client is not None

    pool.configure(["http://proxy-e:8080"], 1, {})
    asyncio.run(run())


def test_configure_proxy_pool_updates_singleton() -> None:
    try:
        configure_proxy_pool(["http://proxy-f:8080"], 2, {})
        assert get_proxy_pool().total_capacity() == 2
    finally:
        _cleanup_singleton_pool()


def test_fetch_with_retry_respects_pool_concurrency(monkeypatch) -> None:
    from app.services import network

    in_flight: dict[str, int] = {}
    peak = 0
    lock = asyncio.Lock()
    seen_clients: list[httpx.AsyncClient] = []

    async def slow_fetch(
        url: str,
        proxy_url: str | None,
        *,
        client: httpx.AsyncClient | None = None,
        method: str = "GET",
        json_body: dict | None = None,
        binary: bool = False,
    ) -> str:
        nonlocal peak
        assert proxy_url is not None
        assert client is not None
        seen_clients.append(client)
        async with lock:
            in_flight[proxy_url] = in_flight.get(proxy_url, 0) + 1
            peak = max(peak, in_flight[proxy_url])
        await asyncio.sleep(0.08)
        async with lock:
            in_flight[proxy_url] -= 1
        return "<html></html>"

    monkeypatch.setattr(network, "_fetch_once", slow_fetch)
    proxies = ["http://pool-test:8080"]
    norm = normalize_proxy_url(proxies[0])

    async def run() -> None:
        await asyncio.gather(
            *(
                network.fetch_with_retry(
                    "https://t.me/s/test",
                    proxies=proxies,
                    proxy_concurrency=(1, {}),
                    retries=1,
                )
                for _ in range(4)
            )
        )

    try:
        asyncio.run(run())
        assert peak == 1
        assert norm in get_proxy_pool()._lanes
        assert len({id(c) for c in seen_clients}) == 1
    finally:
        _cleanup_singleton_pool()


def test_build_lane_client_returns_async_client() -> None:
    client = build_lane_client("http://user:pass@proxy.example:8080", 2)
    try:
        assert isinstance(client, httpx.AsyncClient)
    finally:
        asyncio.run(client.aclose())
