"""Tick all that match, over HTTP with two live Accounts (DTA, ADR-031).

`POST /data/directory/handles` answers every handle a view matches, refused
above `MAX_TICK_ALL`. Dismiss, Tag, Untag and Boost take a `view` in place of
`handles` (All matching) and resolve it on the server, at action time, through
the list's own query.

The Operator follows `ta_fa_followed`; the other Account follows nothing and
has dismissed `ta_fa_two`.

| entry          | Language |
|----------------|----------|
| ta_fa_one      | fa       |
| ta_fa_two      | fa       |
| ta_fa_followed | fa       |
| ta_en          | en       |

## Watched to fail

Each mutation was applied alone and this module went red:

* truncate a view over `MAX_TICK_ALL` instead of refusing it -> the refusal case
* resolve the view without the reader's Dismissals -> the per-Account case
* let Dismiss with a view reach followed entries -> the Dismiss case
* resolve a view to one handle -> the Tag, Untag, Dismiss and Boost cases
* accept handles and a view together -> the both-or-neither cases
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models import User, UserUpdate
from app.models_tg import DirectoryEntry
from app.services import directory_reads
from app.services.channel_directory import MAX_PRIORITY_BOOST, record_probe_result
from app.services.dismissals import dismiss_channels
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

API = settings.API_V1_STR
HANDLES = f"{API}/data/directory/handles"

FA = "این یک متن فارسی است درباره اخبار امروز و سیاست"
EN = "This is an English sentence about the news of today and politics"
ENTRIES = {
    "ta_fa_one": FA,
    "ta_fa_two": FA,
    "ta_fa_followed": FA,
    "ta_en": EN,
}
PERSIAN = {"ta_fa_one", "ta_fa_two", "ta_fa_followed"}


def _probe(session: Session, handle: str, words: str) -> None:
    now = int(time.time() * 1000)
    record_probe_result(
        session,
        handle,
        {
            "isTelegramPage": True,
            "kind": "channel",
            "displayName": handle,
            "samples": [
                {
                    "id": i + 1,
                    "text": words,
                    "date": "2026-10-01T00:00:00+00:00",
                    "timestamp": now - i * 3_600_000,
                    "channelName": handle,
                    "media": {"kinds": [], "viewsCount": 10, "caption": words},
                }
                for i in range(5)
            ],
        },
    )


@pytest.fixture
def accounts(client: TestClient) -> Iterator[tuple[dict[str, str], dict[str, str]]]:
    """Seed the corpus; answer the Operator's and the other Account's headers."""
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="dta-pass")
        )
        other_id: uuid.UUID = user.id
        email = user.email
        for handle, words in ENTRIES.items():
            _probe(session, handle, words)
        session.commit()
        follow_channels(session, "ta_fa_followed")
        session.commit()
        dismiss_channels(session, ["ta_fa_two"], user_id=other_id)
    other = user_authentication_headers(client=client, email=email, password="dta-pass")
    yield get_superuser_token_headers(client), other
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


def persian() -> dict[str, Any]:
    """The view: every Persian entry, nothing else narrowed."""
    return {
        "filter": {
            "kind": "group",
            "id": "root",
            "op": "and",
            "children": [
                {
                    "kind": "atom",
                    "id": "x",
                    "cond": {"type": "language", "value": "fa"},
                }
            ],
        },
        "yours": {"source": "follows", "handles": []},
    }


def without_dismissed(view: dict[str, Any]) -> dict[str, Any]:
    """`view` with Hide dismissed on, as the tab sends it by default."""
    hidden = {
        "kind": "atom",
        "id": "d",
        "not": True,
        "cond": {"type": "flag", "value": "dismissed"},
    }
    return {
        **view,
        "filter": {**view["filter"], "children": [*view["filter"]["children"], hidden]},
    }


# ---- The handles a view matches ---------------------------------------------


def test_the_handles_are_every_entry_the_view_matches(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    r = client.post(HANDLES, headers=operator, json=persian())
    assert r.status_code == 200, r.text
    assert set(r.json()["handles"]) == PERSIAN


def test_a_view_too_large_to_tick_is_refused_not_truncated(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operator, _ = accounts
    monkeypatch.setattr(directory_reads, "MAX_TICK_ALL", 3)
    assert client.post(HANDLES, headers=operator, json=persian()).status_code == 200
    monkeypatch.setattr(directory_reads, "MAX_TICK_ALL", 2)
    r = client.post(HANDLES, headers=operator, json=persian())
    assert r.status_code == 422
    assert "All matching" in r.json()["detail"]


def test_each_account_ticks_its_own_view(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    view = without_dismissed(persian())
    mine = client.post(HANDLES, headers=operator, json=view).json()["handles"]
    theirs = client.post(HANDLES, headers=other, json=view).json()["handles"]
    assert set(mine) == PERSIAN
    assert set(theirs) == PERSIAN - {"ta_fa_two"}


# ---- All matching: the writes take the view ---------------------------------

TAGS = f"{API}/data/tags/channels"


def _tagged(client: TestClient, headers: dict[str, str], name: str) -> set[str]:
    r = client.get(TAGS, headers=headers, params={"name": name})
    return set(r.json()["handles"])


def test_a_tag_reaches_every_entry_the_view_matches(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    r = client.post(TAGS, headers=other, json={"name": "fa", "view": persian()})
    assert r.status_code == 200, r.text
    assert r.json()["changed"] == 3
    assert _tagged(client, other, "fa") == PERSIAN
    assert _tagged(client, operator, "fa") == set()


def test_untag_reaches_every_entry_the_view_matches(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    _, other = accounts
    handles = ["ta_fa_one", "ta_en"]
    client.post(TAGS, headers=other, json={"name": "x", "handles": handles})
    r = client.request(
        "DELETE", TAGS, headers=other, json={"name": "x", "view": persian()}
    )
    assert r.status_code == 200, r.text
    assert r.json()["changed"] == 1
    assert _tagged(client, other, "x") == {"ta_en"}


@pytest.mark.parametrize(
    "route",
    [
        ("POST", TAGS, {"name": "x"}),
        ("DELETE", TAGS, {"name": "x"}),
        ("POST", f"{API}/data/discover/ignored", {}),
        ("POST", f"{API}/data/directory/boost", {"mode": "set", "value": 1}),
    ],
)
def test_a_write_names_handles_or_a_view_never_both_nor_neither(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    route: tuple[str, str, dict[str, Any]],
) -> None:
    operator, _ = accounts
    method, url, rest = route
    both = {**rest, "handles": ["ta_en"], "view": persian()}
    for body in (both, rest):
        r = client.request(method, url, headers=operator, json=body)
        assert r.status_code == 422, (body, r.text)


IGNORED = f"{API}/data/discover/ignored"


def test_dismiss_reaches_every_unfollowed_entry_the_view_matches(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    r = client.post(IGNORED, headers=operator, json={"view": persian()})
    assert r.status_code == 200, r.text
    assert set(r.json()["ignored"]) == {"ta_fa_one", "ta_fa_two"}
    listed = client.get(IGNORED, headers=operator).json()
    assert {row["handle"] for row in listed} == {"ta_fa_one", "ta_fa_two"}
    # The other Account's own Dismissal is untouched, and nothing was added to it.
    theirs = client.get(IGNORED, headers=other).json()
    assert {row["handle"] for row in theirs} == {"ta_fa_two"}


BOOST = f"{API}/data/directory/boost"


def _boosts() -> dict[str, int]:
    with Session(engine) as session:
        rows = session.exec(
            select(DirectoryEntry).where(col(DirectoryEntry.handle).in_(ENTRIES))
        ).all()
        return {row.handle: row.priority_boost for row in rows}


def test_boost_reaches_every_entry_the_view_matches_followed_or_not(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    body = {"view": persian(), "mode": "set", "value": 5}
    assert client.post(BOOST, headers=other, json=body).status_code == 403
    r = client.post(BOOST, headers=operator, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["changed"] == 3
    assert _boosts() == {h: 5 if h in PERSIAN else 0 for h in ENTRIES}


def test_a_boost_past_the_range_changes_no_entry_the_view_matches(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    client.post(
        BOOST,
        headers=operator,
        json={"handles": ["ta_fa_one"], "mode": "set", "value": MAX_PRIORITY_BOOST},
    )
    r = client.post(
        BOOST, headers=operator, json={"view": persian(), "mode": "add", "value": 1}
    )
    assert r.status_code == 422, r.text
    assert _boosts()["ta_fa_two"] == 0
