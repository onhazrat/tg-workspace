"""The Directory's columns over HTTP, with two live Accounts (DCOL).

`POST /data/directory/list` carries only the columns its `columns` names, and
`GET`/`PUT /data/directory/columns` are the catalogue and the deployment's
defaults. The Operator (the superuser) holds `DATA_ADMIN`; the other Account
holds nothing, so it never sees the Internals.

| entry       | subscribers | photos | cited by | cites |
|-------------|-------------|--------|----------|-------|
| dc_big      | 9000        | 40     | 2        | 1     |
| dc_small    | 100         |        | 1        | 0     |
| dc_quiet    |             |        | 0        | 0     |

`dc_big` cites `dc_small`; `dc_src1` and `dc_src2` cite `dc_big`. The Operator
follows `dc_src1`.

## Watched to fail

Each mutation was applied alone and this module went red:

* serialise without `exclude_unset`, sending an unrequested column as `null`
  -> the omitted-column case
* let a non-holder ask for an Internal -> the gated case
* fall back to all-off when no defaults are stored -> the opening defaults case
* count Cited by and Cites for a page that shows neither -> the
  cost case
* keep the holder's `PUT` open to everybody -> the defaults case
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, col, delete

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.services import directory_reads
from app.services.channel_directory import record_probe_result
from app.services.post_references import (
    Reference,
    SourcedReferences,
    write_references,
)
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

DIRECTORY = f"{settings.API_V1_STR}/data/directory"

#: The ten columns the table showed before DCOL, on by default until an
#: Operator says otherwise.
OPENING_DEFAULTS = {
    "language",
    "subscribers",
    "reach",
    "posts_per_week",
    "forward_pct",
    "last_post_at",
    "mine",
    "cited_by",
    "cites",
    "created_at",
}
INTERNALS = {
    "kind",
    "priority_boost",
    "effective_priority",
    "attempts",
    "last_error",
    "attempted_at",
    "retry_after",
    "priority",
    "telegram_chat_id",
    "latest_id",
}
#: What every row carries whatever is shown.
CORE = {
    "handle",
    "displayName",
    "photoUrl",
    "followable",
    "followed",
    "dismissed",
    "tags",
    "match",
    "sharedParents",
    "sharedChildren",
}


def _seed() -> None:
    now = int(time.time() * 1000)
    with Session(engine) as session:
        for handle, subscribers, photos in (
            ("dc_big", 9000, 40),
            ("dc_small", 100, None),
            ("dc_quiet", None, None),
        ):
            page: dict[str, Any] = {"isTelegramPage": True, "kind": "channel"}
            if subscribers is not None:
                page |= {
                    "displayName": handle,
                    "bio": f"About {handle}",
                    "subscribers": subscribers,
                    "photos": photos,
                }
            record_probe_result(session, handle, page)
        write_references(
            session,
            [
                SourcedReferences(
                    source_chat_id=1000 + n,
                    source_channel=source,
                    source_post_id=n,
                    timestamp=now - n * 60_000,
                    references=[Reference(target_handle=target, kind="mention")],
                )
                for n, (source, target) in enumerate(
                    [
                        ("dc_src1", "dc_big"),
                        ("dc_src2", "dc_big"),
                        ("dc_big", "dc_small"),
                    ]
                )
            ],
            target_chat_ids={},
        )
        session.commit()
        follow_channels(session, "dc_src1")
        session.commit()


@pytest.fixture
def accounts(client: TestClient) -> Iterator[tuple[dict[str, str], dict[str, str]]]:
    """Seed the corpus; answer the Operator's and the other Account's headers."""
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        user = create_random_user(session)
        from app import crud
        from app.models import UserUpdate

        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="dcol-pass")
        )
        other_id, email = user.id, user.email
    _seed()
    other = user_authentication_headers(
        client=client, email=email, password="dcol-pass"
    )
    yield get_superuser_token_headers(client), other
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


def _rows(
    client: TestClient, headers: dict[str, str], columns: list[str], **body: Any
) -> dict[str, dict[str, Any]]:
    response = client.post(
        f"{DIRECTORY}/list", json={"columns": columns, **body}, headers=headers
    )
    assert response.status_code == 200, response.text
    return {row["handle"]: row for row in response.json()["rows"]}


# ---- The list carries what was asked for ------------------------------------


def test_a_row_carries_the_core_and_the_requested_columns_only(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    rows = _rows(client, operator, ["subscribers", "reach", "photos"])
    assert set(rows["dc_big"]) == CORE | {
        "subscribers",
        "reach",
        "reachEstimated",
        "photos",
    }
    assert rows["dc_big"]["subscribers"] == 9000
    # Requested and not measured is `null`; not requested is absent.
    assert rows["dc_quiet"]["subscribers"] is None
    assert "language" not in rows["dc_quiet"]


def test_every_column_maps_to_its_fields(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    catalogue = client.get(f"{DIRECTORY}/columns", headers=operator).json()
    rows = _rows(client, operator, [c["key"] for c in catalogue])
    assert set(rows["dc_big"]) == CORE | {
        "language",
        "subscribers",
        "reach",
        "reachEstimated",
        "postsPerWeek",
        "forwardShare",
        "lastPostAt",
        "mine",
        "mineLastAt",
        "citedBy",
        "cites",
        "foundAt",
        "photos",
        "videos",
        "files",
        "links",
        "status",
        "bio",
        "sampleCount",
        "checkedAt",
        "refreshDueAt",
        "attempts",
        "lastError",
        "attemptedAt",
        "retryAfter",
        "priority",
        "priorityBoost",
        "effectivePriority",
        "kind",
        "telegramChatId",
        "latestId",
    }
    big = rows["dc_big"]
    assert (big["bio"], big["status"], big["citedBy"], big["cites"], big["mine"]) == (
        "About dc_big",
        "ok",
        2,
        1,
        1,
    )
    assert isinstance(big["checkedAt"], int)


def test_an_unknown_column_is_refused(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    for body in ({"columns": ["found_days"]}, {}):
        response = client.post(f"{DIRECTORY}/list", json=body, headers=operator)
        assert response.status_code == 422, body


def test_an_internal_is_dropped_for_an_account_without_the_permission(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    asked = ["attempts", "last_error", "priority", "subscribers"]
    assert {"attempts", "lastError", "priority"} <= set(
        _rows(client, operator, asked)["dc_big"]
    )
    row = _rows(client, other, asked)["dc_big"]
    assert set(row) == CORE | {"subscribers"}


def test_a_hidden_aggregate_still_sorts_and_filters(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    rows = _rows(client, operator, [], sort="cited_by", descending=True)
    assert list(rows) == ["dc_big", "dc_small", "dc_quiet"]
    assert "citedBy" not in rows["dc_big"]
    mine = _rows(client, operator, [], sort="mine", descending=True)
    assert list(mine)[0] == "dc_big"
    assert "mine" not in mine["dc_big"]


@pytest.fixture
def captured_sql() -> Iterator[list[str]]:
    statements: list[str] = []

    def before_cursor_execute(*args: Any) -> None:
        statements.append(str(args[2]))

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


def test_a_hidden_aggregate_is_not_computed(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    captured_sql: list[str],
) -> None:
    operator, _ = accounts
    # Sorted by subscribers, so nothing the page orders by reads a count.
    _rows(client, operator, ["subscribers"], sort="subscribers")
    counted = [s for s in captured_sql if "tg_citation_counts" in s]
    referenced = [s for s in captured_sql if "tg_post_references" in s]
    assert (counted, referenced) == ([], [])
    captured_sql.clear()
    _rows(client, operator, ["cited_by", "mine"], sort="subscribers")
    assert any("tg_citation_counts" in s for s in captured_sql)
    assert any("tg_post_references" in s for s in captured_sql)


# ---- The catalogue and the defaults ------------------------------------------


def _catalogue(client: TestClient, headers: dict[str, str]) -> dict[str, bool]:
    response = client.get(f"{DIRECTORY}/columns", headers=headers)
    assert response.status_code == 200, response.text
    return {c["key"]: c["default"] for c in response.json()}


def test_the_opening_defaults_are_the_ten_columns_shown_before(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    mine = _catalogue(client, operator)
    assert {k for k, on in mine.items() if on} == OPENING_DEFAULTS
    assert INTERNALS <= set(mine)
    theirs = _catalogue(client, other)
    assert set(theirs) == set(mine) - INTERNALS
    # Table order: today's ten first, the Internals last.
    assert list(mine)[:3] == ["language", "subscribers", "reach"]
    assert list(mine)[-1] == "latest_id"


def test_a_holder_sets_the_defaults_for_everybody(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    body = {"on": ["photos", "subscribers", "attempts"]}
    refused = client.put(f"{DIRECTORY}/columns", json=body, headers=other)
    assert refused.status_code == 403
    response = client.put(f"{DIRECTORY}/columns", json=body, headers=operator)
    assert response.status_code == 200, response.text
    assert {k for k, on in _catalogue(client, operator).items() if on} == {
        "photos",
        "subscribers",
        "attempts",
    }
    # A column the defaults do not name is off; an Internal stays out of sight.
    assert {k for k, on in _catalogue(client, other).items() if on} == {
        "photos",
        "subscribers",
    }


def test_an_unknown_default_is_refused(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    response = client.put(
        f"{DIRECTORY}/columns", json={"on": ["found_days"]}, headers=operator
    )
    assert response.status_code == 422


def test_the_catalogue_needs_no_corpus(client: TestClient) -> None:
    # The fixture-free read: a fresh deployment answers the opening defaults.
    headers = get_superuser_token_headers(client)
    assert {k for k, on in _catalogue(client, headers).items() if on} == (
        OPENING_DEFAULTS
    )
