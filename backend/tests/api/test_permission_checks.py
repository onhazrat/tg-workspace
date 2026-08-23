"""Authorisation names a permission, and the existing superuser lost nothing.

Ticket 07 moved every authorisation check from `user.is_superuser` to a named
permission resolved through role assignments. Two things can go wrong with that
and only one is obvious.

The obvious one: the superuser stops being able to do things. That is what the
behavioural tests below cover, route by route, against the accounts the suite
already has.

The quiet one: `is_superuser` keeps being consulted *somewhere*, so there are
two answers to "can this user do X". They agree today and drift later, and
because both fail closed the symptom is a person who cannot do their job rather
than an alarm. The guard at the bottom is the one that matters in six months.
"""

from __future__ import annotations

import ast
import pathlib

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = settings.API_V1_STR

_APP = pathlib.Path(__file__).resolve().parents[2] / "app"

#: Routes that required `is_superuser` before ticket 07 and now require a
#: permission. The superuser must still reach every one of them — that is the
#: ticket's "with no loss of access" in executable form.
SUPERUSER_ROUTES = [
    ("GET", f"{PREFIX}/users/", None),
    ("PATCH", f"{PREFIX}/users/{{user_id}}", {"full_name": "Renamed By Admin"}),
    (
        "POST",
        f"{PREFIX}/password-recovery-html-content/{settings.EMAIL_TEST_USER}",
        None,
    ),
]


def _call(client: TestClient, method: str, path: str, body: dict | None, headers: dict):
    if method == "GET":
        return client.get(path, headers=headers)
    if method == "PATCH":
        return client.patch(path, json=body, headers=headers)
    return client.post(path, json=body, headers=headers)


def _normal_user_id(client: TestClient, headers: dict[str, str]) -> str:
    me = client.get(f"{PREFIX}/users/me", headers=headers)
    assert me.status_code == 200
    return str(me.json()["id"])


@pytest.mark.security
@pytest.mark.parametrize("method,path,body", SUPERUSER_ROUTES)
def test_the_existing_superuser_keeps_its_access(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    method: str,
    path: str,
    body: dict | None,
) -> None:
    """`init_db` gives the bootstrap superuser the Admin role; this proves it."""
    target = _normal_user_id(client, normal_user_token_headers)
    response = _call(
        client, method, path.format(user_id=target), body, superuser_token_headers
    )
    assert response.status_code < 400, (
        f"{method} {path} returned {response.status_code} for the superuser: "
        f"{response.text[:200]}"
    )


@pytest.mark.security
@pytest.mark.parametrize("method,path,body", SUPERUSER_ROUTES)
def test_a_plain_user_is_refused(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    method: str,
    path: str,
    body: dict | None,
) -> None:
    target = _normal_user_id(client, normal_user_token_headers)
    response = _call(
        client, method, path.format(user_id=target), body, normal_user_token_headers
    )
    assert response.status_code == 403, (
        f"{method} {path} returned {response.status_code} for a user with no "
        "permissions"
    )


@pytest.mark.security
def test_the_refusal_does_not_name_the_missing_permission(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """The caller cannot act on it, and it describes the authorisation model."""
    response = client.get(f"{PREFIX}/users/", headers=normal_user_token_headers)
    assert response.json()["detail"] == "The user doesn't have enough privileges"


@pytest.mark.security
def test_a_user_can_still_read_and_update_their_own_account(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """Losing `is_superuser` must not have cost anyone their *own* account."""
    assert (
        client.get(f"{PREFIX}/users/me", headers=normal_user_token_headers).status_code
        == 200
    )
    patched = client.patch(
        f"{PREFIX}/users/me",
        json={"full_name": "Still Mine"},
        headers=normal_user_token_headers,
    )
    assert patched.status_code == 200


# ---------------------------------------------------------------- the guard

#: Modules where `is_superuser` may legitimately appear: the model that declares
#: the column, the bootstrap that sets it, and the migration that reads it once
#: to seed role assignments. Anywhere else is an authorisation decision.
_ALLOWED = {
    _APP / "models.py",
    _APP / "core" / "db.py",
}


def _reads_is_superuser(path: pathlib.Path) -> bool:
    """Whether the module reads `<something>.is_superuser` as a value.

    Attribute *access* only. Assigning it (`is_superuser=True` as a keyword, or
    the model's field declaration) is not an authorisation decision, which is
    why the bootstrap is not flagged by this and does not need to be excused.
    """
    tree = ast.parse(path.read_text())
    return any(
        isinstance(node, ast.Attribute)
        and node.attr == "is_superuser"
        and isinstance(node.ctx, ast.Load)
        for node in ast.walk(tree)
    )


@pytest.mark.security
def test_no_authorisation_path_reads_is_superuser() -> None:
    """One question, one answer.

    The column still exists — a later ticket drops it — but the moment anything
    consults it alongside the role tables there are two sources of truth for
    "can this user do X", and nothing anywhere notices when they disagree.
    """
    offenders = sorted(
        str(path.relative_to(_APP))
        for path in [*(_APP / "api").rglob("*.py"), *(_APP / "services").rglob("*.py")]
        if path not in _ALLOWED and _reads_is_superuser(path)
    )
    assert not offenders, (
        "these modules decide authorisation from `is_superuser` instead of a "
        "permission, so the role tables are no longer the only answer:\n  "
        + "\n  ".join(offenders)
    )


@pytest.mark.security
def test_no_route_module_authorises_by_role_name() -> None:
    """ "Check a permission, never a role" is the whole point of the ticket.

    `ROLE_ADMIN` is legitimate in the bootstrap, which *assigns* the role. In a
    route it means someone reintroduced "is this person an admin", and a fourth
    role stops being an insert.
    """
    routes = sorted((_APP / "api").rglob("*.py"))
    assert routes, "found no route modules — this guard is checking nothing"

    offenders = [
        str(path.relative_to(_APP))
        for path in routes
        if any(
            name in path.read_text()
            for name in ("ROLE_ADMIN", "ROLE_OWNER", "ROLE_USER")
        )
    ]
    assert not offenders, (
        f"route modules naming a role instead of a permission: {offenders}"
    )
