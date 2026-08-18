"""Cache Telegram channel avatar images on disk and serve via API."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Container
from contextlib import suppress
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_META_SUFFIX = ".meta.json"
_photo_dirs_ready: set[Path] = set()
_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_DEFAULT_EXT = ".jpg"
# Every extension cache_channel_photo can write: the content-type map plus the
# fallback used for unrecognised types. Derived rather than spelled out so it
# cannot drift away from the write path. Checking these directly avoids a
# directory-wide glob per lookup.
_IMAGE_EXTS: tuple[str, ...] = (
    _DEFAULT_EXT,
    *sorted(set(_EXT_BY_CONTENT_TYPE.values()) - {_DEFAULT_EXT}),
)


def _resolve_photo_dir() -> Path:
    configured = Path(settings.CHANNEL_PHOTO_DIR)
    if configured.is_absolute():
        return configured
    backend_root = Path(__file__).resolve().parents[2]
    return backend_root.parent / configured


def _photo_dir() -> Path:
    """Resolve the cache directory, creating it once per distinct path.

    Keyed by path rather than a single flag: a bare bool skips the mkdir forever
    once any directory has been created, so a reconfigured or externally removed
    directory would never be recreated.
    """
    root = _resolve_photo_dir()
    if root not in _photo_dirs_ready:
        root.mkdir(parents=True, exist_ok=True)
        _photo_dirs_ready.add(root)
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
    """Locate a cached avatar by probing known extensions.

    A glob here would scandir the whole cache directory on every call, and
    `channel_to_camel` asks once per channel: on staging that was 2,068 lookups
    against 16,276 files, 30 of the 33 seconds a channel list took. Only
    `_IMAGE_EXTS` can ever be written, so probe those directly.
    """
    safe = _safe_channel_id(channel_id)
    directory = _photo_dir()
    for ext in _IMAGE_EXTS:
        path = directory / f"{safe}{ext}"
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
    # `_META_SUFFIX` is listed explicitly: the glob this replaced matched it too,
    # so dropping it would leave the sidecar behind on every delete.
    for suffix in (*_IMAGE_EXTS, _META_SUFFIX):
        path = directory / f"{safe}{suffix}"
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

    ext = _EXT_BY_CONTENT_TYPE.get(content_type.lower(), _DEFAULT_EXT)
    safe = _safe_channel_id(channel_id)
    directory = _photo_dir()

    # Only the *other* extensions need clearing; the image and its meta are
    # overwritten below. The glob this replaced deleted the meta too, just to
    # recreate it one line later.
    for stale_ext in _IMAGE_EXTS:
        if stale_ext == ext:
            continue
        with suppress(OSError):
            (directory / f"{safe}{stale_ext}").unlink(missing_ok=True)

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


def photo_stem(channel_id: str) -> str:
    """The on-disk filename stem for a channel id.

    Exported so callers can build a keep-set for `prune_orphaned_photos` in the
    same lossy space the files were written in.
    """
    return _safe_channel_id(channel_id)


def prune_orphaned_photos(
    keep_stems: Container[str],
    *,
    max_age_days: int,
) -> int:
    """Delete cached avatars no channel references. Returns files removed.

    Nothing else bounds this cache. `scraper.get_channel_info` caches an avatar
    for every channel it looks up, and the Discover probe job looks up
    candidates that are never followed — on staging that left 6,361 of 8,138
    avatars orphaned.

    **The age floor is load-bearing.** A freshly probed candidate is not a
    channel row yet, so "unreferenced" alone would strip the avatar off a
    Discover report while the operator is still looking at it. Files older than
    the window may fall back to placeholder initials in an old saved report,
    which is cosmetic and heals on the next probe. `max_age_days <= 0` disables
    the sweep, matching the other retention windows.

    Compares stems, not channel ids: `_safe_channel_id` is lossy, so two ids can
    share a file. A collision keeps a file that could have gone; it can never
    delete one that is still referenced.
    """
    if max_age_days <= 0:
        return 0

    directory = _photo_dir()
    cutoff = time.time() - max_age_days * 24 * 60 * 60
    removed = 0
    # One scandir for the whole sweep — the mistake this module is being fixed
    # for is doing a directory walk per item.
    with os.scandir(directory) as entries:
        stale = [
            entry.path
            for entry in entries
            if entry.is_file()
            and _stem_of(entry.name) not in keep_stems
            and entry.stat().st_mtime < cutoff
        ]
    for path in stale:
        try:
            os.unlink(path)
            removed += 1
        except OSError:
            logger.warning("Failed to prune orphaned channel photo %s", path)
    return removed


def _stem_of(filename: str) -> str:
    """Strip the cache suffix from a filename, `.meta.json` included.

    `os.path.splitext` would leave `channel.meta`, which matches no channel and
    would delete live sidecars.
    """
    if filename.endswith(_META_SUFFIX):
        return filename[: -len(_META_SUFFIX)]
    return os.path.splitext(filename)[0]
