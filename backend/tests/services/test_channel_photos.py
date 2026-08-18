"""Tests for cached channel avatar storage."""

from __future__ import annotations

import asyncio
import os
import time
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


def test_delete_cached_photo_removes_the_meta_sidecar(tmp_path) -> None:
    """The glob this replaced matched `.meta.json` too; the explicit list must."""
    directory = channel_photos._photo_dir()
    (directory / "orphan-meta.jpg").write_bytes(b"x")
    (directory / "orphan-meta.meta.json").write_text("{}", encoding="utf-8")

    channel_photos.delete_cached_photo("orphan-meta")

    assert list(directory.iterdir()) == []


def _touch(directory, stem: str, *, age_days: float) -> None:
    for name in (f"{stem}.jpg", f"{stem}.meta.json"):
        path = directory / name
        path.write_bytes(b"x")
        old = time.time() - age_days * 24 * 60 * 60
        os.utime(path, (old, old))


def test_prune_keeps_referenced_photos_however_old() -> None:
    directory = channel_photos._photo_dir()
    _touch(directory, "live", age_days=999)

    removed = channel_photos.prune_orphaned_photos({"live"}, max_age_days=30)

    assert removed == 0
    assert channel_photos.has_cached_photo("live")


def test_prune_removes_old_unreferenced_photos_with_their_meta() -> None:
    directory = channel_photos._photo_dir()
    _touch(directory, "gone", age_days=90)

    removed = channel_photos.prune_orphaned_photos(set(), max_age_days=30)

    assert removed == 2
    assert list(directory.iterdir()) == []


def test_prune_spares_recently_probed_candidates() -> None:
    """Discover caches an avatar before the channel row exists.

    Without the age floor the sweep would strip avatars off a report the
    operator is still looking at.
    """
    directory = channel_photos._photo_dir()
    _touch(directory, "just-probed", age_days=1)

    removed = channel_photos.prune_orphaned_photos(set(), max_age_days=30)

    assert removed == 0
    assert channel_photos.has_cached_photo("just-probed")


def test_prune_is_disabled_by_a_zero_window() -> None:
    directory = channel_photos._photo_dir()
    _touch(directory, "ancient", age_days=9999)

    assert channel_photos.prune_orphaned_photos(set(), max_age_days=0) == 0
    assert channel_photos.has_cached_photo("ancient")
