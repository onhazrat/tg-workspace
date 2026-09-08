"""The admin configuration inventory is complete, layered, and redacted."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings, settings

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
