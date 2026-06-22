"""Tests for per-user network settings and proxy resolution."""

from app.services.network_settings import (
    compute_proxy_pool_capacity,
    merge_network_put,
    network_settings_payload,
    normalize_proxy_url,
    redact_proxy_url,
    resolve_proxies,
    resolve_proxy_concurrency,
)


def test_resolve_proxies_user_urls_first(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.network_settings.settings.DEFAULT_PROXY_URLS",
        "http://env-fallback:8080",
    )
    network = {
        "proxyEnabled": True,
        "proxyUrls": ["http://user-proxy:3128"],
    }
    assert resolve_proxies(network) == ["http://user-proxy:3128"]


def test_resolve_proxies_env_fallback_when_user_empty(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.network_settings.settings.DEFAULT_PROXY_URLS",
        "http://env-fallback:8080",
    )
    network = {"proxyEnabled": True, "proxyUrls": []}
    assert resolve_proxies(network) == ["http://env-fallback:8080"]


def test_resolve_proxies_disabled_skips_user_urls(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.network_settings.settings.DEFAULT_PROXY_URLS",
        "http://env-fallback:8080",
    )
    network = {
        "proxyEnabled": False,
        "proxyUrls": ["http://user-proxy:3128"],
    }
    assert resolve_proxies(network) == ["http://env-fallback:8080"]


def test_merge_network_put_accepts_string_array_and_legacy_field() -> None:
    merged = merge_network_put(
        {"proxyUrls": "http://a:1\nhttp://b:2", "proxyEnabled": True},
        None,
    )
    assert merged["proxyUrls"] == ["http://a:1", "http://b:2"]
    assert merged["proxyEnabled"] is True

    merged2 = merge_network_put(
        {"defaultProxyUrls": "http://legacy:9"},
        merged,
    )
    assert merged2["proxyUrls"] == ["http://legacy:9"]
    assert "defaultProxyUrls" not in merged2


def test_network_settings_payload_masks_env_urls(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.network_settings.settings.DEFAULT_PROXY_URLS",
        "http://secret:pass@env:8080",
    )
    payload = network_settings_payload({"proxyEnabled": True, "proxyUrls": []})
    assert payload["envFallbackConfigured"] is True
    assert payload["usingEnvFallback"] is True
    assert "defaultProxyUrls" not in payload
    assert "secret" not in str(payload)


def test_redact_proxy_url_masks_credentials() -> None:
    assert (
        redact_proxy_url("http://user:secret@proxy.example:8080")
        == "http://***@proxy.example:8080"
    )
    assert redact_proxy_url("direct") == "direct"
    assert redact_proxy_url(None) is None


def test_merge_network_put_clamps_proxy_concurrency() -> None:
    merged = merge_network_put(
        {
            "proxyDefaultConcurrency": 99,
            "proxyConcurrencyOverrides": {"http://a:1": 0, "socks5://b:2": 25},
        },
        None,
    )
    assert merged["proxyDefaultConcurrency"] == 20
    assert merged["proxyConcurrencyOverrides"] == {
        "http://a:1": 1,
        "socks5h://b:2": 20,
    }


def test_resolve_proxy_concurrency_defaults(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.network_settings.settings.PROXY_DEFAULT_CONCURRENCY_DEFAULT",
        2,
    )
    default, overrides = resolve_proxy_concurrency({})
    assert default == 2
    assert overrides == {}


def test_compute_proxy_pool_capacity_empty() -> None:
    assert compute_proxy_pool_capacity([], 1, {}) == 0


def test_merge_network_put_validates_proxy_concurrency() -> None:
    merged = merge_network_put(
        {
            "proxyDefaultConcurrency": 25,
            "proxyConcurrencyOverrides": {
                "http://a:1": 0,
                "socks5://b:2": 5,
            },
        },
        None,
    )
    assert merged["proxyDefaultConcurrency"] == 20
    assert merged["proxyConcurrencyOverrides"][normalize_proxy_url("http://a:1")] == 1
    assert merged["proxyConcurrencyOverrides"][normalize_proxy_url("socks5://b:2")] == 5


def test_network_settings_payload_includes_proxy_concurrency_defaults(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.network_settings.settings.PROXY_DEFAULT_CONCURRENCY_DEFAULT",
        2,
    )
    payload = network_settings_payload({})
    assert payload["proxyDefaultConcurrency"] == 2
    assert payload["proxyConcurrencyOverrides"] == {}


def test_resolve_proxy_concurrency_and_capacity() -> None:
    network = {
        "proxyDefaultConcurrency": 2,
        "proxyConcurrencyOverrides": {"http://fast:1": 4},
    }
    default, overrides = resolve_proxy_concurrency(network)
    assert default == 2
    assert overrides[normalize_proxy_url("http://fast:1")] == 4
    assert (
        compute_proxy_pool_capacity(
            ["http://fast:1", "http://slow:2"],
            default,
            overrides,
        )
        == 6
    )
