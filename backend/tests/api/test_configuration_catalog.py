"""The admin configuration inventory is complete, layered, and redacted."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import SENSITIVE_CONFIG_SUFFIXES, Settings, settings
from app.services.configuration_catalog import _redact

PREFIX = f"{settings.API_V1_STR}/data/configuration"


def test_catalog_requires_admin(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.get(PREFIX, headers=normal_user_token_headers)
    assert response.status_code == 403


def test_catalog_has_all_five_layers_and_backend_fields(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.get(PREFIX, headers=superuser_token_headers)
    assert response.status_code == 200, response.text[:500]
    layers = {layer["id"]: layer for layer in response.json()["layers"]}
    assert list(layers) == [
        "deployment",
        "global",
        "user",
        "specialized",
        "frontend",
    ]

    deployment = {entry["key"]: entry for entry in layers["deployment"]["entries"]}
    assert set(Settings.model_fields) <= set(deployment)
    assert deployment["SECRET_KEY"]["sensitive"] is True
    assert deployment["SECRET_KEY"]["value"] == "••••••"
    assert "changethis" not in response.text

    assert layers["global"]["entries"]
    assert layers["user"]["entries"]
    assert layers["specialized"]["entries"]
    assert any(
        entry["key"] == "VITE_API_URL" for entry in layers["frontend"]["entries"]
    )


def test_sensitive_settings_are_classified_by_suffix() -> None:
    catalog_path = (
        Path(__file__).resolve().parents[2] / "app/core/env_catalog.generated.json"
    )
    manifest = {
        item["name"]: item for item in json.loads(catalog_path.read_text())["variables"]
    }
    sensitive_fields = {
        name
        for name in Settings.model_fields
        if name.endswith(SENSITIVE_CONFIG_SUFFIXES)
    }
    assert sensitive_fields
    assert not sorted(
        name for name in sensitive_fields if not manifest[name]["sensitive"]
    )


def test_redaction_masks_proxy_credentials_without_changing_shapes() -> None:
    result = _redact(
        {
            "torSocksProxy": "socks5h://user:secret@127.0.0.1:9050",
            "proxyUrls": ["http://u:p@1.2.3.4:8080", "direct"],
            "proxyConcurrencyOverrides": {"http://u:p@1.2.3.4:8080": 3},
            "password": "nested-secret",
        }
    )
    assert result == {
        "torSocksProxy": "socks5h://***@127.0.0.1:9050",
        "proxyUrls": ["http://***@1.2.3.4:8080", "direct"],
        "proxyConcurrencyOverrides": {"http://***@1.2.3.4:8080": 3},
        "password": "••••••",
    }
