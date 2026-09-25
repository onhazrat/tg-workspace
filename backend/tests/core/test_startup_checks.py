"""Startup validation for Mode A production requirements."""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from app.core.startup_checks import _DEV_FERNET_KEY, run_startup_checks


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


_GOOD_KEY = "dGVzdC1mZXJuZXQta2V5LWZvci1wcm9kLXRlc3RzMTI="


def _settings(**overrides: object) -> SimpleNamespace:
    """Only the four fields `run_startup_checks` reads.

    A namespace rather than `Settings()`, because the real validators refuse
    most of the bad configurations below before this function could see them,
    and this function is the second line that has to hold on its own.
    """
    base: dict[str, object] = {
        "ENVIRONMENT": "staging",
        "API_KEY": "",
        "TOKEN_ENCRYPTION_KEY": _GOOD_KEY,
        "USERS_OPEN_REGISTRATION": False,
    }
    return SimpleNamespace(**(base | overrides))


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        pytest.param({"TOKEN_ENCRYPTION_KEY": ""}, "must be set", id="no-key"),
        pytest.param({"TOKEN_ENCRYPTION_KEY": "   "}, "must be set", id="blank-key"),
        pytest.param(
            {"TOKEN_ENCRYPTION_KEY": f" {_DEV_FERNET_KEY} "},
            "dev placeholder",
            id="dev-placeholder-key",
        ),
        pytest.param(
            {"ENVIRONMENT": "production", "API_KEY": "  "},
            "API_KEY",
            id="production-without-api-key",
        ),
        pytest.param({}, None, id="staging-needs-no-api-key"),
        pytest.param(
            {"ENVIRONMENT": "production", "API_KEY": "k"}, None, id="production-ok"
        ),
        pytest.param(
            {"ENVIRONMENT": "local", "TOKEN_ENCRYPTION_KEY": ""},
            None,
            id="local-skips-every-check",
        ),
    ],
)
def test_startup_checks_refuse_an_unsafe_deployment(
    monkeypatch: pytest.MonkeyPatch,
    overrides: dict[str, object],
    error: str | None,
) -> None:
    monkeypatch.setattr("app.core.startup_checks.settings", _settings(**overrides))
    if error is None:
        run_startup_checks()
    else:
        with pytest.raises(ValueError, match=error):
            run_startup_checks()


@pytest.mark.parametrize(
    ("overrides", "level", "phrase"),
    [
        ({"USERS_OPEN_REGISTRATION": True}, logging.WARNING, "set false"),
        ({"USERS_OPEN_REGISTRATION": False}, logging.INFO, "signup is disabled"),
        ({"ENVIRONMENT": "local"}, logging.WARNING, "API_KEY is unset"),
    ],
)
def test_startup_checks_say_what_they_let_through(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    overrides: dict[str, object],
    level: int,
    phrase: str,
) -> None:
    monkeypatch.setattr("app.core.startup_checks.settings", _settings(**overrides))
    with caplog.at_level(logging.INFO, logger="app.core.startup_checks"):
        run_startup_checks()
    assert [r.levelno for r in caplog.records if phrase in r.getMessage()] == [level]
