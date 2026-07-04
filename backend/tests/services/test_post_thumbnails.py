"""Tests for cached post thumbnail storage."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import post_thumbnails


@pytest.fixture(autouse=True)
def isolated_thumb_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(post_thumbnails.settings, "POST_THUMB_DIR", str(tmp_path))


def _mock_http_client() -> MagicMock:
    mock_client_cls = MagicMock()
    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.content = b"fake-thumb-bytes"
    mock_response.headers = {"content-type": "image/jpeg"}
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client_cls.return_value = mock_client
    return mock_client_cls


def test_cache_and_read_post_thumb() -> None:
    async def _run() -> None:
        with patch(
            "app.services.post_thumbnails.httpx.AsyncClient",
            _mock_http_client(),
        ):
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
        with patch(
            "app.services.post_thumbnails.httpx.AsyncClient",
            _mock_http_client(),
        ):
            await post_thumbnails.cache_post_thumb(
                "channel",
                99,
                "https://cdn.example/remove.jpg",
            )
            assert post_thumbnails.has_cached_thumb("channel", 99)

            post_thumbnails.delete_cached_thumb("channel", 99)
            assert not post_thumbnails.has_cached_thumb("channel", 99)

    asyncio.run(_run())
