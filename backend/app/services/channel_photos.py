"""Cache Telegram channel avatar images on disk and serve via API."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_META_SUFFIX = ".meta.json"
_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _resolve_photo_dir() -> Path:
    configured = Path(settings.CHANNEL_PHOTO_DIR)
    if configured.is_absolute():
        return configured
    backend_root = Path(__file__).resolve().parents[2]
    return backend_root.parent / configured


def _photo_dir() -> Path:
    root = _resolve_photo_dir()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_channel_id(channel_id: str) -> str:
    return re.sub(r"[^\w.-]", "_", channel_id)


def channel_photo_api_path(channel_id: str) -> str:
    return f"{settings.API_V1_STR}/telegram/channel-photo/{channel_id}"


def is_remote_photo_url(url: str | None) -> bool:
    return bool(url and url.startswith("http"))


def has_cached_photo(channel_id: str) -> bool:
    return _find_image_path(channel_id) is not None


def _meta_path(channel_id: str) -> Path:
    return _photo_dir() / f"{_safe_channel_id(channel_id)}{_META_SUFFIX}"


def _read_meta(channel_id: str) -> dict[str, Any] | None:
    path = _meta_path(channel_id)
    if not path.is_file():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(parsed, dict):
            return parsed
        return None
    except json.JSONDecodeError, OSError:
        return None


def _find_image_path(channel_id: str) -> Path | None:
    safe = _safe_channel_id(channel_id)
    directory = _photo_dir()
    for path in directory.glob(f"{safe}.*"):
        if path.name.endswith(_META_SUFFIX):
            continue
        if path.is_file():
            return path
    return None


def read_cached_photo(channel_id: str) -> tuple[bytes, str] | None:
    image_path = _find_image_path(channel_id)
    if not image_path:
        return None
    meta = _read_meta(channel_id)
    content_type = (meta or {}).get("contentType", "image/jpeg")
    try:
        return image_path.read_bytes(), content_type
    except OSError:
        return None


def delete_cached_photo(channel_id: str) -> None:
    safe = _safe_channel_id(channel_id)
    directory = _photo_dir()
    for path in directory.glob(f"{safe}.*"):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to delete channel photo file %s", path)


async def cache_channel_photo(
    channel_id: str,
    source_url: str,
    *,
    force: bool = False,
) -> bool:
    if not is_remote_photo_url(source_url):
        return has_cached_photo(channel_id)

    if not force:
        meta = _read_meta(channel_id)
        if (
            meta
            and meta.get("sourceUrl") == source_url
            and has_cached_photo(channel_id)
        ):
            return True

    try:
        async with httpx.AsyncClient(
            timeout=settings.NETWORK_FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
        ) as client:
            response = await client.get(
                source_url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; TGSummarizer/1.0)"},
            )
            response.raise_for_status()
            content = response.content
            content_type = (
                response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Failed to download channel photo for %s from %s: %s",
            channel_id,
            source_url,
            exc,
        )
        return has_cached_photo(channel_id)

    if not content:
        return has_cached_photo(channel_id)

    ext = _EXT_BY_CONTENT_TYPE.get(content_type.lower(), ".jpg")
    safe = _safe_channel_id(channel_id)
    directory = _photo_dir()

    for path in directory.glob(f"{safe}.*"):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    image_path = directory / f"{safe}{ext}"
    image_path.write_bytes(content)
    _meta_path(channel_id).write_text(
        json.dumps({"sourceUrl": source_url, "contentType": content_type}),
        encoding="utf-8",
    )
    return True


async def resolve_cached_photo_url(
    channel_id: str,
    photo_url: str | None,
) -> str:
    if photo_url is not None and is_remote_photo_url(photo_url):
        await cache_channel_photo(channel_id, photo_url)
    if has_cached_photo(channel_id):
        return channel_photo_api_path(channel_id)
    return photo_url or ""
