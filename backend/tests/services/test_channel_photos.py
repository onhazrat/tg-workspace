"""Tests for cached channel avatar storage."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import channel_photos


@pytest.fixture(autouse=True)
def isolated_photo_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(channel_photos.settings, "CHANNEL_PHOTO_DIR", str(tmp_path))


def _mock_http_client() -> MagicMock:
    mock_client_cls = MagicMock()
    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.content = b"fake-image-bytes"
    mock_response.headers = {"content-type": "image/jpeg"}
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client_cls.return_value = mock_client
    return mock_client_cls


def test_cache_and_read_channel_photo() -> None:
    async def _run() -> None:
        with patch(
            "app.services.channel_photos.httpx.AsyncClient",
            _mock_http_client(),
        ):
            cached = await channel_photos.cache_channel_photo(
                "mychannel",
                "https://cdn.example/avatar.jpg",
            )
            assert cached is True
            assert channel_photos.has_cached_photo("mychannel")

            payload = channel_photos.read_cached_photo("mychannel")
            assert payload is not None
            content, content_type = payload
            assert content == b"fake-image-bytes"
            assert content_type == "image/jpeg"

            assert (
                channel_photos.channel_photo_api_path("mychannel")
                == "/api/v1/telegram/channel-photo/mychannel"
            )

    asyncio.run(_run())


def test_resolve_cached_photo_url_returns_api_path() -> None:
    async def _run() -> None:
        with (
            patch(
                "app.services.channel_photos.cache_channel_photo",
                new_callable=AsyncMock,
                return_value=True,
            ),
            patch(
                "app.services.channel_photos.has_cached_photo",
                return_value=True,
            ),
        ):
            url = await channel_photos.resolve_cached_photo_url(
                "mychannel",
                "https://cdn.example/avatar.jpg",
            )
            assert url == "/api/v1/telegram/channel-photo/mychannel"

    asyncio.run(_run())


def test_delete_cached_photo_removes_files() -> None:
    async def _run() -> None:
        with patch(
            "app.services.channel_photos.httpx.AsyncClient",
            _mock_http_client(),
        ):
            await channel_photos.cache_channel_photo(
                "remove-me",
                "https://cdn.example/remove.jpg",
            )
            assert channel_photos.has_cached_photo("remove-me")

            channel_photos.delete_cached_photo("remove-me")
            assert not channel_photos.has_cached_photo("remove-me")

    asyncio.run(_run())
