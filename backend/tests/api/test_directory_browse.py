"""The Directory, browsed over HTTP with two live Accounts (DIR-02).

`POST /data/directory/list`, `/count`, `/distribution` and `GET /size` read the
Directory through a Directory filter: a tree of Conditions (AND, OR, NOT,
parentheses) the browser sends and only the server evaluates. The Operator
follows `src_a1`, `src_a2` and `dt_followed_a`; the second Account follows
`src_b1`. The corpus is written through the real write paths: each entry is a
recorded probe result, each Reference a `write_references` call.

| entry          | status      | kind    | Language | subscribers | Reach      | posts/week | forwarded | last post | photos |
|----------------|-------------|---------|----------|-------------|------------|------------|-----------|-----------|--------|
| dt_fa_big      | ok          | channel | fa       | 50000       | 1000       | 7          | 0%        | 2 days    | 900    |
| dt_en_news     | ok          | channel | en       | 12000       | estimated  | (see note) | 0%        | 6 hours   | 50     |
| dt_followed_a  | ok          | channel | en       | 7000        | 700        | 7          | 0%        | 2 days    |        |
| dt_ru          | ok          | channel | ru       | 3000        | 400        | 3.5        | 20%       | 3 days    |        |
| dt_fa_small    | ok          | channel | fa       | 800         | 100        | 1          | 40%       | 20 days   |        |
| dt_none        | ok          | channel |          |             |            |            |           |           |        |
| dt_dead        | unavailable | channel |          |             |            |            |           |           |        |
| dt_bot         | ok          | bot     | (never listed: the Directory lists Channels)                               |

`dt_fa_small` was found 100 days ago, every other entry today. Its display
name is "Kucheh News"; `dt_en_news`'s is "Daily News".

| Reference from | to          | kind    | age      |
|----------------|-------------|---------|----------|
| src_a1         | dt_fa_big   | forward | 1 day    |
| src_a1         | dt_en_news  | mention | 30 days  |
| src_a2         | dt_fa_big   | link    | 2 days   |
| src_a2         | dt_fa_small | mention | 3 days   |
| src_b1         | dt_ru       | forward | 1 day    |
| src_b1         | dt_fa_small | forward | 40 days  |
| dt_ru          | dt_en_news  | mention | 5 days   |

So "cited by your channels" over every follow is dt_fa_big 2, dt_en_news 1,
dt_fa_small 1 for the Operator, and dt_ru 1, dt_fa_small 1 for the other.

## Watched to fail

* compile an empty group as false -> the empty-group cases
* drop the `coalesce` around an atom -> NOT on dt_none's Language and bounds
* read Followed from every Account's Follows -> the other Account's opening view
* count every Reference row instead of distinct Citing Channels -> dt_fa_big 3
* drop the Reference kinds narrowing -> the forward-only cases
* ignore the window on "Cited by your channels" -> `mine:7d`
* resolve "every follow" for the empty selection -> the empty-source case
* sort without the handle tiebreak -> the opening view's zero-count tail
* drop the measure's own bound from the distribution -> its total
* leave Language Conditions in the Language counts -> the counts case
* add `kind = 'channel'` nowhere -> dt_bot listed and the size 8
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import DirectoryEntry, utc_now
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
HOUR = 3_600_000
DAY = 24 * HOUR

FA = "این یک متن فارسی است درباره اخبار امروز و سیاست"
EN = "This is an English sentence about the news of today and politics"
RU = "Это русский текст о новостях и политике сегодня"

#: handle -> (name, words, subscribers, photos, samples, newest age in days,
#: spacing in days, views, forwarded samples)
ENTRIES: dict[str, tuple[Any, ...]] = {
    "dt_fa_big": ("Persian Big", FA, 50000, 900, 5, 2, 1, 1000, 0),
    "dt_en_news": ("Daily News", EN, 12000, 50, 5, 0.25, 0.01, 10, 0),
    "dt_followed_a": ("Followed A", EN, 7000, None, 5, 2, 1, 700, 0),
    "dt_ru": ("Russkiy", RU, 3000, None, 5, 3, 2, 400, 1),
    "dt_fa_small": ("Kucheh News", FA, 800, None, 5, 20, 7, 100, 2),
}

#: (from, to, kind, age in days)
REFERENCES = [
    ("src_a1", "dt_fa_big", "forward", 1),
    ("src_a1", "dt_en_news", "mention", 30),
    ("src_a2", "dt_fa_big", "link", 2),
    ("src_a2", "dt_fa_small", "mention", 3),
    ("src_b1", "dt_ru", "forward", 1),
    ("src_b1", "dt_fa_small", "forward", 40),
    ("dt_ru", "dt_en_news", "mention", 5),
]

OPERATOR_FOLLOWS = ("src_a1", "src_a2", "dt_followed_a")
OTHER_FOLLOWS = ("src_b1",)


def _probe(session: Session, handle: str, spec: tuple[Any, ...] | None) -> None:
    now = int(time.time() * 1000)
    page: dict[str, Any] = {"isTelegramPage": True, "kind": "channel"}
    if spec is not None:
        name, words, subscribers, photos, count, newest, spacing, views, fwd = spec
        page |= {
            "displayName": name,
            "subscribers": subscribers,
            "photos": photos,
            "samples": [
                {
                    "id": i + 1,
                    "text": words,
                    "date": "2026-10-01T00:00:00+00:00",
                    "timestamp": now - int((newest + i * spacing) * DAY),
                    "channelName": handle,
                    "forwardedFrom": "elsewhere" if i < fwd else None,
                    "media": {"kinds": [], "viewsCount": views},
                }
                for i in range(count)
            ],
        }
    record_probe_result(session, handle, page)


def _seed(other_id: uuid.UUID) -> None:
    now = int(time.time() * 1000)
    with Session(engine) as session:
        for handle, spec in ENTRIES.items():
            _probe(session, handle, spec)
        _probe(session, "dt_none", None)
        record_probe_result(
            session,
            "dt_dead",
            {"isTelegramPage": True, "isUnavailableOnWebView": True, "kind": "channel"},
        )
        record_probe_result(session, "dt_bot", {"isTelegramPage": True, "kind": "bot"})
        entry = session.get(DirectoryEntry, "dt_fa_small")
        assert entry is not None
        entry.created_at = utc_now() - timedelta(days=100)
        session.add(entry)
        write_references(
            session,
            [
                SourcedReferences(
                    source_chat_id=abs(hash(source)) % 10**9,
                    source_channel=source,
                    source_post_id=n,
                    timestamp=now - age * DAY,
                    references=[Reference(target_handle=target, kind=kind)],
                )
                for n, (source, target, kind, age) in enumerate(REFERENCES)
            ],
            target_chat_ids={},
        )
        session.commit()
        follow_channels(session, *OPERATOR_FOLLOWS)
        follow_channels(session, *OTHER_FOLLOWS, user_id=other_id)
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
            session=session, db_user=user, user_in=UserUpdate(password="dir02-pass")
        )
        other_id, email = user.id, user.email
    _seed(other_id)
    other = user_authentication_headers(
        client=client, email=email, password="dir02-pass"
    )
    yield get_superuser_token_headers(client), other
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


# ---- The tree, as the browser sends it --------------------------------------


def atom(cond: dict[str, Any], *, negated: bool = False) -> dict[str, Any]:
    node: dict[str, Any] = {"kind": "atom", "id": "x", "cond": cond}
    if negated:
        node["not"] = True
    return node


def group(op: str, *children: dict[str, Any], negated: bool = False) -> dict[str, Any]:
    node: dict[str, Any] = {"kind": "group", "id": "g", "op": op}
    node["children"] = list(children)
    if negated:
        node["not"] = True
    return node


def root(*children: dict[str, Any], op: str = "and", negated: bool = False) -> Any:
    return {**group(op, *children, negated=negated), "id": "root"}


def flag(value: str) -> dict[str, Any]:
    return {"type": "flag", "value": value}


def lang(value: str) -> dict[str, Any]:
    return {"type": "language", "value": value}


def name(value: str) -> dict[str, Any]:
    return {"type": "name", "value": value}


def measure(which: str, **bound: Any) -> dict[str, Any]:
    return {"type": "measure", "measure": which, **bound}


def mine(days: int | None = None) -> dict[str, Any]:
    return {"type": "mine", "days": days}


OPENING = root(atom(flag("followed"), negated=True), atom(flag("followable")))


def _list(client: TestClient, headers: dict[str, str], **body: Any) -> dict[str, Any]:
    response = client.post(f"{DIRECTORY}/list", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


def _handles(client: TestClient, headers: dict[str, str], **body: Any) -> list[str]:
    return [row["handle"] for row in _list(client, headers, **body)["rows"]]


# ---- The opening view ---------------------------------------------------------


def test_the_opening_view_ranks_by_the_accounts_own_channels(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    mine_page = _list(client, operator, filter=OPENING)
    assert [(r["handle"], r["mine"]) for r in mine_page["rows"]] == [
        ("dt_fa_big", 2),
        ("dt_en_news", 1),
        ("dt_fa_small", 1),
        ("dt_none", 0),
        ("dt_ru", 0),
    ]
    # The other Account does not follow dt_followed_a, so it is theirs to find.
    theirs = _list(client, other, filter=OPENING)
    assert [(r["handle"], r["mine"]) for r in theirs["rows"]] == [
        ("dt_fa_small", 1),
        ("dt_ru", 1),
        ("dt_en_news", 0),
        ("dt_fa_big", 0),
        ("dt_followed_a", 0),
        ("dt_none", 0),
    ]
    assert mine_page["total"] == 5
    assert theirs["total"] == 6
