"""Per-user network settings and proxy resolution."""

from __future__ import annotations

import re
import uuid
from typing import Any
from urllib.parse import urlparse, urlunparse

from sqlmodel import Session

from app.core.config import settings
from app.models_tg import AppSetting

NETWORK_SETTING_KEY = "network"

NETWORK_UI_KEYS = frozenset(
    {
        "proxyEnabled",
        "proxyUrls",
        "torEnabled",
        "torMode",
        "torProxyUrls",
        "torRotationStrategy",
        "torControlEnabled",
        "torControlPort",
        "torAutoRotate",
        "torRotationThreshold",
    }
)

# Legacy key from Phase 2 env-only proxy config.
_LEGACY_PROXY_KEY = "defaultProxyUrls"


def _parse_proxy_list(raw: str | list[str] | None) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [p.strip() for p in raw if isinstance(p, str) and p.strip()]
    return [p.strip() for p in re.split(r"[\n,]+", str(raw)) if p.strip()]


def redact_proxy_url(proxy_url: str | None) -> str | None:
    """Mask credentials in proxy URLs before logging or export."""
    if not proxy_url or proxy_url == "direct":
        return proxy_url
    try:
        parsed = urlparse(proxy_url)
        if parsed.username or parsed.password:
            host = parsed.hostname or ""
            if parsed.port:
                host = f"{host}:{parsed.port}"
            netloc = f"***@{host}" if host else "***"
            return urlunparse(
                (parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment)
            )
    except Exception:  # noqa: BLE001
        pass
    return proxy_url


def _stored_proxy_urls(stored: dict[str, Any] | None) -> list[str]:
    if not stored:
        return []
    if "proxyUrls" in stored:
        return _parse_proxy_list(stored.get("proxyUrls"))
    return _parse_proxy_list(stored.get(_LEGACY_PROXY_KEY))


def get_network_setting_row(session: Session) -> AppSetting | None:
    return session.get(AppSetting, NETWORK_SETTING_KEY)


def load_network_settings(session: Session, user_id: uuid.UUID | None = None) -> dict[str, Any]:
    """Load merged network settings for proxy resolution (includes server env metadata)."""
    row = get_network_setting_row(session)
    stored = row.value if row else {}
    return network_settings_payload(stored, owner_user_id=row.user_id if row else user_id)


def network_settings_payload(
    stored: dict[str, Any] | None,
    *,
    owner_user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    stored = stored or {}
    ui = {k: stored[k] for k in NETWORK_UI_KEYS if k in stored}
    proxy_urls = _stored_proxy_urls(stored)
    env_fallback = settings.default_proxies

    payload: dict[str, Any] = {
        **ui,
        "proxyUrls": proxy_urls,
        "envFallbackConfigured": bool(env_fallback),
        "usingEnvFallback": bool(ui.get("proxyEnabled")) and not proxy_urls and bool(env_fallback),
        "torAvailable": settings.TOR_ENABLED,
        "torControlPortDefault": settings.TOR_CONTROL_PORT,
        "torSocksProxy": settings.TOR_SOCKS_PROXY,
    }
    if owner_user_id is not None:
        payload["ownerUserId"] = str(owner_user_id)
    return payload


def merge_network_put(body: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    merged = {**(stored or {})}
    for key in NETWORK_UI_KEYS:
        if key not in body:
            continue
        value = body[key]
        if key == "proxyUrls":
            merged["proxyUrls"] = _parse_proxy_list(value)
            merged.pop(_LEGACY_PROXY_KEY, None)
        else:
            merged[key] = value
    # Accept legacy textarea field when client did not send proxyUrls.
    if _LEGACY_PROXY_KEY in body and "proxyUrls" not in body:
        merged["proxyUrls"] = _parse_proxy_list(body[_LEGACY_PROXY_KEY])
        merged.pop(_LEGACY_PROXY_KEY, None)
    return merged


def resolve_proxies(network: dict[str, Any]) -> list[str]:
    """Resolve active proxy pool: user URLs first, then DEFAULT_PROXY_URLS env fallback."""
    proxies: list[str] = []
    user_urls = _stored_proxy_urls(network)

    if network.get("proxyEnabled"):
        if user_urls:
            proxies.extend(user_urls)
        elif settings.default_proxies:
            proxies.extend(settings.default_proxies)

    tor_on = network.get("torEnabled") or settings.TOR_ENABLED
    if tor_on:
        tor_urls = network.get("torProxyUrls") or ""
        if network.get("torMode") == "auto":
            proxies.append(network.get("torSocksProxy") or settings.TOR_SOCKS_PROXY)
        else:
            proxies.extend(_parse_proxy_list(str(tor_urls)))

    if not proxies and settings.default_proxies:
        proxies.extend(settings.default_proxies)

    return proxies


def resolve_proxies_for_user(session: Session, user_id: uuid.UUID | None) -> list[str]:
    """Load network settings and resolve proxies for a user (or global row)."""
    _ = user_id  # reserved for per-user rows when composite PK lands
    return resolve_proxies(load_network_settings(session, user_id))
