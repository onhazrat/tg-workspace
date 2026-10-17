"""Setting a Priority boost over HTTP (DPF).

`POST /data/directory/boost` sets or adds to the boost of the named entries.
The Operator (the superuser) holds `DATA_ADMIN`; the other Account holds
nothing. A View-as session is refused by the non-safe-method rule, which
`test_view_as.py` already proves for every mutating route the app mounts.

## Watched to fail

Each mutation was applied alone and this module went red:

* drop the `DATA_ADMIN` dependency -> the non-holder case
* let `BoostOutOfRange` escape as a 500 -> the range case
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models import User, UserUpdate
from app.models_tg import DirectoryEntry
from app.services.channel_directory import MAX_PRIORITY_BOOST, enqueue_handles
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

BOOST = f"{settings.API_V1_STR}/data/directory/boost"


@pytest.fixture
def accounts(client: TestClient) -> Iterator[tuple[dict[str, str], dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="dpf-pass")
        )
        other_id, email = user.id, user.email
        enqueue_handles(session, ["db_one", "db_two"])
    other = user_authentication_headers(client=client, email=email, password="dpf-pass")
    yield get_superuser_token_headers(client), other
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


def _boosts() -> dict[str, int]:
    with Session(engine) as session:
        return {
            e.handle: e.priority_boost
            for e in session.exec(select(DirectoryEntry)).all()
        }


def test_the_operator_sets_and_adds(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    response = client.post(
        BOOST,
        json={"handles": ["db_one", "@DB_TWO", "nobody"], "mode": "set", "value": 3},
        headers=operator,
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"changed": 2}
    client.post(
        BOOST,
        json={"handles": ["db_one"], "mode": "add", "value": -5},
        headers=operator,
    )
    assert _boosts() == {"db_one": -2, "db_two": 3}


def test_an_account_without_the_permission_is_refused(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    _, other = accounts
    response = client.post(
        BOOST, json={"handles": ["db_one"], "mode": "set", "value": 1}, headers=other
    )
    assert response.status_code == 403
    assert _boosts() == {"db_one": 0, "db_two": 0}


def test_a_boost_past_the_range_is_422_and_changes_nothing(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    too_big = client.post(
        BOOST,
        json={"handles": ["db_one"], "mode": "set", "value": MAX_PRIORITY_BOOST + 1},
        headers=operator,
    )
    assert too_big.status_code == 422
    client.post(
        BOOST,
        json={"handles": ["db_one"], "mode": "set", "value": MAX_PRIORITY_BOOST},
        headers=operator,
    )
    crossing = client.post(
        BOOST,
        json={"handles": ["db_two", "db_one"], "mode": "add", "value": 1},
        headers=operator,
    )
    assert crossing.status_code == 422
    assert _boosts() == {"db_one": MAX_PRIORITY_BOOST, "db_two": 0}


def test_no_handles_is_422(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    response = client.post(
        BOOST, json={"handles": [], "mode": "set", "value": 1}, headers=operator
    )
    assert response.status_code == 422
