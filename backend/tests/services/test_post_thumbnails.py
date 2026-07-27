"""Tests for cached post thumbnail storage."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.services import post_thumbnails


@pytest.fixture(autouse=True)
def isolated_thumb_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(post_thumbnails.settings, "POST_THUMB_DIR", str(tmp_path))


def _mock_fetch(
    content: bytes = b"fake-thumb-bytes", content_type: str = "image/jpeg"
) -> AsyncMock:
    """Stand in for `fetch_with_retry(..., binary=True)`."""
    return AsyncMock(return_value=((content, content_type), {"success": True}))


def test_cache_and_read_post_thumb() -> None:
    async def _run() -> None:
        with patch("app.services.post_thumbnails.fetch_with_retry", _mock_fetch()):
            cached = await post_thumbnails.cache_post_thumb(
                "durov",
                522,
                "https://cdn.example/thumb.jpg",
            )
            assert cached is True
            assert post_thumbnails.has_cached_thumb("durov", 522)

            payload = post_thumbnails.read_cached_thumb("durov", 522)
            assert payload is not None
            content, content_type = payload
            assert content == b"fake-thumb-bytes"
            assert content_type == "image/jpeg"

            assert (
                post_thumbnails.post_thumb_api_path("durov", 522)
                == "/api/v1/telegram/post-thumb/durov/522"
            )

    asyncio.run(_run())


def test_download_travels_the_configured_proxy_lane() -> None:
    """Thumbnails must not egress directly while pages go through Tor."""
    fetch = _mock_fetch()

    async def _run() -> None:
        with patch("app.services.post_thumbnails.fetch_with_retry", fetch):
            await post_thumbnails.cache_post_thumb(
                "durov",
                1,
                "https://cdn.example/thumb.jpg",
                proxies=["socks5://127.0.0.1:9050"],
                proxy_concurrency=(2, {}),
                tor_auto_rotate=True,
                tor_rotation_threshold=10,
            )

    asyncio.run(_run())
    kwargs = fetch.await_args.kwargs
    assert kwargs["proxies"] == ["socks5://127.0.0.1:9050"]
    assert kwargs["proxy_concurrency"] == (2, {})
    assert kwargs["tor_auto_rotate"] is True
    assert kwargs["binary"] is True


def test_oversized_download_is_not_written() -> None:
    oversized = b"x" * (post_thumbnails._MAX_THUMB_BYTES + 1)

    async def _run() -> None:
        with patch(
            "app.services.post_thumbnails.fetch_with_retry", _mock_fetch(oversized)
        ):
            cached = await post_thumbnails.cache_post_thumb(
                "durov", 7, "https://cdn.example/huge.jpg"
            )
            assert cached is False

    asyncio.run(_run())
    assert not post_thumbnails.has_cached_thumb("durov", 7)


def test_write_failure_is_reported_not_raised() -> None:
    """Callers gather with return_exceptions=True, so this must not escape."""

    async def _run() -> None:
        with (
            patch("app.services.post_thumbnails.fetch_with_retry", _mock_fetch()),
            patch(
                "app.services.post_thumbnails._write_atomic",
                side_effect=OSError("No space left on device"),
            ),
        ):
            cached = await post_thumbnails.cache_post_thumb(
                "durov", 8, "https://cdn.example/thumb.jpg"
            )
            assert cached is False

    asyncio.run(_run())


def test_download_failure_keeps_any_existing_thumb() -> None:
    async def _run() -> None:
        with patch("app.services.post_thumbnails.fetch_with_retry", _mock_fetch()):
            await post_thumbnails.cache_post_thumb(
                "durov", 9, "https://cdn.example/a.jpg"
            )
        failing: Any = AsyncMock(side_effect=ConnectionError("boom"))
        with patch("app.services.post_thumbnails.fetch_with_retry", failing):
            cached = await post_thumbnails.cache_post_thumb(
                "durov", 9, "https://cdn.example/b.jpg", force=True
            )
            assert cached is True

    asyncio.run(_run())


def test_no_temp_files_left_behind() -> None:
    async def _run() -> None:
        with patch("app.services.post_thumbnails.fetch_with_retry", _mock_fetch()):
            await post_thumbnails.cache_post_thumb(
                "durov", 10, "https://cdn.example/thumb.jpg"
            )

    asyncio.run(_run())
    leftovers = list(post_thumbnails._thumb_dir().glob("*.tmp"))
    assert leftovers == []


def test_content_type_falls_back_to_the_file_extension() -> None:
    """A missing or unreadable meta file must not mislabel a png as jpeg."""

    async def _run() -> None:
        with patch(
            "app.services.post_thumbnails.fetch_with_retry",
            _mock_fetch(b"png-bytes", "image/png"),
        ):
            await post_thumbnails.cache_post_thumb(
                "durov", 11, "https://cdn.example/thumb.png"
            )

    asyncio.run(_run())
    post_thumbnails._meta_path("durov", 11).unlink()

    payload = post_thumbnails.read_cached_thumb("durov", 11)
    assert payload is not None
    assert payload[1] == "image/png"


def test_enforce_thumb_cache_size_limit(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(post_thumbnails.settings, "POST_THUMB_DIR", str(tmp_path))
    safe = post_thumbnails._safe_key("durov", 1)
    directory = post_thumbnails._thumb_dir()
    image_path = directory / f"{safe}.jpg"
    image_path.write_bytes(b"x" * (2 * 1024 * 1024))
    post_thumbnails._meta_path("durov", 1).write_text("{}", encoding="utf-8")

    freed = post_thumbnails.enforce_thumb_cache_size_limit(1)
    assert freed > 0
    assert not post_thumbnails.has_cached_thumb("durov", 1)


def test_delete_cached_thumb_removes_files() -> None:
    async def _run() -> None:
        with patch("app.services.post_thumbnails.fetch_with_retry", _mock_fetch()):
            await post_thumbnails.cache_post_thumb(
                "channel",
                99,
                "https://cdn.example/remove.jpg",
            )
            assert post_thumbnails.has_cached_thumb("channel", 99)

            post_thumbnails.delete_cached_thumb("channel", 99)
            assert not post_thumbnails.has_cached_thumb("channel", 99)

    asyncio.run(_run())
