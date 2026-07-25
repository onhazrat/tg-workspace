"""Cache Telegram post photo/video thumbnails on disk and serve via API."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, cast

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_META_SUFFIX = ".meta.json"
_ENFORCE_MIN_INTERVAL_SECONDS = 300
_last_enforce_lock = threading.Lock()
_last_enforce_at = 0.0
_thumb_dir_ready = False
_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_DEFAULT_EXT = ".jpg"
# Every extension cache_post_thumb can write: the content-type map plus the
# fallback used for unrecognised types. Checking these directly avoids a
# directory-wide glob per lookup.
_IMAGE_EXTS: tuple[str, ...] = (
    _DEFAULT_EXT,
    *sorted(set(_EXT_BY_CONTENT_TYPE.values()) - {_DEFAULT_EXT}),
)


def _resolve_thumb_dir() -> Path:
    configured = Path(settings.POST_THUMB_DIR)
    if configured.is_absolute():
        return configured
    backend_root = Path(__file__).resolve().parents[2]
    return backend_root.parent / configured


def _thumb_dir() -> Path:
    global _thumb_dir_ready
    root = _resolve_thumb_dir()
    if not _thumb_dir_ready:
        root.mkdir(parents=True, exist_ok=True)
        _thumb_dir_ready = True
    return root


def _safe_key(channel_name: str, post_id: int) -> str:
    safe_channel = re.sub(r"[^\w.-]", "_", channel_name)
    return f"{safe_channel}_{post_id}"


def post_thumb_api_path(channel_name: str, post_id: int) -> str:
    return f"{settings.API_V1_STR}/telegram/post-thumb/{channel_name}/{post_id}"


def is_remote_thumb_url(url: str | None) -> bool:
    return bool(url and url.startswith("http"))


def has_cached_thumb(channel_name: str, post_id: int) -> bool:
    return _find_image_path(channel_name, post_id) is not None


def _meta_path(channel_name: str, post_id: int) -> Path:
    return _thumb_dir() / f"{_safe_key(channel_name, post_id)}{_META_SUFFIX}"


def _read_meta(channel_name: str, post_id: int) -> dict[str, Any] | None:
    path = _meta_path(channel_name, post_id)
    if not path.is_file():
        return None
    try:
        return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError, OSError:
        return None


def _find_image_path(channel_name: str, post_id: int) -> Path | None:
    """Locate a cached thumb by probing known extensions.

    A glob here would scandir the whole cache directory on every call, which
    grows into the dominant sync cost once the cache holds tens of thousands
    of files. Only _IMAGE_EXTS can ever be written, so probe those directly.
    """
    safe = _safe_key(channel_name, post_id)
    directory = _thumb_dir()
    for ext in _IMAGE_EXTS:
        path = directory / f"{safe}{ext}"
        if path.is_file():
            return path
    return None


def read_cached_thumb(channel_name: str, post_id: int) -> tuple[bytes, str] | None:
    image_path = _find_image_path(channel_name, post_id)
    if not image_path:
        return None
    meta = _read_meta(channel_name, post_id)
    content_type = (meta or {}).get("contentType", "image/jpeg")
    try:
        return image_path.read_bytes(), content_type
    except OSError:
        return None


def delete_cached_thumb(channel_name: str, post_id: int) -> None:
    safe = _safe_key(channel_name, post_id)
    directory = _thumb_dir()
    for suffix in (*_IMAGE_EXTS, _META_SUFFIX):
        path = directory / f"{safe}{suffix}"
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to delete post thumb file %s", path)


def _directory_size_bytes(directory: Path) -> int:
    total = 0
    for path in directory.iterdir():
        if path.is_file() and not path.name.endswith(_META_SUFFIX):
            try:
                total += path.stat().st_size
            except OSError:
                continue
    return total


def enforce_thumb_cache_size_limit(max_size_mb: int) -> int:
    """Delete oldest image files until cache is under max_size_mb. Returns bytes freed."""
    if max_size_mb <= 0:
        return 0

    directory = _thumb_dir()
    max_bytes = max_size_mb * 1024 * 1024
    current = _directory_size_bytes(directory)
    if current <= max_bytes:
        return 0

    image_files: list[tuple[float, Path]] = []
    for path in directory.iterdir():
        if not path.is_file() or path.name.endswith(_META_SUFFIX):
            continue
        try:
            image_files.append((path.stat().st_mtime, path))
        except OSError:
            continue

    image_files.sort(key=lambda item: item[0])
    freed = 0
    for _, path in image_files:
        if current <= max_bytes:
            break
        try:
            size = path.stat().st_size
            path.unlink(missing_ok=True)
            meta = directory / f"{path.stem}{_META_SUFFIX}"
            meta.unlink(missing_ok=True)
            current -= size
            freed += size
        except OSError:
            logger.warning("Failed to trim post thumb cache file %s", path)
    return freed


def enforce_thumb_cache_size_limit_throttled(max_size_mb: int) -> int:
    """Enforce the cache limit at most once per _ENFORCE_MIN_INTERVAL_SECONDS.

    The sync loop calls this once per scraped page, but the underlying check
    walks the whole cache directory (one stat() per file). Cache growth between
    pages is small, so a periodic sweep bounds disk usage just as well at a
    fraction of the CPU cost. The lock also keeps concurrent channel syncs from
    walking and evicting at the same time.
    """
    global _last_enforce_at

    now = time.monotonic()
    with _last_enforce_lock:
        if now - _last_enforce_at < _ENFORCE_MIN_INTERVAL_SECONDS:
            return 0
        _last_enforce_at = now
        return enforce_thumb_cache_size_limit(max_size_mb)


async def cache_post_thumb(
    channel_name: str,
    post_id: int,
    source_url: str,
    *,
    force: bool = False,
) -> bool:
    if not is_remote_thumb_url(source_url):
        return has_cached_thumb(channel_name, post_id)

    if not force:
        meta = _read_meta(channel_name, post_id)
        if (
            meta
            and meta.get("sourceUrl") == source_url
            and has_cached_thumb(channel_name, post_id)
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
            "Failed to download post thumb for %s/%s from %s: %s",
            channel_name,
            post_id,
            source_url,
            exc,
        )
        return has_cached_thumb(channel_name, post_id)

    if not content:
        return has_cached_thumb(channel_name, post_id)

    ext = _EXT_BY_CONTENT_TYPE.get(content_type.lower(), _DEFAULT_EXT)
    safe = _safe_key(channel_name, post_id)
    directory = _thumb_dir()

    for stale_ext in _IMAGE_EXTS:
        if stale_ext == ext:
            continue
        try:
            (directory / f"{safe}{stale_ext}").unlink(missing_ok=True)
        except OSError:
            pass

    image_path = directory / f"{safe}{ext}"
    image_path.write_bytes(content)
    _meta_path(channel_name, post_id).write_text(
        json.dumps({"sourceUrl": source_url, "contentType": content_type}),
        encoding="utf-8",
    )
    return True
