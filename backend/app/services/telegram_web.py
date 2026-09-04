"""Telegram public web-view URL helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from app.core.config import settings

_LEGACY_TELEGRAM_WEB_DOMAINS = ("t.me", "telegram.me")

# Kept verbatim: it is the `detail.error` string the frontend shows for a
# soft-blocked channel. Raise `TelegramWebViewUnavailable` rather than matching
# on it — the text is a UI contract, not a control-flow one.
UNAVAILABLE_WEB_VIEW_MESSAGE = "Channel is not available on the web view."


class TelegramWebViewUnavailable(ConnectionError):
    """The channel exists but Telegram will not serve its public web view.

    A `ConnectionError` subclass so existing network-error handling keeps
    treating it as one, while `isinstance` lets callers distinguish a soft
    block (never worth retrying, and reported as 400) from a transport failure.
    """

    def __init__(self, message: str = UNAVAILABLE_WEB_VIEW_MESSAGE) -> None:
        super().__init__(message)


def telegram_web_domain() -> str:
    domain = settings.TELEGRAM_WEB_DOMAIN.strip().lower()
    return domain or "t.me"


def telegram_web_base_url() -> str:
    return f"https://{telegram_web_domain()}"


def _all_web_domains() -> tuple[str, ...]:
    domain = telegram_web_domain()
    return tuple(dict.fromkeys((domain, *_LEGACY_TELEGRAM_WEB_DOMAINS)))


def _domain_alternation() -> str:
    return "|".join(re.escape(domain) for domain in _all_web_domains())


def _url_host_is_telegram_web(url: str) -> bool:
    host = urlparse(url).hostname
    if not host:
        return False
    return host.lower() in _all_web_domains()


def is_telegram_web_view_url(url: str) -> bool:
    if not _url_host_is_telegram_web(url):
        return False
    path = urlparse(url).path or ""
    return path.startswith("/s/")


def is_telegram_web_url(url: str) -> bool:
    return _url_host_is_telegram_web(url)


def resolve_telegram_href(href: str) -> str:
    if href.startswith("http"):
        return href
    # Protocol-relative (`//telegram.org/img/x.png`) is already absolute; joining
    # it onto the base would invent `https://t.me/telegram.org/img/x.png`.
    if href.startswith("//"):
        return f"https:{href}"
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


# `t.me/<segment>` paths that are never a public channel handle. Keep in sync
# with RESERVED_TELEGRAM_PATHS in frontend/src/lib/posts/telegram-handles.ts.
RESERVED_TELEGRAM_PATHS = frozenset(
    {
        "addemoji",
        "addstickers",
        "addtheme",
        "boost",
        "c",
        "iv",
        "joinchat",
        "login",
        "proxy",
        "s",
        "setlanguage",
        "share",
        "socks",
    }
)

_HANDLE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")


def is_channel_handle(name: str) -> bool:
    """True when `name` can be a public channel handle (not an invite/reserved path)."""
    clean = name.lstrip("@").strip()
    if not _HANDLE_RE.match(clean):
        return False
    return clean.lower() not in RESERVED_TELEGRAM_PATHS


def extract_channel_name_from_href(href: str) -> str | None:
    """First path segment of a Telegram-hosted href, if it has one.

    The host is matched against the configured web domains rather than searched
    for anywhere in the string, so `https://evil.example.com/t.me/foo` does not
    read as a Telegram link. The result is a raw segment and may still be a
    reserved path — callers that need a followable handle must additionally
    apply `is_channel_handle`.
    """
    url = href if href.startswith("http") else f"https://{href.lstrip('/')}"
    if not _url_host_is_telegram_web(url):
        return None
    segments = [seg for seg in (urlparse(url).path or "").split("/") if seg]
    if not segments:
        return None
    channel = segments[0]
    if channel == "s":
        return None
    return channel


@dataclass(frozen=True)
class ParsedTelegramWebViewUrl:
    channel_name: str
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
            start_id=start_id,
            is_search_mode=True,
        )

    match_before = re.search(
        rf"(?:{domain})/s/([^/?]+)\?before=(\d+)", url, re.IGNORECASE
    )
    if match_before:
        return ParsedTelegramWebViewUrl(
            channel_name=match_before.group(1),
            start_id=1,
            is_search_mode=True,
        )

    match_slash = re.search(rf"(?:{domain})/s/([^/?]+)/(\d+)", url, re.IGNORECASE)
    if match_slash:
        return ParsedTelegramWebViewUrl(
            channel_name=match_slash.group(1),
            start_id=int(match_slash.group(2)),
            is_search_mode=False,
        )

    return None
