"""Tests for per-user network settings and proxy resolution."""

from app.services.network_settings import (
    merge_network_put,
    network_settings_payload,
    redact_proxy_url,
    resolve_proxies,
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
