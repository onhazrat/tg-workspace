"""The Admin quota view: what it shows, and who may see it (ticket 08).

The route is read-only and the ledger it reads is observational, which makes it
easy to treat the authorisation as a formality. It is not one: usage is a
behavioural record of when an account synced and how hard, and the plan's
`QUOTA_READ_ANY` exists precisely so that reading it is a separate grant from
administering accounts.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.core.security import get_password_hash
from app.models import User
from app.services.quota import Budget, charge_requests, today_utc

PREFIX = settings.API_V1_STR
USAGE_URL = f"{PREFIX}/quota/usage"
PASSWORD = "quota-route-password-123"


@pytest.fixture
def spender() -> Generator[tuple[uuid.UUID, str]]:
    """An approved account that has spent against two Budgets today."""
    email = f"spender-{uuid.uuid4().hex[:12]}@example.com"
    with Session(engine) as session:
        user = User(
            email=email,
            hashed_password=get_password_hash(PASSWORD),
            is_approved=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        user_id = user.id

    with Session(engine) as session:
        charge_requests(session, user_id, Budget.AUTO_SYNC, 12)
        charge_requests(session, user_id, Budget.MANUAL_SINGLE, 3)

    yield user_id, email

    with Session(engine) as session:
        row = session.get(User, user_id)
        if row is not None:
            session.delete(row)
            session.commit()


def _entry_for(payload: dict, email: str) -> dict:
    matches = [e for e in payload["entries"] if e["email"] == email]
    assert matches, f"{email} missing from {payload['entries']}"
    return matches[0]


def test_an_admin_sees_per_account_usage_per_budget(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    spender: tuple[uuid.UUID, str],
) -> None:
    user_id, email = spender
    response = client.get(USAGE_URL, headers=superuser_token_headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["day"] == today_utc().isoformat()

    entry = _entry_for(payload, email)
    assert entry["userId"] == str(user_id)
    assert entry["autoSync"] == 12
    assert entry["manualSingle"] == 3
    assert entry["manualBulk"] == 0
    assert entry["total"] == 15


def test_a_day_with_no_usage_is_an_empty_list_not_a_page_of_zeros(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    spender: tuple[uuid.UUID, str],
) -> None:
    """The ledger holds rows only for work that happened, and the view follows.

    Mutation: emit one entry per account regardless. On a deployment with two
    hundred accounts and three active ones, the useful answer is three rows.
    """
    response = client.get(
        USAGE_URL, headers=superuser_token_headers, params={"day": "2001-01-01"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["day"] == "2001-01-01"
    assert payload["entries"] == []


def test_an_ordinary_account_may_not_read_the_ledger(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    """Mutation: gate on `CurrentUser` alone.

    Usage is a behavioural record of every other account on the deployment.
    Ticket 07's rule is that this names a permission, and the default `user`
    role holds none.
    """
    response = client.get(USAGE_URL, headers=normal_user_token_headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "The user doesn't have enough privileges"


def test_the_ledger_is_not_readable_without_a_token(client: TestClient) -> None:
    response = client.get(USAGE_URL)
    assert response.status_code == 401


def test_a_malformed_day_is_refused_rather_than_silently_meaning_today(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    """A typo in the date must not answer with today's numbers under it."""
    response = client.get(
        USAGE_URL, headers=superuser_token_headers, params={"day": "not-a-date"}
    )
    assert response.status_code == 422


def test_yesterday_and_today_are_separate_days(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    spender: tuple[uuid.UUID, str],
) -> None:
    """The reset is a day boundary, so the view has to honour one."""
    _user_id, email = spender
    with Session(engine) as session:
        charge_requests(session, _user_id, Budget.MANUAL_BULK, 7, day=date(2026, 1, 2))

    today = client.get(USAGE_URL, headers=superuser_token_headers).json()
    assert _entry_for(today, email)["manualBulk"] == 0

    other = client.get(
        USAGE_URL, headers=superuser_token_headers, params={"day": "2026-01-02"}
    ).json()
    assert _entry_for(other, email)["manualBulk"] == 7
    assert _entry_for(other, email)["autoSync"] == 0
