"""An unapproved account can sign in, see why, and reach nothing else.

Approval is deliberately *not* enforced at login. A refused login leaves nowhere
to explain the situation — the person gets an error on a form and no way to tell
"wrong password" from "waiting for an admin". So the token is issued, `/users/me`
answers, and everything carrying data refuses with its own distinct reason,
which is what lets the app show a page instead of a permission error on every
action.

That makes the *list* of gated routers the security boundary. A new data router
mounted without the dependency is a hole with no symptom, so the guard here
inverts the check: it asserts every router other than the named exceptions is
gated, and each exception says why.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.deps import PENDING_APPROVAL_DETAIL
from app.core.config import settings
from app.core.db import engine
from app.core.security import get_password_hash
from app.main import app
from app.models import User
from app.models_rbac import UserRole

PREFIX = settings.API_V1_STR

#: Routers a person must reach *before* approval, and the reason for each.
#: Anything not listed here has to be gated — see the guard at the bottom.
UNGATED_PREFIXES = {
    "/api/v1/login": "how an unapproved person gets a token at all",
    "/api/v1/users": "/users/me is how the app learns to show the pending page",
    "/api/v1/utils": "health check; no user data",
    "/api/v1/private": "local-only test helper router",
    # These sit on the `login` router but not under its prefix — it is mounted
    # prefix-less at `/api/v1`, the same quirk that made forgot-password
    # unreachable in ticket 01. Recovering a password must not require approval:
    # needing an admin before you can reset a password you already own would be
    # a lockout, not a gate. The `-html-content` variant is superuser-only
    # through its own dependency.
    "/api/v1/password-recovery": "resetting your own password predates approval",
    "/api/v1/reset-password": "resetting your own password predates approval",
}

PASSWORD = "pending-user-password-123"


@pytest.fixture
def pending_user() -> str:
    """An account that exists, is active, and has not been approved."""
    email = f"pending-{uuid.uuid4().hex[:12]}@example.com"
    with Session(engine) as session:
        session.add(
            User(
                email=email,
                hashed_password=get_password_hash(PASSWORD),
                is_active=True,
                is_approved=False,
            )
        )
        session.commit()

    yield email

    with Session(engine) as session:
        row = session.exec(select(User).where(User.email == email)).first()
        if row is not None:
            session.exec(delete(UserRole).where(UserRole.user_id == row.id))
            session.delete(row)
            session.commit()


def _token(client: TestClient, email: str, password: str = PASSWORD) -> str:
    response = client.post(
        f"{PREFIX}/login/access-token",
        data={"username": email, "password": password},
    )
    assert response.status_code == 200, response.text
    token: str = response.json()["access_token"]
    return token


@pytest.mark.security
def test_an_unapproved_account_can_still_log_in(
    client: TestClient, pending_user: str
) -> None:
    """Refusing the login would leave nowhere to explain the situation."""
    assert _token(client, pending_user)


@pytest.mark.security
def test_an_unapproved_account_can_read_its_own_record(
    client: TestClient, pending_user: str
) -> None:
    """The app needs this to know it should show the pending page."""
    headers = {"Authorization": f"Bearer {_token(client, pending_user)}"}
    response = client.get(f"{PREFIX}/users/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["is_approved"] is False


@pytest.mark.security
@pytest.mark.parametrize(
    "path",
    [
        f"{PREFIX}/data/channels",
        f"{PREFIX}/jobs/status",
        f"{PREFIX}/ai/models",
        f"{PREFIX}/rag/status",
    ],
)
def test_an_unapproved_account_reaches_no_data(
    client: TestClient, pending_user: str, path: str
) -> None:
    headers = {"Authorization": f"Bearer {_token(client, pending_user)}"}
    response = client.get(path, headers=headers)
    assert response.status_code == 403, f"{path} -> {response.status_code}"
    assert response.json()["detail"] == PENDING_APPROVAL_DETAIL


@pytest.mark.security
def test_the_refusal_is_distinguishable_from_a_permissions_refusal(
    client: TestClient, pending_user: str, normal_user_token_headers: dict[str, str]
) -> None:
    """Two different 403s that resolve in completely different ways.

    "Wait for an admin" is someone else's action; "you may not do this" is
    final. The app routes on the difference, so the strings must not converge.
    """
    pending = client.get(
        f"{PREFIX}/data/channels",
        headers={"Authorization": f"Bearer {_token(client, pending_user)}"},
    )
    forbidden = client.get(f"{PREFIX}/users/", headers=normal_user_token_headers)

    assert pending.status_code == forbidden.status_code == 403
    assert pending.json()["detail"] != forbidden.json()["detail"]


@pytest.mark.security
def test_approving_the_account_opens_the_data_routes(
    client: TestClient, pending_user: str, superuser_token_headers: dict[str, str]
) -> None:
    """The whole point: an Admin flips one field and the person is in.

    `/data/channels` rather than `/jobs/status`, which this used until ticket 18
    made the scheduler Admin-only. Approval and permission are different gates
    that both answer 403, so a route behind *both* of them cannot show that the
    first one opened — this test would have gone on passing its first assertion
    for the wrong reason and failing its last one forever.
    """
    headers = {"Authorization": f"Bearer {_token(client, pending_user)}"}
    assert client.get(f"{PREFIX}/data/channels", headers=headers).status_code == 403

    with Session(engine) as session:
        row = session.exec(select(User).where(User.email == pending_user)).first()
        assert row is not None
        user_id = row.id

    approved = client.patch(
        f"{PREFIX}/users/{user_id}",
        json={"is_approved": True},
        headers=superuser_token_headers,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["is_approved"] is True

    assert client.get(f"{PREFIX}/data/channels", headers=headers).status_code == 200


@pytest.mark.security
def test_disabling_is_separate_from_un_approving(
    client: TestClient, pending_user: str, superuser_token_headers: dict[str, str]
) -> None:
    """Approve, then disable: the account is off without losing its approval."""
    with Session(engine) as session:
        row = session.exec(select(User).where(User.email == pending_user)).first()
        assert row is not None
        user_id = row.id

    client.patch(
        f"{PREFIX}/users/{user_id}",
        json={"is_approved": True},
        headers=superuser_token_headers,
    )
    disabled = client.patch(
        f"{PREFIX}/users/{user_id}",
        json={"is_active": False},
        headers=superuser_token_headers,
    )
    assert disabled.status_code == 200
    assert disabled.json()["is_active"] is False
    assert disabled.json()["is_approved"] is True, (
        "disabling an account revoked its approval; re-enabling it would then "
        "silently send the person back to the pending queue"
    )

    # A disabled account cannot even get a token, which is the difference
    # between "turned off" and "not yet let in".
    refused = client.post(
        f"{PREFIX}/login/access-token",
        data={"username": pending_user, "password": PASSWORD},
    )
    assert refused.status_code == 400


# ---------------------------------------------------------------- the guard


def _gated_prefixes() -> tuple[set[str], set[str]]:
    """`(gated, ungated)` router prefixes, read off the mounted application."""
    from fastapi.routing import APIRoute

    from app.api.deps import require_approved_user

    gated: set[str] = set()
    ungated: set[str] = set()

    def walk(routes: list, prefix: str, inherited: bool) -> None:
        for route in routes:
            if type(route).__name__ == "_IncludedRouter":
                context = route.include_context
                carries = inherited or any(
                    getattr(dependency, "dependency", None) is require_approved_user
                    for dependency in (context.dependencies or [])
                )
                walk(route.original_router.routes, prefix + context.prefix, carries)
            elif isinstance(route, APIRoute):
                family = "/".join((prefix + route.path).split("/")[:4])
                (gated if inherited else ungated).add(family)

    walk(app.routes, "", False)
    return gated, ungated


def test_the_guard_can_see_the_routers() -> None:
    gated, ungated = _gated_prefixes()
    assert gated, "no gated routers found — this guard is checking nothing"


@pytest.mark.security
def test_every_data_router_requires_an_approved_account() -> None:
    """Inverted on purpose: unknown routers are gated, not exempt.

    A guard listing what *must* be gated silently permits the next router
    someone adds. This one fails on anything unrecognised, so adding a data
    router without the dependency breaks the build, and deliberately exempting
    one means writing down why.
    """
    _, ungated = _gated_prefixes()
    unexplained = sorted(
        family
        for family in ungated
        if not any(family.startswith(prefix) for prefix in UNGATED_PREFIXES)
    )
    assert not unexplained, (
        "these route families are reachable by an account nobody has approved "
        "yet. Mount them with `dependencies=APPROVED_ONLY` in `api/main.py`, or "
        "add them to UNGATED_PREFIXES with the reason:\n  " + "\n  ".join(unexplained)
    )
