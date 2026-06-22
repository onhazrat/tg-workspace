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

PROXY_CONCURRENCY_MIN = 1
PROXY_CONCURRENCY_MAX = 20

NETWORK_UI_KEYS = frozenset(
    {
        "proxyEnabled",
        "proxyUrls",
        "proxyDefaultConcurrency",
        "proxyConcurrencyOverrides",
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


def normalize_proxy_url(proxy_url: str) -> str:
    url = proxy_url.strip()
    if "://" not in url:
        if "127.0.0.1" in url or "localhost" in url:
            url = f"socks5h://{url}"
        else:
            url = f"http://{url}"
    if url.startswith("socks5://"):
        url = url.replace("socks5://", "socks5h://", 1)
    return url


def clamp_proxy_concurrency(value: int) -> int:
    return max(PROXY_CONCURRENCY_MIN, min(PROXY_CONCURRENCY_MAX, int(value)))


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
                (
                    parsed.scheme,
                    netloc,
                    parsed.path,
                    parsed.params,
                    parsed.query,
                    parsed.fragment,
                )
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


def load_network_settings(
    session: Session, user_id: uuid.UUID | None = None
) -> dict[str, Any]:
    """Load merged network settings for proxy resolution (includes server env metadata)."""
    row = get_network_setting_row(session)
    stored = row.value if row else {}
    return network_settings_payload(
        stored, owner_user_id=row.user_id if row else user_id
    )


def network_settings_payload(
    stored: dict[str, Any] | None,
    *,
    owner_user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    stored = stored or {}
    ui = {k: stored[k] for k in NETWORK_UI_KEYS if k in stored}
    proxy_urls = _stored_proxy_urls(stored)
    env_fallback = settings.default_proxies

    default_concurrency, overrides = resolve_proxy_concurrency(stored)
    payload: dict[str, Any] = {
        **ui,
        "proxyUrls": proxy_urls,
        "proxyDefaultConcurrency": default_concurrency,
        "proxyConcurrencyOverrides": overrides,
        "envFallbackConfigured": bool(env_fallback),
        "usingEnvFallback": bool(ui.get("proxyEnabled"))
        and not proxy_urls
        and bool(env_fallback),
        "torAvailable": settings.TOR_ENABLED,
        "torControlPortDefault": settings.TOR_CONTROL_PORT,
        "torSocksProxy": settings.TOR_SOCKS_PROXY,
    }
    if owner_user_id is not None:
        payload["ownerUserId"] = str(owner_user_id)
    return payload


def merge_network_put(
    body: dict[str, Any], stored: dict[str, Any] | None
) -> dict[str, Any]:
    merged = {**(stored or {})}
    for key in NETWORK_UI_KEYS:
        if key not in body:
            continue
        value = body[key]
        if key == "proxyUrls":
            merged["proxyUrls"] = _parse_proxy_list(value)
            merged.pop(_LEGACY_PROXY_KEY, None)
        elif key == "proxyDefaultConcurrency":
            merged["proxyDefaultConcurrency"] = clamp_proxy_concurrency(int(value))
        elif key == "proxyConcurrencyOverrides":
            merged["proxyConcurrencyOverrides"] = _normalize_concurrency_overrides(
                value
            )
        else:
            merged[key] = value
    # Accept legacy textarea field when client did not send proxyUrls.
    if _LEGACY_PROXY_KEY in body and "proxyUrls" not in body:
        merged["proxyUrls"] = _parse_proxy_list(body[_LEGACY_PROXY_KEY])
        merged.pop(_LEGACY_PROXY_KEY, None)
    return merged


def _normalize_concurrency_overrides(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    overrides: dict[str, int] = {}
    for url, slots in raw.items():
        if not isinstance(url, str) or not url.strip():
            continue
        if not isinstance(slots, (int, float)):
            continue
        overrides[normalize_proxy_url(url)] = clamp_proxy_concurrency(int(slots))
    return overrides


def resolve_proxy_concurrency(network: dict[str, Any]) -> tuple[int, dict[str, int]]:
    default = clamp_proxy_concurrency(
        int(
            network.get("proxyDefaultConcurrency")
            or settings.PROXY_DEFAULT_CONCURRENCY_DEFAULT
        )
    )
    overrides = _normalize_concurrency_overrides(
        network.get("proxyConcurrencyOverrides")
    )
    return default, overrides


def compute_proxy_pool_capacity(
    proxies: list[str],
    default_slots: int,
    overrides: dict[str, int],
) -> int:
    if not proxies:
        return 0
    total = 0
    for proxy in proxies:
        norm = normalize_proxy_url(proxy)
        total += overrides.get(norm, default_slots)
    return total


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
