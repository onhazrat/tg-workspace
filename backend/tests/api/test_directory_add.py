"""Adding pasted handles to the Directory over HTTP (DADD).

`POST /data/directory/add` queues handles an Operator names for a fetch, in
their own band, without following any of them. The Operator (the superuser)
holds `DATA_ADMIN`; the other Account holds nothing.

## Watched to fail

Each mutation was applied alone and this module went red:

* `enqueue_handles` back on an `IN` list -> the bind-limit case
* `NAMED_PRIORITY` moved ahead of `HARVEST_PRIORITY` -> the drain-order cases
* drop the `DATA_ADMIN` dependency -> the non-holder case
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
from app.models_tg import DirectoryEntry, utc_now
from app.services.channel_directory import (
    HARVEST_PRIORITY,
    REFRESH_PRIORITY,
    dequeue_handles,
    enqueue_handles,
)
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

ADD = f"{settings.API_V1_STR}/data/directory/add"


@pytest.fixture
def accounts(client: TestClient) -> Iterator[tuple[dict[str, str], dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="dadd-pass")
        )
        other_id, email = user.id, user.email
    other = user_authentication_headers(
        client=client, email=email, password="dadd-pass"
    )
    yield get_superuser_token_headers(client), other
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


def _entries() -> dict[str, tuple[str, int]]:
    with Session(engine) as session:
        return {
            e.handle: (e.status, e.priority)
            for e in session.exec(select(DirectoryEntry)).all()
        }


def test_the_operator_adds_new_handles_as_pending(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    response = client.post(
        ADD,
        json={"handles": ["@Alpha_one", "beta_two", "1digit", "abcd"]},
        headers=operator,
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"added": 2, "alreadyInDirectory": 0, "invalid": 2}
    assert _entries() == {
        "alpha_one": ("unknown", 1_750_000),
        "beta_two": ("unknown", 1_750_000),
    }


def test_a_held_handle_is_left_as_it_is(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    with Session(engine) as session:
        session.add(DirectoryEntry(handle="known_ok", status="ok", priority=2_000_000))
        session.add(DirectoryEntry(handle="ranked_pend", status="unknown", priority=3))
        session.add(
            DirectoryEntry(handle="late_pending", status="unknown", priority=9_000_000)
        )
        session.commit()
    response = client.post(
        ADD,
        json={"handles": ["known_ok", "Ranked_Pend", "late_pending", "fresh_one"]},
        headers=operator,
    )
    assert response.json() == {"added": 1, "alreadyInDirectory": 3, "invalid": 0}
    assert _entries() == {
        "known_ok": ("ok", 2_000_000),
        "ranked_pend": ("unknown", 3),
        "late_pending": ("unknown", 1_750_000),
        "fresh_one": ("unknown", 1_750_000),
    }


def test_a_paste_past_the_bind_parameter_limit_is_queued(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Postgres stops at 65,535 bind parameters per statement, and an `IN` list
    spends one per handle."""
    operator, _ = accounts
    handles = [f"bulk_{i:06d}" for i in range(70_000)]
    response = client.post(ADD, json={"handles": handles}, headers=operator)
    assert response.status_code == 200, response.text[:300]
    assert response.json() == {"added": 70_000, "alreadyInDirectory": 0, "invalid": 0}
    response = client.post(ADD, json={"handles": handles}, headers=operator)
    assert response.json() == {"added": 0, "alreadyInDirectory": 70_000, "invalid": 0}


def test_a_paste_over_the_cap_is_refused(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    handles = [f"over_{i:06d}" for i in range(100_001)]
    response = client.post(ADD, json={"handles": handles}, headers=operator)
    assert response.status_code == 422
    assert _entries() == {}


def test_a_paste_drains_after_a_harvest_and_before_a_refresh(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    with Session(engine) as session:
        enqueue_handles(session, ["zz_harvested"], priority=HARVEST_PRIORITY)
        session.add(
            DirectoryEntry(
                handle="aa_stale",
                status="ok",
                priority=REFRESH_PRIORITY,
                refresh_due_at=utc_now(),
            )
        )
        session.commit()
    client.post(ADD, json={"handles": ["mm_named", "bb_named"]}, headers=operator)
    with Session(engine) as session:
        assert dequeue_handles(session, limit=10) == [
            "zz_harvested",
            "bb_named",
            "mm_named",
            "aa_stale",
        ]


def test_a_reserved_path_is_not_a_handle(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    response = client.post(
        ADD, json={"handles": ["joinchat", "addstickers", "real_one"]}, headers=operator
    )
    assert response.json() == {"added": 1, "alreadyInDirectory": 0, "invalid": 2}
    assert set(_entries()) == {"real_one"}


def test_an_account_without_the_permission_is_refused(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    _, other = accounts
    response = client.post(ADD, json={"handles": ["real_one"]}, headers=other)
    assert response.status_code == 403
    assert _entries() == {}
