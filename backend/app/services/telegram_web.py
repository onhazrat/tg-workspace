"""Telegram public web-view URL helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urljoin

from app.core.config import settings

_LEGACY_TELEGRAM_WEB_DOMAINS = ("t.me", "telegram.me")


def telegram_web_domain() -> str:
    domain = settings.TELEGRAM_WEB_DOMAIN.strip().lower()
    return domain or "telegram.me"


def telegram_web_base_url() -> str:
    return f"https://{telegram_web_domain()}"


def _all_web_domains() -> tuple[str, ...]:
    domain = telegram_web_domain()
    return tuple(dict.fromkeys((domain, *_LEGACY_TELEGRAM_WEB_DOMAINS)))


def _domain_alternation() -> str:
    return "|".join(re.escape(domain) for domain in _all_web_domains())


def is_telegram_web_view_url(url: str) -> bool:
    pattern = re.compile(
        rf"(?:https?://)?(?:{_domain_alternation()})/s/",
        re.IGNORECASE,
    )
    return bool(pattern.search(url))


def is_telegram_web_url(url: str) -> bool:
    pattern = re.compile(
        rf"(?:https?://)?(?:{_domain_alternation()})/",
        re.IGNORECASE,
    )
    return bool(pattern.search(url))


def resolve_telegram_href(href: str) -> str:
    if href.startswith("http"):
        return href
    return urljoin(f"{telegram_web_base_url()}/", href.lstrip("/"))


def telegram_web_view_channel_url(
    channel_name: str,
    *,
    before_id: int | None = None,
    after_id: int | None = None,
) -> str:
    base = f"{telegram_web_base_url()}/s/{channel_name}"
    if before_id is not None:
        return f"{base}?before={before_id}"
    if after_id is not None:
        return f"{base}?after={after_id}"
    return base


def telegram_web_view_post_url(channel_name: str, post_id: int) -> str:
    return f"{telegram_web_base_url()}/s/{channel_name}/{post_id}"


def telegram_channel_post_url(channel_name: str, post_id: int) -> str:
    return f"{telegram_web_base_url()}/{channel_name}/{post_id}"


def extract_channel_name_from_href(href: str) -> str | None:
    match = re.search(
        rf"(?:{_domain_alternation()})/([^/?#]+)",
        href,
        re.IGNORECASE,
    )
    if not match:
        return None
    channel = match.group(1)
    if channel == "s":
        return None
    return channel


@dataclass(frozen=True)
class ParsedTelegramWebViewUrl:
    channel_name: str
    mode: Literal["after", "before", "single"]
    start_id: int
    is_search_mode: bool


def parse_telegram_web_view_url(url: str) -> ParsedTelegramWebViewUrl | None:
    domain = _domain_alternation()
    match_after = re.search(
        rf"(?:{domain})/s/([^/?]+)\?after=(\d+)", url, re.IGNORECASE
    )
    if match_after:
        start_id = int(match_after.group(2)) + 1
        return ParsedTelegramWebViewUrl(
            channel_name=match_after.group(1),
            mode="after",
            start_id=start_id,
            is_search_mode=True,
        )

    match_before = re.search(
        rf"(?:{domain})/s/([^/?]+)\?before=(\d+)", url, re.IGNORECASE
    )
    if match_before:
        return ParsedTelegramWebViewUrl(
            channel_name=match_before.group(1),
            mode="before",
            start_id=1,
            is_search_mode=True,
        )

    match_slash = re.search(rf"(?:{domain})/s/([^/?]+)/(\d+)", url, re.IGNORECASE)
    if match_slash:
        return ParsedTelegramWebViewUrl(
            channel_name=match_slash.group(1),
            mode="single",
            start_id=int(match_slash.group(2)),
            is_search_mode=False,
        )

    return None
