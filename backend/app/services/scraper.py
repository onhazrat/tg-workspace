"""Telegram web view HTML scraping."""

from __future__ import annotations

import asyncio
import logging
import math
import re
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup

from app.core.config import settings
from app.services.network import fetch_with_retry

logger = logging.getLogger(__name__)


def _attr_str(value: str | list[str] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _parse_posts_from_html(
    html: str, start_id: int, seen: set[int]
) -> tuple[list[dict[str, Any]], str | None]:
    soup = BeautifulSoup(html, "html.parser")
    posts: list[dict[str, Any]] = []

    for el in soup.select(".tgme_widget_message"):
        data_post = _attr_str(el.get("data-post"))
        post_id: int | None = None
        if data_post:
            parts = data_post.split("/")
            if parts[-1].isdigit():
                post_id = int(parts[-1])

        if not post_id:
            date_link = el.select_one(".tgme_widget_message_date")
            href = _attr_str(date_link.get("href") if date_link else None)
            if href:
                m = re.search(r"/(\d+)$", href)
                if m:
                    post_id = int(m.group(1))

        if not post_id or post_id < start_id or post_id in seen:
            continue

        text_el = el.select_one(".tgme_widget_message_text")
        if text_el:
            for br in text_el.find_all("br"):
                br.replace_with("\n")
            text = text_el.get_text(strip=True)
        else:
            poll_el = el.select_one(".tgme_widget_message_poll_question")
            if poll_el:
                for br in poll_el.find_all("br"):
                    br.replace_with("\n")
                text = poll_el.get_text(strip=True)
            else:
                text = ""

        time_el = el.select_one("time[datetime]")
        date = _attr_str(time_el.get("datetime") if time_el else None) or ""

        forwarded_from: str | None = None
        forwarded_from_name: str | None = None
        fwd_el = el.select_one(".tgme_widget_message_forwarded_from_name")
        if fwd_el:
            forwarded_from_name = fwd_el.get_text(strip=True)
            href = _attr_str(fwd_el.get("href"))
            if href:
                m = re.search(r"t\.me/([^/]+)", href)
                if m:
                    forwarded_from = m.group(1)

        post: dict[str, Any] = {
            "id": post_id,
            "text": text or "[Media/No Text Content]",
            "date": date,
        }
        if forwarded_from:
            post["forwardedFrom"] = forwarded_from
        if forwarded_from_name:
            post["forwardedFromName"] = forwarded_from_name

        posts.append(post)
        seen.add(post_id)

    more = soup.select_one(".tgme_messages_more")
    next_url = None
    if more:
        href = _attr_str(more.get("href"))
        if href:
            next_url = href if href.startswith("http") else f"https://t.me{href}"

    return posts, next_url


def _parse_channel_meta(soup: BeautifulSoup, channel_name: str) -> dict[str, Any]:
    display = soup.select_one(".tgme_channel_info_header_title span")
    if not display:
        display = soup.select_one(".tgme_page_title span")
    display_name = display.get_text(strip=True) if display else channel_name

    photo_el = soup.select_one(".tgme_channel_info_header_img img")
    if not photo_el:
        photo_el = soup.select_one(".tgme_page_photo_image")
    if not photo_el:
        photo_el = soup.select_one("meta[property='og:image']")
    photo_url = None
    if photo_el:
        photo_url = photo_el.get("src") or photo_el.get("content")

    bio_el = soup.select_one(".tgme_channel_info_description")
    bio = bio_el.get_text(strip=True) if bio_el else ""

    counters: dict[str, str] = {}
    for counter in soup.select(".tgme_channel_info_counter"):
        val = counter.select_one(".counter_value")
        typ = counter.select_one(".counter_type")
        if val and typ:
            counters[typ.get_text(strip=True).lower()] = val.get_text(strip=True)

    latest_id = 0
    for el in soup.select(".tgme_widget_message"):
        date_link = el.select_one(".tgme_widget_message_date")
        href = _attr_str(date_link.get("href") if date_link else None)
        if href:
            m = re.search(r"/(\d+)$", href)
            if m:
                latest_id = max(latest_id, int(m.group(1)))

    is_unavailable = latest_id == 0 and bool(soup.select_one(".tgme_page_action"))

    return {
        "channelName": channel_name,
        "displayName": display_name,
        "photoUrl": photo_url,
        "bio": bio,
        "subscribers": counters.get("subscribers") or counters.get("subscriber"),
        "photos": counters.get("photos") or counters.get("photo"),
        "videos": counters.get("videos") or counters.get("video"),
        "files": counters.get("files") or counters.get("file"),
        "links": counters.get("links") or counters.get("link"),
        "latestId": latest_id,
        "isUnavailableOnWebView": is_unavailable,
    }


def _enrich_posts_with_timestamps(
    posts: list[dict[str, Any]], channel_name: str
) -> list[dict[str, Any]]:
    for post in posts:
        post["channelName"] = channel_name
        if post.get("date"):
            try:
                dt = datetime.fromisoformat(post["date"].replace("Z", "+00:00"))
                post["timestamp"] = int(dt.timestamp() * 1000)
            except ValueError:
                post["timestamp"] = 0
        elif "timestamp" not in post:
            post["timestamp"] = 0
    return posts


async def scrape_channel_page(
    channel_name: str,
    *,
    before_id: int | None = None,
    known_latest_id: int | None = None,
    known_display_name: str | None = None,
    known_photo_url: str | None = None,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int | None = None,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
) -> dict[str, Any]:
    """Fetch a single backward-pagination window from the Telegram web view."""
    if before_id is None:
        url = f"https://t.me/s/{channel_name}"
    else:
        url = f"https://t.me/s/{channel_name}?before={before_id}"

    html, telemetry = await fetch_with_retry(
        url,
        proxies=proxies,
        tor_auto_rotate=tor_auto_rotate,
        tor_rotation_threshold=tor_rotation_threshold,
        proxy_concurrency=proxy_concurrency,
    )
    return await asyncio.to_thread(
        _parse_scrape_channel_page,
        html,
        channel_name,
        url,
        before_id,
        known_latest_id,
        known_display_name,
        known_photo_url,
        telemetry,
    )


def _parse_scrape_channel_page(
    html: str,
    channel_name: str,
    url: str,
    before_id: int | None,
    known_latest_id: int | None,
    known_display_name: str | None,
    known_photo_url: str | None,
    telemetry: dict[str, Any],
) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    posts, _next_url = _parse_posts_from_html(html, 0, set())
    posts = _enrich_posts_with_timestamps(posts, channel_name)

    meta = _parse_channel_meta(soup, channel_name)
    latest_id = known_latest_id or meta.get("latestId") or 0
    if not latest_id and posts:
        latest_id = max(p["id"] for p in posts)

    page_ids = [p["id"] for p in posts]
    next_before_id = min(page_ids) if page_ids else None

    return {
        "channelName": channel_name,
        "displayName": known_display_name or meta.get("displayName") or channel_name,
        "photoUrl": known_photo_url or meta.get("photoUrl") or "",
        "bio": meta.get("bio") or "",
        "subscribers": meta.get("subscribers") or "",
        "photos": meta.get("photos") or "",
        "videos": meta.get("videos") or "",
        "files": meta.get("files") or "",
        "links": meta.get("links") or "",
        "posts": posts,
        "latestId": latest_id,
        "nextBeforeId": next_before_id,
        "channelMeta": meta,
        "telemetry": telemetry,
        "fullRequest": {"url": url, "beforeId": before_id},
    }


async def get_channel_info(
    channel_name: str,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int | None = None,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
) -> dict[str, Any]:
    url = f"https://t.me/s/{channel_name}"
    html, telemetry = await fetch_with_retry(
        url,
        proxies=proxies,
        tor_auto_rotate=tor_auto_rotate,
        tor_rotation_threshold=tor_rotation_threshold,
        proxy_concurrency=proxy_concurrency,
    )
    soup = BeautifulSoup(html, "html.parser")
    result = _parse_channel_meta(soup, channel_name)
    result["telemetry"] = telemetry
    return result


async def scrape_channel(
    url: str,
    *,
    known_latest_id: int | None = None,
    known_display_name: str | None = None,
    known_photo_url: str | None = None,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int | None = None,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
) -> dict[str, Any]:
    telemetry_logs: list[Any] = []
    match_after = re.search(r"t\.me/s/([^/?]+)\?after=(\d+)", url)
    match_before = re.search(r"t\.me/s/([^/?]+)\?before=(\d+)", url)
    match_slash = re.search(r"t\.me/s/([^/?]+)/(\d+)", url)

    if match_after:
        channel_name = match_after.group(1)
        start_id = int(match_after.group(2)) + 1
        is_search_mode = True
    elif match_before:
        channel_name = match_before.group(1)
        start_id = 1
        is_search_mode = True
    elif match_slash:
        channel_name = match_slash.group(1)
        start_id = int(match_slash.group(2))
        is_search_mode = False
    else:
        raise ValueError("Invalid Telegram web-view URL format")

    seen: set[int] = set()
    all_posts: list[dict[str, Any]] = []
    max_posts = settings.SCRAPER_MAX_POSTS_PER_CHANNEL
    iteration_limit = settings.SCRAPER_ITERATION_LIMIT

    async def fetch_posts(target_url: str) -> tuple[list[dict[str, Any]], str | None]:
        html, telem = await fetch_with_retry(
            target_url,
            proxies=proxies,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )
        telemetry_logs.append(telem)
        return _parse_posts_from_html(html, start_id, seen)

    latest_id = known_latest_id or 0
    display_name = known_display_name or ""
    photo_url = known_photo_url or ""
    bio = subscribers = photos = videos = files = links = ""

    if not latest_id:
        root_html, root_telem = await fetch_with_retry(
            f"https://t.me/s/{channel_name}",
            proxies=proxies,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )
        telemetry_logs.append(root_telem)
        meta = _parse_channel_meta(
            BeautifulSoup(root_html, "html.parser"), channel_name
        )
        display_name = meta["displayName"]
        photo_url = meta.get("photoUrl") or ""
        bio = meta.get("bio") or ""
        subscribers = meta.get("subscribers") or ""
        photos = meta.get("photos") or ""
        videos = meta.get("videos") or ""
        files = meta.get("files") or ""
        links = meta.get("links") or ""
        latest_id = meta.get("latestId") or 0

    initial_posts, current_next = await fetch_posts(url)
    all_posts.extend(initial_posts)

    if not is_search_mode:
        last_fetched = max((p["id"] for p in all_posts), default=start_id - 1)
        iterations = 0
        while (
            last_fetched < latest_id
            and len(all_posts) < max_posts
            and iterations < iteration_limit
        ):
            iterations += 1
            target = (
                current_next or f"https://t.me/s/{channel_name}?after={last_fetched}"
            )
            next_posts, current_next = await fetch_posts(target)
            if not next_posts and not current_next:
                if last_fetched < latest_id:
                    retry_posts, current_next = await fetch_posts(
                        f"https://t.me/s/{channel_name}?after={last_fetched + 1}"
                    )
                    if retry_posts:
                        all_posts.extend(retry_posts)
                        last_fetched = max(p["id"] for p in all_posts)
                        continue
                break
            all_posts.extend(next_posts)
            new_max = max((p["id"] for p in all_posts), default=last_fetched)
            if new_max <= last_fetched and not current_next:
                break
            last_fetched = new_max

    filtered = sorted(
        [p for p in all_posts if is_search_mode or p["id"] >= start_id],
        key=lambda p: p["id"],
    )[:max_posts]

    for p in filtered:
        p["channelName"] = channel_name
        if p.get("date"):
            from datetime import datetime

            try:
                dt = datetime.fromisoformat(p["date"].replace("Z", "+00:00"))
                p["timestamp"] = int(dt.timestamp() * 1000)
            except ValueError:
                p["timestamp"] = 0

    return {
        "channelName": channel_name,
        "displayName": display_name,
        "photoUrl": photo_url,
        "bio": bio,
        "subscribers": subscribers,
        "photos": photos,
        "videos": videos,
        "files": files,
        "links": links,
        "posts": filtered,
        "latestId": latest_id,
        "telemetry": telemetry_logs,
    }


def _post_time_ms(post: dict[str, Any]) -> int | None:
    date = post.get("date") or ""
    if date:
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except ValueError:
            pass
    timestamp = post.get("timestamp")
    if isinstance(timestamp, (int, float)) and timestamp > 0:
        return int(timestamp)
    return None


async def _fetch_post_at_url(
    url: str,
    *,
    pick_last: bool,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int = 10,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
) -> dict[str, int] | None:
    try:
        res = await scrape_channel(
            url,
            proxies=proxies,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )
        posts = res.get("posts") or []
        if not posts:
            return None
        post = posts[-1] if pick_last else posts[0]
        time_ms = _post_time_ms(post)
        if time_ms is None:
            return None
        return {"id": int(post["id"]), "time": time_ms}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch post at %s: %s", url, exc)
        return None


async def resolve_start_time_to_id(
    channel_name: str,
    target_time_ms: int,
    *,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int = 10,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
) -> int:
    """Map a wall-clock timestamp to the first post ID at or after that time."""
    if target_time_ms is None or (
        isinstance(target_time_ms, float) and math.isnan(target_time_ms)
    ):
        logger.warning("Invalid target_time_ms for @%s. Defaulting to 1.", channel_name)
        return 1

    logger.info(
        "Resolving start time %s for @%s...",
        datetime.fromtimestamp(target_time_ms / 1000, tz=timezone.utc).isoformat(),
        channel_name,
    )

    async def fetch_post_at_or_after(post_id: int) -> dict[str, int] | None:
        if post_id > 1:
            url = f"https://t.me/s/{channel_name}?after={post_id - 1}"
        else:
            url = f"https://t.me/s/{channel_name}?after={post_id}"
        return await _fetch_post_at_url(
            url,
            pick_last=False,
            proxies=proxies,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )

    async def fetch_post_at_or_before(post_id: int) -> dict[str, int] | None:
        url = f"https://t.me/s/{channel_name}?before={post_id + 1}"
        return await _fetch_post_at_url(
            url,
            pick_last=True,
            proxies=proxies,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )

    info = await get_channel_info(
        channel_name,
        proxies=proxies,
        tor_auto_rotate=tor_auto_rotate,
        tor_rotation_threshold=tor_rotation_threshold,
        proxy_concurrency=proxy_concurrency,
    )
    if info.get("isUnavailableOnWebView"):
        raise ValueError("Channel is not available on the web view.")

    latest_id = info.get("latestId")
    if not latest_id:
        raise ValueError("Could not determine latest ID for channel")

    high_id = int(latest_id)
    high_time = int(datetime.now().timestamp() * 1000)
    high_post = await fetch_post_at_or_before(high_id)
    if high_post:
        high_id = high_post["id"]
        high_time = high_post["time"]

    if target_time_ms >= high_time:
        logger.info(
            "Target time is newer than latest post. Returning latest ID: %s", high_id
        )
        return high_id

    low_id = 1
    low_time = 0
    low_post = await fetch_post_at_or_after(low_id)
    if not low_post:
        return 1

    low_id = low_post["id"]
    low_time = low_post["time"]

    if target_time_ms <= low_time:
        logger.info(
            "Target time is older than oldest post. Returning oldest ID: %s", low_id
        )
        return low_id

    logger.info(
        "Bounds found: Low[%s] = %s, High[%s] = %s",
        low_id,
        datetime.fromtimestamp(low_time / 1000, tz=timezone.utc).isoformat(),
        high_id,
        datetime.fromtimestamp(high_time / 1000, tz=timezone.utc).isoformat(),
    )

    iterations = 0
    max_iterations = 12
    best_id = low_id

    while low_id <= high_id and iterations < max_iterations:
        iterations += 1

        if high_time > low_time:
            guess_id = low_id + int(
                ((target_time_ms - low_time) / (high_time - low_time))
                * (high_id - low_id)
            )
        else:
            guess_id = (low_id + high_id) // 2

        if guess_id <= low_id or guess_id >= high_id:
            guess_id = (low_id + high_id) // 2

        logger.info(
            "Iteration %s: Guessing ID %s (Low: %s, High: %s)",
            iterations,
            guess_id,
            low_id,
            high_id,
        )

        await asyncio.sleep(0.8)

        guess_post = await fetch_post_at_or_after(guess_id)
        if not guess_post:
            logger.warning(
                "Could not fetch post around guess ID %s. Assuming guess is beyond latest ID.",
                guess_id,
            )
            high_id = guess_id - 1
            continue

        logger.info(
            "Guessed Post: ID %s, Time %s",
            guess_post["id"],
            datetime.fromtimestamp(
                guess_post["time"] / 1000, tz=timezone.utc
            ).isoformat(),
        )

        if guess_post["time"] == target_time_ms:
            best_id = guess_post["id"]
            break
        if guess_post["time"] < target_time_ms:
            low_id = guess_post["id"] + 1
            low_time = guess_post["time"]
        else:
            high_id = guess_id - 1
            high_time = guess_post["time"]
            best_id = guess_post["id"]

    logger.info(
        "Resolved start time to ID: %s after %s iterations.",
        best_id,
        iterations,
    )
    return best_id
