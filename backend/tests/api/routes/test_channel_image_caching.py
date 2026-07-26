"""Cached avatars and thumbnails must be revalidatable, not re-downloaded.

The Channels tab issues one photo request per visible channel. Those responses
previously carried no caching headers at all, so every reload re-fetched every
avatar in full. They now carry an `ETag` and a `max-age`, which turns a reload
into either no request or a bodiless 304.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.services import channel_photos

PHOTO_URL = f"{settings.API_V1_STR}/telegram/channel-photo"
CHANNEL = "cachingprobe"
IMAGE = b"\xff\xd8\xff\xe0 fake jpeg bytes"


@pytest.fixture
def cached_photo() -> Iterator[None]:
    """Write a real file through the service so the route reads it normally."""
    directory = channel_photos._photo_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{CHANNEL}.jpg"
    path.write_bytes(IMAGE)
    try:
        yield
    finally:
        path.unlink(missing_ok=True)


def test_photo_response_carries_validators(
    client: TestClient, superuser_token_headers: dict[str, str], cached_photo: None
) -> None:
    response = client.get(f"{PHOTO_URL}/{CHANNEL}", headers=superuser_token_headers)

    assert response.status_code == 200
    assert response.content == IMAGE
    assert response.headers["ETag"]
    cache_control = response.headers["Cache-Control"]
    assert f"max-age={settings.CHANNEL_IMAGE_MAX_AGE_SECONDS}" in cache_control


def test_photo_cache_is_private(
    client: TestClient, superuser_token_headers: dict[str, str], cached_photo: None
) -> None:
    """The route is authenticated, so no shared cache may hold the response."""
    response = client.get(f"{PHOTO_URL}/{CHANNEL}", headers=superuser_token_headers)

    assert "private" in response.headers["Cache-Control"]
    assert "public" not in response.headers["Cache-Control"]


def test_matching_etag_returns_304_without_a_body(
    client: TestClient, superuser_token_headers: dict[str, str], cached_photo: None
) -> None:
    first = client.get(f"{PHOTO_URL}/{CHANNEL}", headers=superuser_token_headers)
    etag = first.headers["ETag"]

    second = client.get(
        f"{PHOTO_URL}/{CHANNEL}",
        headers={**superuser_token_headers, "If-None-Match": etag},
    )

    assert second.status_code == 304
    assert second.content == b""


def test_weak_and_multi_valued_if_none_match_still_match(
    client: TestClient, superuser_token_headers: dict[str, str], cached_photo: None
) -> None:
    """A proxy may weaken the validator or send several; both must still hit."""
    etag = client.get(
        f"{PHOTO_URL}/{CHANNEL}", headers=superuser_token_headers
    ).headers["ETag"]

    weak = client.get(
        f"{PHOTO_URL}/{CHANNEL}",
        headers={**superuser_token_headers, "If-None-Match": f"W/{etag}"},
    )
    multi = client.get(
        f"{PHOTO_URL}/{CHANNEL}",
        headers={**superuser_token_headers, "If-None-Match": f'"other", {etag}'},
    )

    assert weak.status_code == 304
    assert multi.status_code == 304


def test_stale_etag_serves_the_current_image(
    client: TestClient, superuser_token_headers: dict[str, str], cached_photo: None
) -> None:
    response = client.get(
        f"{PHOTO_URL}/{CHANNEL}",
        headers={**superuser_token_headers, "If-None-Match": '"stale"'},
    )

    assert response.status_code == 200
    assert response.content == IMAGE


def test_etag_changes_when_the_image_changes(
    client: TestClient, superuser_token_headers: dict[str, str], cached_photo: None
) -> None:
    """A content hash, not a timestamp — a re-fetched avatar must invalidate."""
    original = client.get(
        f"{PHOTO_URL}/{CHANNEL}", headers=superuser_token_headers
    ).headers["ETag"]

    (channel_photos._photo_dir() / f"{CHANNEL}.jpg").write_bytes(IMAGE + b"changed")
    updated = client.get(
        f"{PHOTO_URL}/{CHANNEL}", headers=superuser_token_headers
    ).headers["ETag"]

    assert original != updated


def test_missing_photo_is_still_a_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.get(
        f"{PHOTO_URL}/nosuchchannelphoto", headers=superuser_token_headers
    )

    assert response.status_code == 404
