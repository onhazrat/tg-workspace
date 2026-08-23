"""`POST /users/signup` answers the same way for every address.

It used to reply 400 "the user with this email already exists" for a registered
address and 200 for an unregistered one. That is the same account oracle ticket
01 closed on password recovery, still open one route over — and cheaper to walk,
because it needs no mail configuration to work.

The reply is now one fixed message with a 202, and the route returns a message
rather than the created account. That last part is structural: a body carrying
an id only exists when an account was really created, so returning `UserPublic`
would reopen the leak by construction no matter how carefully the status codes
were matched.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.users import REGISTRATION_RECEIVED
from app.core.config import settings
from app.core.db import engine
from app.core.permissions import ROLE_USER
from app.models import User
from app.models_rbac import UserRole
from app.services import rbac

PREFIX = settings.API_V1_STR

PASSWORD = "a-new-account-password-123"


def _fresh_email() -> str:
    return f"signup-{uuid.uuid4().hex[:12]}@example.com"


def _delete(email: str) -> None:
    with Session(engine) as session:
        row = session.exec(select(User).where(User.email == email)).first()
        if row is not None:
            session.exec(delete(UserRole).where(UserRole.user_id == row.id))
            session.delete(row)
            session.commit()


@pytest.fixture
def created_emails() -> list[str]:
    emails: list[str] = []
    yield emails
    for email in emails:
        _delete(email)


def _signup(client: TestClient, email: str):
    return client.post(
        f"{PREFIX}/users/signup",
        json={"email": email, "password": PASSWORD, "full_name": "New Person"},
    )


@pytest.mark.security
def test_a_taken_address_is_indistinguishable_from_a_free_one(
    client: TestClient, created_emails: list[str]
) -> None:
    taken = _fresh_email()
    free = _fresh_email()
    created_emails.extend([taken, free])

    _signup(client, taken)  # now registered

    again = _signup(client, taken)
    other = _signup(client, free)

    assert again.status_code == other.status_code == 202
    assert again.json() == other.json() == {"message": REGISTRATION_RECEIVED}
    assert again.headers.get("content-type") == other.headers.get("content-type")


@pytest.mark.security
def test_signing_up_twice_does_not_create_a_second_account(
    client: TestClient, created_emails: list[str]
) -> None:
    """The uniform reply must not be achieved by actually registering again."""
    email = _fresh_email()
    created_emails.append(email)

    _signup(client, email)
    _signup(client, email)

    with Session(engine) as session:
        rows = session.exec(select(User).where(User.email == email)).all()
    assert len(rows) == 1


@pytest.mark.security
def test_the_reply_body_never_contains_an_account(
    client: TestClient, created_emails: list[str]
) -> None:
    """A body with an id in it is a body that leaks whether creation happened."""
    email = _fresh_email()
    created_emails.append(email)

    body = _signup(client, email).json()
    assert set(body) == {"message"}


def test_registration_assigns_the_default_role(
    client: TestClient, created_emails: list[str]
) -> None:
    email = _fresh_email()
    created_emails.append(email)
    _signup(client, email)

    with Session(engine) as session:
        row = session.exec(select(User).where(User.email == email)).first()
        assert row is not None
        assert ROLE_USER in rbac.role_ids_for(session, row.id)


def test_registration_approves_by_default(
    client: TestClient, created_emails: list[str]
) -> None:
    """The setting is off unless an operator turns it on."""
    assert settings.USERS_REQUIRE_APPROVAL is False

    email = _fresh_email()
    created_emails.append(email)
    _signup(client, email)

    with Session(engine) as session:
        row = session.exec(select(User).where(User.email == email)).first()
        assert row is not None
        assert row.is_approved is True


def test_registration_withholds_approval_when_required(
    client: TestClient, created_emails: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import users as users_route

    monkeypatch.setattr(users_route.settings, "USERS_REQUIRE_APPROVAL", True)

    email = _fresh_email()
    created_emails.append(email)
    response = _signup(client, email)

    assert response.status_code == 202
    assert response.json() == {"message": REGISTRATION_RECEIVED}

    with Session(engine) as session:
        row = session.exec(select(User).where(User.email == email)).first()
        assert row is not None
        assert row.is_approved is False
        assert row.is_active is True, "waiting for approval is not being disabled"


def test_an_admin_created_account_is_approved_even_when_approval_is_required(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    created_emails: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An Admin filling the form has already vouched for the account.

    Only self-signup can land unapproved; making an Admin approve accounts they
    just created by hand would be a queue of their own paperwork.
    """
    from app.api.routes import users as users_route

    monkeypatch.setattr(users_route.settings, "USERS_REQUIRE_APPROVAL", True)

    email = _fresh_email()
    created_emails.append(email)
    response = client.post(
        f"{PREFIX}/users/",
        json={"email": email, "password": PASSWORD},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_approved"] is True


def test_registration_stays_closed_when_it_is_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import users as users_route

    monkeypatch.setattr(users_route.settings, "USERS_OPEN_REGISTRATION", False)

    response = _signup(client, _fresh_email())
    assert response.status_code == 403
