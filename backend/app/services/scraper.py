"""Telegram web view HTML scraping."""

from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from app.services.network import fetch_with_retry


def _parse_posts_from_html(html: str, start_id: int, seen: set[int]) -> tuple[list[dict[str, Any]], str | None]:
    soup = BeautifulSoup(html, "html.parser")
    posts: list[dict[str, Any]] = []

    for el in soup.select(".tgme_widget_message"):
        data_post = el.get("data-post")
        post_id: int | None = None
        if data_post:
            parts = data_post.split("/")
            if parts[-1].isdigit():
                post_id = int(parts[-1])

        if not post_id:
            date_link = el.select_one(".tgme_widget_message_date")
            href = date_link.get("href") if date_link else None
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
        date = time_el.get("datetime", "") if time_el else ""

        forwarded_from: str | None = None
        forwarded_from_name: str | None = None
        fwd_el = el.select_one(".tgme_widget_message_forwarded_from_name")
        if fwd_el:
            forwarded_from_name = fwd_el.get_text(strip=True)
            href = fwd_el.get("href")
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
    if more and more.get("href"):
        href = more["href"]
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
        href = date_link.get("href") if date_link else None
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


async def get_channel_info(
    channel_name: str,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int = 10,
) -> dict[str, Any]:
    url = f"https://t.me/s/{channel_name}"
    html, telemetry = await fetch_with_retry(
        url,
        proxies=proxies,
        tor_auto_rotate=tor_auto_rotate,
        tor_rotation_threshold=tor_rotation_threshold,
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
    tor_rotation_threshold: int = 10,
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
    max_posts = 300
    iteration_limit = 15

    async def fetch_posts(target_url: str) -> tuple[list[dict[str, Any]], str | None]:
        html, telem = await fetch_with_retry(
            target_url,
            proxies=proxies,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
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
        )
        telemetry_logs.append(root_telem)
        meta = _parse_channel_meta(BeautifulSoup(root_html, "html.parser"), channel_name)
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
        while last_fetched < latest_id and len(all_posts) < max_posts and iterations < iteration_limit:
            iterations += 1
            target = current_next or f"https://t.me/s/{channel_name}?after={last_fetched}"
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
