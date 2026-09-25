"""Tests for resolve-start-time endpoint and resolver logic."""

from __future__ import annotations

import asyncio
import re
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.scraper import (
    _fetch_post_at_url,
    _post_time_ms,
    resolve_start_time_to_id,
)
from app.services.telegram_web import TelegramWebViewUnavailable

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


def test_resolve_target_newer_than_latest(
    mock_resolver_deps: tuple[AsyncMock, AsyncMock],
) -> None:
    channel_info, fetch_post = mock_resolver_deps

    async def run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", fetch_post),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("testchannel", 9_000)

    assert asyncio.run(run()) == 1000


def test_resolve_target_older_than_oldest(
    mock_resolver_deps: tuple[AsyncMock, AsyncMock],
) -> None:
    channel_info, fetch_post = mock_resolver_deps

    async def run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", fetch_post),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("testchannel", 500)

    assert asyncio.run(run()) == 100


def test_resolve_binary_search_finds_post(
    mock_resolver_deps: tuple[AsyncMock, AsyncMock],
) -> None:
    channel_info, fetch_post = mock_resolver_deps

    async def run() -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch("app.services.scraper._fetch_post_at_url", fetch_post),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("testchannel", 3_000)

    assert asyncio.run(run()) == 300


def test_resolve_last_week_ms_not_low_post_ids() -> None:
    """Regression: ms 'last week' target must not collapse to post IDs 1-5."""
    channel_info = AsyncMock(
        return_value={"latestId": 9500, "isUnavailableOnWebView": False}
    )
    post_times_ms = {
        2: 1_650_000_000_000,
        8000: 1_700_050_000_000,
        9500: 1_701_000_000_000,
    }

    async def fetch(url: str, *, pick_last: bool, **_: object) -> dict[str, int] | None:
        del pick_last
        after = re.search(r"after=(\d+)", url)
        if after:
            start_id = int(after.group(1)) + 1
            candidates = [pid for pid in post_times_ms if pid >= start_id]
            if not candidates:
                return None
            pid = min(candidates)
            return {"id": pid, "time": post_times_ms[pid]}
        before = re.search(r"before=(\d+)", url)
        if before:
            end_id = int(before.group(1))
            candidates = [pid for pid in post_times_ms if pid < end_id]
            if not candidates:
                return None
            pid = max(candidates)
            return {"id": pid, "time": post_times_ms[pid]}
        return None

    last_week_ms = 1_700_000_000_000

    async def run(target_ms: int) -> int:
        with (
            patch("app.services.scraper.get_channel_info", channel_info),
            patch(
                "app.services.scraper._fetch_post_at_url", AsyncMock(side_effect=fetch)
            ),
            patch("app.services.scraper.asyncio.sleep", AsyncMock()),
        ):
            return await resolve_start_time_to_id("activechannel", target_ms)

    assert asyncio.run(run(0)) == 2
    resolved = asyncio.run(run(last_week_ms))
    assert resolved > 5
    assert resolved == 8000


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
            with pytest.raises(
                TelegramWebViewUnavailable, match="not available on the web view"
            ):
                await resolve_start_time_to_id("testchannel", 3_000)

    asyncio.run(run())


def test_api_resolve_start_time_v1(
    mock_resolver_deps: tuple[AsyncMock, AsyncMock],
) -> None:
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


# The `/api/resolve-start-time` alias case that used to live here went with the
# legacy router in E2; `tests/api/test_api_version_boundary.py` now asserts the
# unversioned path is unrouted.


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


# The probe every bisection step above stands in for. The tests above stub it
# whole, so its two decisions (which end of the page, and what a post's time
# is) had no test of their own.


@pytest.mark.parametrize(
    ("post", "expected"),
    [
        pytest.param({"date": "1970-01-01T00:00:01Z"}, 1_000, id="iso-utc"),
        pytest.param({"date": "1970-01-01T01:00:01+01:00"}, 1_000, id="iso-offset"),
        pytest.param(
            {"date": "not a date", "timestamp": 5_000}, 5_000, id="bad-date-falls-back"
        ),
        pytest.param({"date": "", "timestamp": 7_000.9}, 7_000, id="float-timestamp"),
        pytest.param({"timestamp": 0}, None, id="zero-timestamp"),
        pytest.param({"timestamp": "123"}, None, id="string-timestamp"),
        pytest.param({}, None, id="nothing"),
    ],
)
def test_a_post_time_prefers_the_date_and_rejects_what_is_not_a_time(
    post: dict[str, object], expected: int | None
) -> None:
    assert _post_time_ms(post) == expected


def _probe(
    scraped: dict[str, object] | Exception, *, pick_last: bool
) -> tuple[dict[str, int] | None, AsyncMock]:
    scrape = (
        AsyncMock(side_effect=scraped)
        if isinstance(scraped, Exception)
        else AsyncMock(return_value=scraped)
    )
    with patch("app.services.scraper.scrape_channel", scrape):
        found = asyncio.run(
            _fetch_post_at_url(
                "https://t.me/s/c?after=9", pick_last=pick_last, known_latest_id=77
            )
        )
    return found, scrape


_PAGE = {
    "posts": [
        {"id": "10", "timestamp": 1_000},
        {"id": "11", "timestamp": 2_000},
    ]
}


@pytest.mark.parametrize(
    ("pick_last", "expected"),
    [(False, {"id": 10, "time": 1_000}), (True, {"id": 11, "time": 2_000})],
)
def test_a_probe_takes_the_end_of_the_page_it_was_asked_for(
    pick_last: bool, expected: dict[str, int]
) -> None:
    """ "At or after" wants the first post of an `after=` page and "at or
    before" the last of a `before=` page; swapping them makes the bisection
    converge on the wrong neighbour.

    **Mutation:** invert `pick_last` and both cases go red.
    """
    found, scrape = _probe(_PAGE, pick_last=pick_last)

    assert found == expected
    # Passed through so the scraper skips the channel-page fetch per probe.
    assert scrape.await_args is not None
    assert scrape.await_args.kwargs["known_latest_id"] == 77


@pytest.mark.parametrize(
    "scraped",
    [
        pytest.param({"posts": []}, id="empty-page"),
        pytest.param({}, id="no-posts-key"),
        pytest.param({"posts": [{"id": 3}]}, id="post-without-a-time"),
        pytest.param(RuntimeError("proxy died"), id="scrape-raised"),
    ],
)
def test_a_probe_that_finds_no_dated_post_answers_none(
    scraped: dict[str, object] | Exception,
) -> None:
    """None is what the bisection reads as "nothing here", so a raised scrape
    must become None rather than abort the whole resolve."""
    found, _ = _probe(scraped, pick_last=False)

    assert found is None
