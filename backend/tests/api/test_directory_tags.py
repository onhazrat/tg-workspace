"""The Account's Tags through their own routes (DFP-04, ADR-029).

`/data/tags` lists the caller's Tags with their counts, tags and untags any
handle (followed or not), renames a Tag Account-wide and deletes it. Every
statement is keyed by the caller, so another Account's rows are out of reach in
both flag states. The Directory reads that filter by a Tag are tested beside
the rest of the Directory filter, in `test_directory_browse.py`.

## Watched to fail

* key a write on the name alone, not the caller -> the foreign-account case
* rename without merging -> the merge case's count, or a unique violation
* store a `group:` name -> the reserved case
* answer a delete of an unknown Tag with 200 -> the unknown case
* put `/data/tags/channels` on `VIEW_AS_READ_ONLY_PATHS` -> the View-as case
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

Headers = dict[str, str]


@pytest.fixture
def accounts(client: TestClient) -> Iterator[tuple[Headers, Headers]]:
    """The Operator, who follows `tg_followed`, and a second Account."""
    from app import crud
    from app.models import UserUpdate

    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="dfp04-pass")
        )
        other_id, email = user.id, user.email
        follow_channels(session, "tg_followed")
        session.commit()
    other = user_authentication_headers(
        client=client, email=email, password="dfp04-pass"
    )
    yield get_superuser_token_headers(client), other
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


def _add(client: TestClient, headers: Headers, name: str, *handles: str) -> Any:
    return client.post(
        f"{TAGS}/channels",
        json={"name": name, "handles": list(handles)},
        headers=headers,
    )


def _remove(client: TestClient, headers: Headers, name: str, *handles: str) -> Any:
    return client.request(
        "DELETE",
        f"{TAGS}/channels",
        json={"name": name, "handles": list(handles)},
        headers=headers,
    )


def _tags(client: TestClient, headers: Headers) -> list[tuple[str, int]]:
    response = client.get(TAGS, headers=headers)
    assert response.status_code == 200, response.text
    return [(t["name"], t["channels"]) for t in response.json()]


def _handles(client: TestClient, headers: Headers, name: str) -> list[str]:
    response = client.get(f"{TAGS}/channels", params={"name": name}, headers=headers)
    assert response.status_code == 200, response.text
    return list(response.json()["handles"])


def test_tag_and_untag_followed_and_unfollowed_channels(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, _ = accounts
    added = _add(client, operator, "News", "tg_followed", "@Tg_Elsewhere")
    assert added.json() == {"changed": 2}
    # Already there: kept, and not counted again. Case is one Tag.
    assert _add(client, operator, "news", "tg_elsewhere").json() == {"changed": 0}
    assert _tags(client, operator) == [("News", 2)]
    assert _handles(client, operator, "NEWS") == ["tg_elsewhere", "tg_followed"]

    # The Channels tab still shows a followed Channel's Tag where it did.
    channels = client.get(f"{settings.API_V1_STR}/data/channels", headers=operator)
    followed = next(c for c in channels.json() if c["id"] == "tg_followed")
    assert [t["name"] for t in followed["tags"]] == ["News"]

    assert _remove(client, operator, "news", "tg_followed", "tg_never").json() == {
        "changed": 1
    }
    assert _tags(client, operator) == [("News", 1)]


def test_rename_respells_and_merges_onto_an_existing_tag(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, _ = accounts
    _add(client, operator, "news", "a_one", "a_both")
    _add(client, operator, "World", "a_both", "a_two")

    respelled = client.patch(
        TAGS, json={"name": "NEWS", "to": "News"}, headers=operator
    )
    assert respelled.json() == {"name": "News", "channels": 2}
    merged = client.patch(TAGS, json={"name": "news", "to": "world"}, headers=operator)
    assert merged.status_code == 200, merged.text
    assert merged.json() == {"name": "world", "channels": 3}
    assert [name.lower() for name, _ in _tags(client, operator)] == ["world"]
    assert _handles(client, operator, "world") == ["a_both", "a_one", "a_two"]


def test_delete_takes_a_tag_off_every_channel(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, _ = accounts
    _add(client, operator, "gone", "a_one", "a_two")
    deleted = client.request("DELETE", TAGS, json={"name": "GONE"}, headers=operator)
    assert deleted.json() == {"changed": 2}
    assert _tags(client, operator) == []


def test_an_unknown_tag_is_404_and_a_group_tag_is_reserved(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, _ = accounts
    unknown = {"name": "nope", "to": "other"}
    assert client.patch(TAGS, json=unknown, headers=operator).status_code == 404
    deleted = client.request("DELETE", TAGS, json={"name": "nope"}, headers=operator)
    assert deleted.status_code == 404
    assert _handles(client, operator, "nope") == []

    assert _add(client, operator, "group:Fast", "a_one").status_code == 400
    _add(client, operator, "kept", "a_one")
    renamed = client.patch(
        TAGS, json={"name": "kept", "to": "group:x"}, headers=operator
    )
    assert renamed.status_code == 400
    assert _tags(client, operator) == [("kept", 1)]


@pytest.mark.parametrize("enforced", [True, False])
def test_another_accounts_tags_are_untouched(
    client: TestClient,
    accounts: tuple[Headers, Headers],
    monkeypatch: pytest.MonkeyPatch,
    enforced: bool,
) -> None:
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", enforced)
    operator, other = accounts
    _add(client, other, "shared name", "a_one", "a_two")
    _add(client, operator, "shared name", "a_one")

    assert _tags(client, operator) == [("shared name", 1)]
    assert _handles(client, operator, "shared name") == ["a_one"]
    _remove(client, operator, "shared name", "a_two")
    client.patch(TAGS, json={"name": "shared name", "to": "mine"}, headers=operator)
    client.request("DELETE", TAGS, json={"name": "mine"}, headers=operator)
    assert (
        client.request(
            "DELETE", TAGS, json={"name": "shared name"}, headers=operator
        ).status_code
        == 404
    )

    assert _tags(client, other) == [("shared name", 2)]
    assert _handles(client, other, "shared name") == ["a_one", "a_two"]


def test_view_as_reads_the_targets_tags_and_cannot_change_them(
    client: TestClient, accounts: tuple[Headers, Headers]
) -> None:
    operator, other = accounts
    _add(client, other, "theirs", "a_one")
    me = client.get(f"{settings.API_V1_STR}/users/me", headers=other).json()
    session = client.post(f"{settings.API_V1_STR}/view-as/{me['id']}", headers=operator)
    assert session.status_code == 200, session.text
    viewing = {"Authorization": f"Bearer {session.json()['accessToken']}"}
    try:
        assert _tags(client, viewing) == [("theirs", 1)]
        assert _add(client, viewing, "theirs", "a_two").status_code == 403
        assert _remove(client, viewing, "theirs", "a_one").status_code == 403
        renamed = client.patch(
            TAGS, json={"name": "theirs", "to": "x"}, headers=viewing
        )
        assert renamed.status_code == 403
        assert _tags(client, other) == [("theirs", 1)]
    finally:
        from app.models_view_as import ViewAsSession

        with Session(engine) as db:
            db.exec(delete(ViewAsSession))
            db.commit()
