#!/usr/bin/env python3
"""Backfill tg_posts.media and post thumbnails from Telegram web-view HTML."""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import or_
from sqlmodel import Session, col, select

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from app.core.db import engine
from app.jobs.settings import load_media_settings
from app.models_tg import Channel, Post
from app.services.network import fetch_with_retry
from app.services.post_media_parser import finalize_post_media_paths, parse_widget_media
from app.services.post_thumbnails import (
    cache_post_thumb,
    enforce_thumb_cache_size_limit,
)
from app.services.scraper import _parse_posts_from_html, make_soup
from app.services.telegram_web import (
    telegram_web_view_post_url,
)

MEDIA_ONLY_PLACEHOLDER = "[Media/No Text Content]"
DEFAULT_CHANNELS = ("durov",)
DEFAULT_SLEEP_SECONDS = 1.0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill post media metadata and optional thumbnails."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report changes without writing to the database or caching thumbs.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Maximum posts to process (default: 500).",
    )
    parser.add_argument(
        "--channels",
        nargs="*",
        default=list(DEFAULT_CHANNELS),
        help="Channel names to backfill (default: durov).",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=1,
        help="Concurrent channel workers (default: 1).",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=DEFAULT_SLEEP_SECONDS,
        help="Delay between post fetches in seconds (default: 1.0).",
    )
    return parser.parse_args()


def _normalize_channel_name(name: str) -> str:
    return name.strip().lstrip("@")


def _select_posts(
    session: Session,
    *,
    channels: list[str],
    limit: int,
) -> list[Post]:
    stmt = (
        select(Post)
        .where(
            col(Post.channel_name).in_(channels),
            or_(
                Post.text == MEDIA_ONLY_PLACEHOLDER,
                col(Post.media).is_(None),
            ),
        )
        .order_by(col(Post.timestamp).desc())
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def _exclude_unavailable_channels(session: Session, channels: list[str]) -> list[str]:
    available: list[str] = []
    for name in channels:
        channel = session.exec(select(Channel).where(Channel.name == name)).first()
        if channel and channel.is_unavailable_on_web_view:
            print(f"Skipping unavailable channel @{name}")
            continue
        available.append(name)
    return available


async def _fetch_post_html(channel_name: str, post_id: int) -> str:
    url = telegram_web_view_post_url(channel_name, post_id)
    html, _telemetry = await fetch_with_retry(url)
    if not isinstance(html, str):
        raise ValueError(f"Unexpected response type for {url}")
    return html


def _parse_single_post(
    html: str, channel_name: str, post_id: int
) -> tuple[str, dict[str, Any] | None, str | None]:
    soup = make_soup(html)
    posts, _next = _parse_posts_from_html(soup, post_id, set())
    for post in posts:
        if post.get("id") == post_id:
            thumb_source = post.get("_thumbSourceUrl")
            finalize_post_media_paths(post, channel_name)
            return (
                post.get("text", ""),
                post.get("media"),
                thumb_source,
            )

    for el in soup.select(".tgme_widget_message"):
        data_post = el.get("data-post")
        if isinstance(data_post, list):
            data_post = data_post[0] if data_post else None
        if data_post and str(data_post).endswith(f"/{post_id}"):
            text, media, thumb_source = parse_widget_media(
                el, channel_name=channel_name, post_id=post_id
            )
            return text, media, thumb_source
    raise ValueError(f"Post {channel_name}/{post_id} not found in HTML")


async def _process_post(
    post: Post,
    *,
    dry_run: bool,
    cache_thumbs: bool,
    sleep_seconds: float,
    max_size_mb: int,
) -> dict[str, Any]:
    await asyncio.sleep(sleep_seconds)
    html = await _fetch_post_html(post.channel_name, post.post_id)
    text, media, thumb_source = _parse_single_post(
        html, post.channel_name, post.post_id
    )

    result = {
        "channel": post.channel_name,
        "postId": post.post_id,
        "updated": False,
        "cachedThumb": False,
    }

    if dry_run:
        result["preview"] = {"text": text, "media": media}
        return result

    with Session(engine) as session:
        row = session.exec(
            select(Post).where(
                Post.channel_name == post.channel_name,
                Post.post_id == post.post_id,
            )
        ).first()
        if not row:
            return result
        row.text = text
        row.media = media
        session.add(row)
        session.commit()
        result["updated"] = True

    if cache_thumbs and thumb_source:
        cached = await cache_post_thumb(post.channel_name, post.post_id, thumb_source)
        result["cachedThumb"] = cached
        if max_size_mb > 0:
            enforce_thumb_cache_size_limit(max_size_mb)

    return result


async def _run_backfill(args: argparse.Namespace) -> dict[str, Any]:
    channels = [_normalize_channel_name(c) for c in args.channels if c.strip()]
    if not channels:
        channels = list(DEFAULT_CHANNELS)

    with Session(engine) as session:
        channels = _exclude_unavailable_channels(session, channels)
        media_settings = load_media_settings(session)
        posts = _select_posts(session, channels=channels, limit=args.limit)

    cache_thumbs = bool(
        media_settings.get("thumbCacheEnabled", True)
        and media_settings.get("thumbCacheOnBackfill", True)
    )
    max_size_mb = int(media_settings.get("thumbCacheMaxSizeMb") or 2048)

    summary: dict[str, Any] = {
        "dryRun": args.dry_run,
        "channels": channels,
        "selected": len(posts),
        "updated": 0,
        "cachedThumbs": 0,
        "errors": [],
    }

    if not posts:
        return summary

    semaphore = asyncio.Semaphore(max(1, args.concurrency))

    async def _worker(post: Post) -> None:
        async with semaphore:
            try:
                result = await _process_post(
                    post,
                    dry_run=args.dry_run,
                    cache_thumbs=cache_thumbs,
                    sleep_seconds=args.sleep,
                    max_size_mb=max_size_mb,
                )
                if result.get("updated"):
                    summary["updated"] += 1
                if result.get("cachedThumb"):
                    summary["cachedThumbs"] += 1
            except Exception as exc:  # noqa: BLE001
                summary["errors"].append(
                    {
                        "channel": post.channel_name,
                        "postId": post.post_id,
                        "error": str(exc),
                    }
                )

    await asyncio.gather(*[_worker(post) for post in posts])
    return summary


def main() -> None:
    args = _parse_args()
    started = time.time()
    summary = asyncio.run(_run_backfill(args))
    summary["elapsedSeconds"] = round(time.time() - started, 2)
    print(summary)
    if summary.get("errors"):
        sys.exit(1)


if __name__ == "__main__":
    main()
