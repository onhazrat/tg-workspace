"""Tests for resolve-start-time endpoint and resolver logic."""

from __future__ import annotations

import asyncio
import re
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.scraper import resolve_start_time_to_id

client = TestClient(app)


def _auth_headers() -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

POST_TIMES: dict[int, int] = {
    100: 1_000,
    300: 3_000,
    500: 5_000,
    1000: 8_000,
}


async def _mock_fetch_post_at_url(
    url: str,
    *,
    pick_last: bool,
    **_: object,
) -> dict[str, int] | None:
    del pick_last
    after = re.search(r"after=(\d+)", url)
    if after:
        start_id = int(after.group(1)) + 1
        candidates = [pid for pid in POST_TIMES if pid >= start_id]
        if not candidates:
            return None
        pid = min(candidates)
        return {"id": pid, "time": POST_TIMES[pid]}

    before = re.search(r"before=(\d+)", url)
    if before:
        end_id = int(before.group(1))
        candidates = [pid for pid in POST_TIMES if pid < end_id]
        if not candidates:
            return None
        pid = max(candidates)
        return {"id": pid, "time": POST_TIMES[pid]}

    return None


@pytest.fixture
def mock_resolver_deps() -> tuple[AsyncMock, AsyncMock]:
    channel_info = AsyncMock(
        return_value={"latestId": 1000, "isUnavailableOnWebView": False}
    )
    fetch_post = AsyncMock(side_effect=_mock_fetch_post_at_url)
    return channel_info, fetch_post


def test_resolve_invalid_target_defaults_to_one() -> None:
    start_id = asyncio.run(resolve_start_time_to_id("testchannel", float("nan")))
    assert start_id == 1


def test_resolve_target_newer_than_latest(mock_resolver_deps: tuple[AsyncMock, AsyncMock]) -> None:
    channel_info, fetch_post = mock_resolver_deps

    async def run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", fetch_post),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("testchannel", 9_000)

    assert asyncio.run(run()) == 1000


def test_resolve_target_older_than_oldest(mock_resolver_deps: tuple[AsyncMock, AsyncMock]) -> None:
    channel_info, fetch_post = mock_resolver_deps

    async def run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", fetch_post),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("testchannel", 500)

    assert asyncio.run(run()) == 100


def test_resolve_binary_search_finds_post(mock_resolver_deps: tuple[AsyncMock, AsyncMock]) -> None:
    channel_info, fetch_post = mock_resolver_deps

    async def run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", fetch_post),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("testchannel", 3_000)

    assert asyncio.run(run()) == 300


def test_resolve_no_oldest_post_returns_one() -> None:
    channel_info = AsyncMock(
        return_value={"latestId": 1000, "isUnavailableOnWebView": False}
    )
    fetch_post = AsyncMock(return_value=None)

    async def run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", fetch_post),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("testchannel", 3_000)

    assert asyncio.run(run()) == 1


def test_resolve_unavailable_channel_raises() -> None:
    channel_info = AsyncMock(
        return_value={"latestId": 0, "isUnavailableOnWebView": True}
    )

    async def run() -> None:
        with patch("app.services.scraper.get_channel_info", channel_info):
            with pytest.raises(ValueError, match="not available on the web view"):
                await resolve_start_time_to_id("testchannel", 3_000)

    asyncio.run(run())


def test_api_resolve_start_time_v1(mock_resolver_deps: tuple[AsyncMock, AsyncMock]) -> None:
    channel_info, fetch_post = mock_resolver_deps
    with (
        patch("app.services.scraper.get_channel_info", channel_info),
        patch("app.services.scraper._fetch_post_at_url", fetch_post),
        patch("app.services.scraper.asyncio.sleep", AsyncMock()),
    ):
        response = client.post(
            "/api/v1/telegram/resolve-start-time",
            json={"channelName": "testchannel", "targetTimeMs": 3_000},
            headers=_auth_headers(),
        )
    assert response.status_code == 200
    assert response.json() == {"startId": 300}


def test_api_resolve_start_time_legacy_alias(mock_resolver_deps: tuple[AsyncMock, AsyncMock]) -> None:
    channel_info, fetch_post = mock_resolver_deps
    with (
        patch("app.services.scraper.get_channel_info", channel_info),
        patch("app.services.scraper._fetch_post_at_url", fetch_post),
        patch("app.services.scraper.asyncio.sleep", AsyncMock()),
    ):
        response = client.post(
            "/api/resolve-start-time",
            json={"channelName": "testchannel", "targetTimeMs": 3_000},
            headers=_auth_headers(),
        )
    assert response.status_code == 200
    assert response.json() == {"startId": 300}


def test_api_resolve_start_time_unavailable() -> None:
    channel_info = AsyncMock(
        return_value={"latestId": 0, "isUnavailableOnWebView": True}
    )
    with patch("app.services.scraper.get_channel_info", channel_info):
        response = client.post(
            "/api/v1/telegram/resolve-start-time",
            json={"channelName": "privatechannel", "targetTimeMs": 3_000},
            headers=_auth_headers(),
        )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["isUnavailableOnWebView"] is True
