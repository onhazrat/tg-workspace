"""Startup validation for Mode A production requirements."""

from __future__ import annotations

import pytest

from app.core.startup_checks import run_startup_checks


def test_startup_checks_local_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "local")
    from app.core.config import Settings

    monkeypatch.setattr("app.core.startup_checks.settings", Settings())
    run_startup_checks()


def test_production_settings_reject_missing_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("API_KEY", "")
    monkeypatch.setenv(
        "TOKEN_ENCRYPTION_KEY", "dGVzdC1mZXJuZXQta2V5LWZvci1wcm9kLXRlc3RzMTI="
    )
    monkeypatch.setenv("SECRET_KEY", "not-changethis-production-secret-key")
    monkeypatch.setenv("POSTGRES_PASSWORD", "not-changethis-postgres")
    monkeypatch.setenv("FIRST_SUPERUSER_PASSWORD", "not-changethis-admin")
    from app.core.config import Settings

    with pytest.raises(ValueError, match="API_KEY"):
        Settings()


def test_startup_checks_production_missing_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("API_KEY", "")
    monkeypatch.setenv(
        "TOKEN_ENCRYPTION_KEY", "dGVzdC1mZXJuZXQta2V5LWZvci1wcm9kLXRlc3RzMTI="
    )
    monkeypatch.setenv("SECRET_KEY", "not-changethis-production-secret-key")
    monkeypatch.setenv("POSTGRES_PASSWORD", "not-changethis-postgres")
    monkeypatch.setenv("FIRST_SUPERUSER_PASSWORD", "not-changethis-admin")
    from app.core.config import Settings

    # Config validator blocks startup before run_startup_checks when API_KEY is missing.
    with pytest.raises(ValueError, match="API_KEY"):
        Settings()
