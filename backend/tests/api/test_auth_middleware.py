"""`APIKeyMiddleware` behaviour outside `local`, where it actually does something.

Every other test in this suite runs with `ENVIRONMENT=local` and no `API_KEY`,
which is the one configuration where this middleware waves everything through.
That is why a logged-out browser could not reach forgot-password on staging for
months while the suite stayed green. These tests pin the deployed behaviour by
patching the environment the middleware reads.
"""

from __future__ import annotations

import ast
import pathlib

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.middleware import api_key

PREFIX = settings.API_V1_STR

_MIDDLEWARE_SOURCE = pathlib.Path(api_key.__file__)


@pytest.fixture
def hardened(monkeypatch: pytest.MonkeyPatch) -> str:
    """Put the middleware in its deployed configuration: not local, key required."""
    monkeypatch.setattr(api_key.settings, "ENVIRONMENT", "staging")
    monkeypatch.setattr(api_key.settings, "API_KEY", "test-api-key-0123456789")
    return "test-api-key-0123456789"


@pytest.mark.security
@pytest.mark.parametrize(
    "path",
    [
        f"{PREFIX}/password-recovery/nobody@example.com",
        f"{PREFIX}/reset-password/",
        f"{PREFIX}/login/access-token",
    ],
)
def test_logged_out_auth_flows_get_past_the_middleware(
    client: TestClient, hardened: str, path: str
) -> None:
    """The forgot-password flow is usable with neither a JWT nor an API key.

    Asserting "not 401" rather than a success code on purpose: the handlers
    reject the empty bodies posted here on their own terms (400/422), and what
    is under test is which gate answered, not what it said.
    """
    response = client.post(path, json={})
    assert response.status_code != 401, (
        f"{path} was blocked by the auth middleware; a logged-out browser cannot "
        "reach it in staging or production"
    )


# Which gate answered, read off the 401 body. Both gates reject with 401, so the
# status code alone cannot tell them apart — and telling them apart is the whole
# point here, since a route can be protected by its own dependency while the
# middleware wrongly considers it public. `APIKeyMiddleware` says
# "Authentication required"; the route's OAuth2 dependency says "Not
# authenticated".
_BLOCKED_BY_MIDDLEWARE = "Authentication required"
_BLOCKED_BY_ROUTE = "Not authenticated"


def _rejected_by(
    client: TestClient, path: str, headers: dict[str, str | bytes] | None = None
) -> str:
    response = client.post(path, headers=headers or {})
    assert response.status_code == 401, response.status_code
    detail: str = response.json()["detail"]
    return detail


@pytest.mark.security
def test_the_superuser_recovery_variant_is_not_public_to_the_middleware(
    client: TestClient, hardened: str
) -> None:
    """The neighbouring route that renders a live reset token stays shut.

    Asserted through *which* gate rejects it, not the status code: its superuser
    dependency answers 401 too, so a middleware that wrongly treated it as
    public would look identical from the outside.
    """
    rejected = _rejected_by(
        client, f"{PREFIX}/password-recovery-html-content/nobody@example.com"
    )
    assert rejected == _BLOCKED_BY_MIDDLEWARE


@pytest.mark.security
def test_a_protected_route_is_still_blocked_without_credentials(
    client: TestClient, hardened: str
) -> None:
    assert _rejected_by(client, f"{PREFIX}/jobs/auto_sync/trigger") == (
        _BLOCKED_BY_MIDDLEWARE
    )


@pytest.mark.security
def test_the_configured_api_key_gets_past_the_middleware(
    client: TestClient, hardened: str
) -> None:
    """A correct key never reaches a handler — every protected route also wants
    a JWT — so its only visible effect is which layer says no."""
    rejected = _rejected_by(
        client, f"{PREFIX}/jobs/auto_sync/trigger", {"X-API-Key": hardened}
    )
    assert rejected == _BLOCKED_BY_ROUTE


@pytest.mark.security
@pytest.mark.parametrize(
    "wrong",
    [
        "wrong",
        # Shares every character but the last: what a timing attack produces, so
        # the one guess that must not be treated as close enough.
        "test-api-key-012345678",
        "test-api-key-0123456789 ",
        # Non-ASCII, sent as raw bytes because that is the only way it reaches a
        # server: `hmac.compare_digest` raises `TypeError` on `str` outside
        # ASCII, and Starlette decodes headers as latin-1, so comparing without
        # encoding first turns one header byte into a 500 anyone can trigger.
        b"test-api-key-012345678\xe9",
        b"\xff\xfe\xfd",
    ],
)
def test_a_wrong_api_key_is_rejected_by_the_middleware(
    client: TestClient, hardened: str, wrong: str | bytes
) -> None:
    rejected = _rejected_by(
        client, f"{PREFIX}/jobs/auto_sync/trigger", {"X-API-Key": wrong}
    )
    assert rejected == _BLOCKED_BY_MIDDLEWARE


@pytest.mark.security
def test_the_api_key_comparison_is_constant_time() -> None:
    """Source-level, because timing is not observable from a test.

    `==` on `str` returns as soon as two bytes differ, so the time to reject a
    guess leaks how many leading characters were right — enough to recover a key
    one character at a time over enough requests. `hmac.compare_digest` compares
    the whole value regardless. No runtime assertion can tell the two apart
    without a timing harness far too flaky to keep, so this reads the code.
    """
    tree = ast.parse(_MIDDLEWARE_SOURCE.read_text())

    compared_with_equality = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Compare)
        and any(isinstance(op, ast.Eq | ast.NotEq) for op in node.ops)
        and "API_KEY" in ast.dump(node)
    ]
    assert not compared_with_equality, (
        "the API key is compared with `==` in "
        f"{_MIDDLEWARE_SOURCE.name}; use `hmac.compare_digest`"
    )

    uses_compare_digest = any(
        isinstance(node, ast.Call)
        and (
            (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "compare_digest"
            )
            or (isinstance(node.func, ast.Name) and node.func.id == "compare_digest")
        )
        for node in ast.walk(tree)
    )
    assert uses_compare_digest, (
        f"{_MIDDLEWARE_SOURCE.name} no longer calls `compare_digest`; the API key "
        "comparison is not constant-time"
    )
