"""Tag uses through their routes (TGU-02, ADR-042).

`POST /data/tags/uses` records one Tag use on a tab; `POST /data/tags/order`
answers, per Tag the Account has, its Tag use score on a tab (each use 1,
halving every 14 days), its last use, and its channels in a scope and how many
of those are selected. A rename carries a Tag's uses, a merge adds them, and
the uses end with the Tag.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app.core.config import settings
from app.core.db import engine
from app.models import User
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

TAGS = f"{settings.API_V1_STR}/data/tags"
DAY_MS = 86_400_000
T0 = 1_800_000_000_000

Headers = dict[str, str]


@pytest.fixture
def accounts(client: TestClient) -> Iterator[tuple[Headers, Headers]]:
    """The Operator, who follows `tg_followed`, and a second Account."""
    from app import crud
    from app.models import UserUpdate

    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="tgu02-pass")
        )
        other_id, email = user.id, user.email
        follow_channels(session, "tg_followed")
        session.commit()
    other = user_authentication_headers(
        client=client, email=email, password="tgu02-pass"
    )
    yield get_superuser_token_headers(client), other
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """A frozen clock, in ms; set `clock[0]` to move it."""
    from app.services import tags

    now = [T0]
    monkeypatch.setattr(tags, "now_ms", lambda: now[0])
    return now


def _add(client: TestClient, headers: Headers, name: str, *handles: str) -> None:
    response = client.post(
        f"{TAGS}/channels",
        json={"name": name, "handles": list(handles)},
        headers=headers,
    )
    assert response.status_code == 200, response.text


def _use(client: TestClient, headers: Headers, tab: str, name: str) -> Any:
    return client.post(f"{TAGS}/uses", json={"tab": tab, "name": name}, headers=headers)


def _order(
    client: TestClient,
    headers: Headers,
    tab: str,
    *,
    scope: list[str] | None = None,
    selected: list[str] | None = None,
) -> dict[str, dict[str, Any]]:
    body: dict[str, Any] = {"tab": tab, "scope": scope, "selected": selected or []}
    response = client.post(f"{TAGS}/order", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return {row["name"]: row for row in response.json()}


def _scores(client: TestClient, headers: Headers, tab: str) -> dict[str, float]:
    return {
        name: round(row["score"], 3)
        for name, row in _order(client, headers, tab).items()
    }


def test_a_use_counts_on_its_own_tab(
    client: TestClient, accounts: tuple[Headers, Headers], clock: list[int]
) -> None:
    operator, _ = accounts
    _add(client, operator, "News", "a_one")
    _add(client, operator, "World", "a_one")

    assert _use(client, operator, "channels", "news").status_code == 200
    clock[0] += 1
    _use(client, operator, "channels", "NEWS")
    _use(client, operator, "directory", "World")

    assert _scores(client, operator, "channels") == {"News": 2, "World": 0}
    channels = _order(client, operator, "channels")
    assert channels["News"]["lastUsedAt"] == T0 + 1
    assert channels["World"]["lastUsedAt"] is None
    assert _scores(client, operator, "directory") == {"News": 0, "World": 1}
    assert _scores(client, operator, "requests") == {"News": 0, "World": 0}
    assert _use(client, operator, "posts", "News").status_code == 422
