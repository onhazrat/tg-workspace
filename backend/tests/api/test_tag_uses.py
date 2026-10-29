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
    monkeypatch.setattr(tags, "server_now_ms", lambda: now[0])
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


def test_each_use_halves_every_14_days(
    client: TestClient, accounts: tuple[Headers, Headers], clock: list[int]
) -> None:
    operator, _ = accounts
    _add(client, operator, "old", "a_one")
    _use(client, operator, "channels", "old")
    clock[0] += 14 * DAY_MS
    assert _scores(client, operator, "channels") == {"old": 0.5}
    _use(client, operator, "channels", "old")
    clock[0] += 14 * DAY_MS
    assert _scores(client, operator, "channels") == {"old": 0.75}


def test_only_the_50_newest_uses_are_kept(
    client: TestClient, accounts: tuple[Headers, Headers], clock: list[int]
) -> None:
    operator, _ = accounts
    _add(client, operator, "busy", "a_one")
    _add(client, operator, "other", "a_one")
    for _ in range(55):
        _use(client, operator, "channels", "busy")
        clock[0] += 1
    _use(client, operator, "channels", "other")
    _use(client, operator, "directory", "busy")
    assert _scores(client, operator, "channels") == {"busy": 50, "other": 1}
    assert _scores(client, operator, "directory") == {"busy": 1, "other": 0}


def test_a_rename_carries_uses_on_every_tab_and_a_merge_adds_them(
    client: TestClient, accounts: tuple[Headers, Headers], clock: list[int]
) -> None:
    operator, _ = accounts
    _add(client, operator, "typo", "a_one")
    _add(client, operator, "World", "a_two")
    _use(client, operator, "channels", "typo")
    _use(client, operator, "directory", "typo")
    clock[0] += 1
    _use(client, operator, "channels", "World")

    client.patch(TAGS, json={"name": "typo", "to": "Fixed"}, headers=operator)
    assert _scores(client, operator, "channels") == {"Fixed": 1, "World": 1}
    assert _scores(client, operator, "directory") == {"Fixed": 1, "World": 0}

    client.patch(TAGS, json={"name": "fixed", "to": "world"}, headers=operator)
    assert _scores(client, operator, "channels") == {"World": 2}
    assert _scores(client, operator, "directory") == {"World": 1}


def test_uses_end_with_the_tag(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, _ = accounts
    for name in ("deleted", "untagged", "replaced"):
        _add(client, operator, name, "tg_followed", "a_two")
        _use(client, operator, "channels", name)
    client.request("DELETE", TAGS, json={"name": "deleted"}, headers=operator)
    # Untagged from one Channel, then the last.
    for handle in ("a_two", "tg_followed"):
        client.request(
            "DELETE",
            f"{TAGS}/channels",
            json={"name": "untagged", "handles": [handle]},
            headers=operator,
        )
        if handle == "a_two":
            assert _scores(client, operator, "channels")["untagged"] == 1
    # The Channels tab's bulk Tag edit, a Tag run's path too, replaces a list.
    client.request(
        "DELETE",
        f"{TAGS}/channels",
        json={"name": "replaced", "handles": ["a_two"]},
        headers=operator,
    )
    bulk = client.patch(
        f"{settings.API_V1_STR}/data/channels/bulk-tags",
        json={"updates": [{"channelId": "tg_followed", "tags": [{"name": "fresh"}]}]},
        headers=operator,
    )
    assert bulk.status_code == 200, bulk.text

    for name in ("deleted", "untagged", "replaced"):
        _add(client, operator, name, "a_one")
    # A Tag run tags through the same route and records no use.
    assert _scores(client, operator, "channels") == {
        "deleted": 0,
        "fresh": 0,
        "replaced": 0,
        "untagged": 0,
    }


def test_the_order_counts_a_scope_and_a_selection_and_no_setting_group(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, _ = accounts
    _add(client, operator, "News", "a_one", "a_two", "@A_Three")
    _add(client, operator, "late", "a_three")

    def counts(**kw: Any) -> dict[str, tuple[int, int]]:
        rows = _order(client, operator, "directory", **kw)
        return {name: (row["channels"], row["selected"]) for name, row in rows.items()}

    # `tg_followed` sits in a Setting group, whose `group:` Tag is not a Tag here.
    assert counts() == {"late": (1, 0), "News": (3, 0)}
    assert counts(selected=["A_ONE", "a_three", "never"]) == {
        "late": (1, 1),
        "News": (3, 2),
    }
    assert counts(scope=["a_one", "a_two"], selected=["a_one", "a_three"]) == {
        "late": (0, 0),
        "News": (2, 1),
    }


@pytest.mark.parametrize("enforced", [True, False])
def test_one_account_never_sees_or_moves_another_accounts_uses(
    client: TestClient,
    accounts: tuple[Headers, Headers],
    monkeypatch: pytest.MonkeyPatch,
    enforced: bool,
) -> None:
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", enforced)
    operator, other = accounts
    _add(client, other, "shared", "a_one", "a_two")
    _add(client, other, "theirs", "a_one")
    _use(client, other, "channels", "shared")
    _add(client, operator, "shared", "a_one")

    # A Tag the caller lacks records nothing, though another Account has it.
    assert _use(client, operator, "channels", "theirs").json() == {"changed": 0}
    assert _order(client, operator, "channels", selected=["a_two"]) == {
        "shared": {
            "name": "shared",
            "channels": 1,
            "selected": 0,
            "score": 0,
            "lastUsedAt": None,
        }
    }
    _use(client, operator, "channels", "shared")
    client.patch(TAGS, json={"name": "shared", "to": "mine"}, headers=operator)
    client.request("DELETE", TAGS, json={"name": "mine"}, headers=operator)
    assert _scores(client, other, "channels") == {"shared": 1, "theirs": 0}


def test_view_as_reads_the_targets_order_and_records_nothing(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, other = accounts
    _add(client, other, "theirs", "a_one")
    _use(client, other, "requests", "theirs")
    me = client.get(f"{settings.API_V1_STR}/users/me", headers=other).json()
    session = client.post(f"{settings.API_V1_STR}/view-as/{me['id']}", headers=operator)
    assert session.status_code == 200, session.text
    viewing = {"Authorization": f"Bearer {session.json()['accessToken']}"}
    try:
        assert _scores(client, viewing, "requests") == {"theirs": 1}
        assert _use(client, viewing, "requests", "theirs").status_code == 403
        assert _scores(client, other, "requests") == {"theirs": 1}
    finally:
        from app.models_view_as import ViewAsSession

        with Session(engine) as db:
            db.exec(delete(ViewAsSession))
            db.commit()
