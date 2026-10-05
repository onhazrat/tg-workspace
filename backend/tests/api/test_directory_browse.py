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
                    "media": {"kinds": [], "viewsCount": views, "caption": words},
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


# ---- Conditions, negation and nesting -------------------------------------------

#: Every listed entry by subscribers, highest first; no value last, by handle.
EVERYONE = [
    "dt_fa_big",
    "dt_en_news",
    "dt_followed_a",
    "dt_ru",
    "dt_fa_small",
    "dt_dead",
    "dt_none",
]


def _but(*left_out: str) -> list[str]:
    return [h for h in EVERYONE if h not in left_out]


@pytest.mark.parametrize(
    ("tree", "expected"),
    [
        (None, EVERYONE),
        # An empty group passes everything, negated or not.
        (root(), EVERYONE),
        (root(negated=True), EVERYONE),
        (root(group("or")), EVERYONE),
        (root(group("and", negated=True)), EVERYONE),
        (root(atom(lang("fa"))), ["dt_fa_big", "dt_fa_small"]),
        # dt_none and dt_dead have no Language: they fail "fa" and pass NOT "fa".
        (root(atom(lang("fa"), negated=True)), _but("dt_fa_big", "dt_fa_small")),
        (
            root(atom(lang("en")), atom(lang("ru")), op="or"),
            ["dt_en_news", "dt_followed_a", "dt_ru"],
        ),
        (root(atom(name("news"))), ["dt_en_news", "dt_fa_small"]),
        (root(atom(name("NEWS"))), ["dt_en_news", "dt_fa_small"]),
        (root(atom(name("big"))), ["dt_fa_big"]),
        # A LIKE wildcard is a literal character, not "anything".
        (root(atom(name("%"))), []),
        (
            root(atom(measure("subscribers", min=5000))),
            ["dt_fa_big", "dt_en_news", "dt_followed_a"],
        ),
        (
            root(atom(measure("subscribers", min=1000, max=10000))),
            ["dt_followed_a", "dt_ru"],
        ),
        (root(atom(measure("subscribers", none=True))), ["dt_dead", "dt_none"]),
        # No value fails the bound, so it passes the bound's negation.
        (
            root(atom(measure("subscribers", min=5000), negated=True)),
            ["dt_ru", "dt_fa_small", "dt_dead", "dt_none"],
        ),
        (
            root(atom(measure("reach", min=500))),
            ["dt_fa_big", "dt_followed_a"],
        ),
        (
            root(atom(measure("posts_per_week", min=5))),
            ["dt_fa_big", "dt_en_news", "dt_followed_a"],
        ),
        (root(atom(measure("forward_pct", min=30))), ["dt_fa_small"]),
        (
            root(atom(measure("last_post_days", max=7))),
            ["dt_fa_big", "dt_en_news", "dt_followed_a", "dt_ru"],
        ),
        (root(atom(measure("found_days", min=50))), ["dt_fa_small"]),
        (root(atom(measure("photos", min=100))), ["dt_fa_big"]),
        (root(atom(measure("videos", min=0))), []),
        (root(atom(measure("files", none=True))), EVERYONE),
        (root(atom(measure("links", max=10))), []),
        (root(atom(flag("followed"))), ["dt_followed_a"]),
        (root(atom(flag("followable"), negated=True)), ["dt_dead"]),
        (root(atom(mine())), ["dt_fa_big", "dt_en_news", "dt_fa_small"]),
        # The window: dt_en_news was last cited 30 days ago.
        (root(atom(mine(7))), ["dt_fa_big", "dt_fa_small"]),
        # An OR holding one of the opening view's Conditions.
        (
            root(group("or", atom(flag("followed")), atom(lang("ru")))),
            ["dt_followed_a", "dt_ru"],
        ),
        (
            root(
                atom(lang("fa")),
                group(
                    "or",
                    atom(measure("subscribers", min=10000)),
                    atom(measure("forward_pct", min=30)),
                ),
            ),
            ["dt_fa_big", "dt_fa_small"],
        ),
        (
            root(
                group(
                    "and",
                    atom(lang("fa")),
                    atom(measure("subscribers", min=10000)),
                    negated=True,
                )
            ),
            _but("dt_fa_big"),
        ),
    ],
)
def test_each_condition_narrows_the_list(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    tree: Any,
    expected: list[str],
) -> None:
    operator, _ = accounts
    page = _list(client, operator, filter=tree, sort="subscribers")
    assert [row["handle"] for row in page["rows"]] == expected
    assert page["total"] == len(expected)


def test_followed_is_the_accounts_own(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    followed = root(atom(flag("followed")))
    assert _handles(client, operator, filter=followed) == ["dt_followed_a"]
    assert _handles(client, other, filter=followed) == []
    rows = _list(client, other, filter=root(atom(name("followed"))))["rows"]
    assert [(r["handle"], r["followed"]) for r in rows] == [("dt_followed_a", False)]


# ---- "Your channels" and the Reference kinds --------------------------------------


def _mine(
    client: TestClient, headers: dict[str, str], **body: Any
) -> list[tuple[str, int]]:
    page = _list(client, headers, filter=root(atom(mine())), **body)
    return [(row["handle"], row["mine"]) for row in page["rows"]]


def test_your_channels_are_follows_a_selection_or_the_ticks(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    assert _mine(client, operator, yours={"source": "follows"}) == [
        ("dt_fa_big", 2),
        ("dt_en_news", 1),
        ("dt_fa_small", 1),
    ]
    assert _mine(
        client, operator, yours={"source": "selection", "handles": ["src_a2"]}
    ) == [("dt_fa_big", 1), ("dt_fa_small", 1)]
    # A Channel nobody follows still cites what its samples cite.
    assert _mine(
        client, operator, yours={"source": "ticked", "handles": ["@DT_RU"]}
    ) == [("dt_en_news", 1)]


def test_an_empty_source_counts_zero_and_says_so(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    page = _list(client, operator, yours={"source": "selection", "handles": []})
    assert page["yoursSize"] == 0
    assert {row["mine"] for row in page["rows"]} == {0}
    assert _mine(client, operator, yours={"source": "ticked", "handles": []}) == []
    assert _list(client, operator)["yoursSize"] == len(OPERATOR_FOLLOWS)


@pytest.mark.parametrize(
    ("kinds", "expected"),
    [
        (["forward"], [("dt_fa_big", 1)]),
        (["link"], [("dt_fa_big", 1)]),
        (["mention"], [("dt_en_news", 1), ("dt_fa_small", 1)]),
        (["forward", "link"], [("dt_fa_big", 2)]),
        ([], [("dt_fa_big", 2), ("dt_en_news", 1), ("dt_fa_small", 1)]),
    ],
)
def test_reference_kinds_narrow_your_channels(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    kinds: list[str],
    expected: list[tuple[str, int]],
) -> None:
    operator, _ = accounts
    assert _mine(client, operator, referenceKinds=kinds) == expected


def test_the_row_carries_the_newest_citation_time(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    rows = {r["handle"]: r for r in _list(client, operator)["rows"]}
    now = int(time.time() * 1000)
    assert abs(now - rows["dt_fa_big"]["mineLastAt"] - DAY) < HOUR
    assert rows["dt_ru"]["mineLastAt"] is None


# ---- Sorting ----------------------------------------------------------------------


def _dt(names: str) -> list[str]:
    return [f"dt_{n}" for n in names.split()]


#: No value sorts last either way, and equal values (or none) fall to the handle.
BY_HANDLE = "dead en_news fa_big fa_small followed_a none ru"


@pytest.mark.parametrize(
    ("sort", "descending", "expected"),
    [
        ("subscribers", True, "fa_big en_news followed_a ru fa_small dead none"),
        ("subscribers", False, "fa_small ru followed_a en_news fa_big dead none"),
        ("posts_per_week", True, "en_news fa_big followed_a ru fa_small dead none"),
        ("forward_pct", True, "fa_small ru en_news fa_big followed_a dead none"),
        ("last_post_days", False, "en_news followed_a fa_big ru fa_small dead none"),
        # Found the order they were probed in; dt_fa_small 100 days ago.
        ("found_days", True, "fa_small fa_big en_news followed_a ru none dead"),
        ("photos", True, "fa_big en_news dead fa_small followed_a none ru"),
        ("reach", True, "fa_big followed_a ru fa_small en_news dead none"),
        ("videos", True, BY_HANDLE),
        ("files", False, BY_HANDLE),
        ("links", True, BY_HANDLE),
        ("mine", True, "fa_big en_news fa_small dead followed_a none ru"),
        ("mine", False, "dead followed_a none ru en_news fa_small fa_big"),
        ("mine_last_days", True, "en_news fa_small fa_big dead followed_a none ru"),
        ("mine_last_days", False, "fa_big fa_small en_news dead followed_a none ru"),
    ],
)
def test_every_sort_orders_the_list(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    sort: str,
    descending: bool,
    expected: str,
) -> None:
    operator, _ = accounts
    handles = _handles(client, operator, sort=sort, descending=descending)
    assert handles == _dt(expected)


def test_pages_hold_a_hundred_and_keep_the_total(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    page = _list(client, operator, page=1)
    assert page["rows"] == []
    assert page["total"] == len(EVERYONE)


# ---- Totals, Language counts and the Directory's size -----------------------------


def test_language_counts_leave_out_the_language_conditions(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    page = _list(
        client,
        operator,
        filter=root(atom(lang("fa")), atom(measure("subscribers", min=1000))),
    )
    assert page["total"] == 1
    assert [(e["language"], e["count"]) for e in page["languages"]] == [
        ("en", 2),
        ("fa", 1),
        ("ru", 1),
    ]
    everything = _list(client, operator)
    assert [(e["language"], e["count"]) for e in everything["languages"]] == [
        ("en", 2),
        ("fa", 2),
        (None, 2),
        ("ru", 1),
    ]


def test_a_total_is_reused_across_sorts_and_pages(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Cached per Account and view; a new view counts afresh."""
    operator, _ = accounts
    assert _list(client, operator, filter=OPENING)["total"] == 5
    with Session(engine) as session:
        _probe(session, "dt_late", ENTRIES["dt_ru"])
    assert _list(client, operator, filter=OPENING, sort="reach")["total"] == 5
    assert _list(client, operator, filter=OPENING, page=1)["total"] == 5
    assert _list(client, operator, filter=root(atom(flag("followable"))))["total"] == 7


def test_the_directory_size_counts_every_listed_channel(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    for headers in (operator, other):
        response = client.get(f"{DIRECTORY}/size", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json() == {"size": len(EVERYONE)}


# ---- The bound editor's reads ----------------------------------------------------


def test_the_distribution_leaves_out_the_measures_own_bound(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    response = client.post(
        f"{DIRECTORY}/distribution",
        json={
            "filter": root(
                atom(lang("fa"), negated=True),
                atom(measure("subscribers", min=5000)),
            ),
            "measure": "subscribers",
        },
        headers=operator,
    )
    assert response.status_code == 200, response.text
    spread = response.json()
    # NOT fa: dt_en_news, dt_followed_a, dt_ru, dt_dead, dt_none.
    assert spread["total"] == 5
    assert spread["noValue"] == 2
    assert (spread["min"], spread["max"], spread["median"]) == (3000, 12000, 7000)
    assert spread["scale"] == "log"
    assert len(spread["bins"]) == 32
    assert sum(b["count"] for b in spread["bins"]) == 3
    assert spread["bins"][0]["lo"] == pytest.approx(3000)
    assert spread["bins"][-1]["hi"] == pytest.approx(12000)


def test_a_linear_measure_and_one_with_no_values(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    linear = client.post(
        f"{DIRECTORY}/distribution", json={"measure": "forward_pct"}, headers=operator
    ).json()
    assert linear["scale"] == "linear"
    assert (linear["min"], linear["max"]) == (0, 40)
    empty = client.post(
        f"{DIRECTORY}/distribution", json={"measure": "videos"}, headers=operator
    ).json()
    assert (empty["total"], empty["noValue"], empty["bins"]) == (7, 7, [])


def test_the_count_previews_a_candidate_condition(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    body: dict[str, Any] = {"filter": root(atom(lang("fa")))}
    response = client.post(f"{DIRECTORY}/count", json=body, headers=operator)
    assert response.status_code == 200, response.text
    assert response.json() == {"total": 2}
    body["candidate"] = atom(measure("subscribers", min=1000))
    assert client.post(f"{DIRECTORY}/count", json=body, headers=operator).json() == {
        "total": 1
    }
    alone = {"candidate": atom(flag("followable"), negated=True)}
    assert client.post(f"{DIRECTORY}/count", json=alone, headers=operator).json() == {
        "total": 1
    }


# ---- What the server refuses ------------------------------------------------------


def _deep(levels: int) -> dict[str, Any]:
    node = atom(lang("fa"))
    for _ in range(levels - 1):
        node = group("and", node)
    return {**node, "id": "root"}


@pytest.mark.parametrize(
    "tree",
    [
        _deep(7),
        root(*[atom(lang("fa")) for _ in range(100)]),
        root(atom({"type": "photo"})),
        root(atom({"type": "measure", "measure": "views"})),
        root(atom({"type": "flag", "value": "dismissed"})),
        root(atom(lang("fa") | {"extra": 1})),
    ],
)
def test_an_unknown_or_oversized_filter_is_refused(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]], tree: Any
) -> None:
    operator, _ = accounts
    response = client.post(f"{DIRECTORY}/list", json={"filter": tree}, headers=operator)
    assert response.status_code == 422


def test_the_deepest_and_largest_filters_are_accepted(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    assert _handles(client, operator, filter=_deep(6)) == _handles(
        client, operator, filter=root(atom(lang("fa")))
    )
    _list(client, operator, filter=root(*[atom(lang("fa")) for _ in range(99)]))


# ---- Follow from the Directory ----------------------------------------------------


def test_a_follow_records_the_newest_reference_from_your_channels(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def not_now(_follow_job_id: str) -> None:
        return None

    monkeypatch.setattr("app.api.routes.data.channels.request_follow_job_run", not_now)
    operator, _ = accounts
    response = client.post(
        f"{settings.API_V1_STR}/data/channels/bulk-follow",
        json={
            "channels": [
                {"name": "dt_fa_big"},
                {"name": "dt_ru"},
                {
                    "name": "dt_en_news",
                    "discoveredVia": {"channelName": "x", "postId": 1, "timestamp": 2},
                },
            ],
            "directory": {"yours": {"source": "follows"}},
        },
        headers=operator,
    )
    assert response.status_code == 200, response.text
    from app.services.follow_jobs import read_row

    with Session(engine) as session:
        row = read_row(session, response.json()["followJobId"])
        assert row is not None
        via = row.options["discoveredViaByName"]
    newest = via["dt_fa_big"]
    # src_a1 cited it a day ago, src_a2 two days ago.
    assert (newest["channelName"], newest["postId"]) == ("src_a1", 0)
    assert via["dt_ru"] is None
    assert via["dt_en_news"] == {"channelName": "x", "postId": 1, "timestamp": 2}


def test_the_reference_kinds_and_source_choose_the_discovered_via(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def not_now(_follow_job_id: str) -> None:
        return None

    monkeypatch.setattr("app.api.routes.data.channels.request_follow_job_run", not_now)
    operator, _ = accounts
    response = client.post(
        f"{settings.API_V1_STR}/data/channels/bulk-follow",
        json={
            "channels": [{"name": "dt_fa_big"}, {"name": "dt_fa_small"}],
            "directory": {
                "yours": {"source": "selection", "handles": ["src_a2"]},
                "referenceKinds": ["link"],
            },
        },
        headers=operator,
    )
    assert response.status_code == 200, response.text
    from app.services.follow_jobs import read_row

    with Session(engine) as session:
        row = read_row(session, response.json()["followJobId"])
        assert row is not None
        via = row.options["discoveredViaByName"]
    assert via["dt_fa_big"]["channelName"] == "src_a2"
    assert via["dt_fa_small"] is None


# ---- View-as -----------------------------------------------------------------------


@pytest.fixture
def view_as_other(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> Iterator[dict[str, str]]:
    """A read-only View-as session of the Operator's, looking at the other Account."""
    from app.models_view_as import ViewAsSession

    operator, other = accounts
    me = client.get(f"{settings.API_V1_STR}/users/me", headers=other).json()
    response = client.post(
        f"{settings.API_V1_STR}/view-as/{me['id']}", headers=operator
    )
    assert response.status_code == 200, response.text
    yield {"Authorization": f"Bearer {response.json()['accessToken']}"}
    with Session(engine) as session:
        session.exec(delete(ViewAsSession))
        session.commit()


def test_view_as_browses_the_directory_as_the_account_sees_it(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    view_as_other: dict[str, str],
) -> None:
    _, other = accounts
    assert _list(client, view_as_other, filter=OPENING) == _list(
        client, other, filter=OPENING
    )
    for path, body in (
        ("count", {"filter": OPENING}),
        ("distribution", {"measure": "reach"}),
    ):
        response = client.post(f"{DIRECTORY}/{path}", json=body, headers=view_as_other)
        assert response.status_code == 200, response.text
    size = client.get(f"{DIRECTORY}/size", headers=view_as_other)
    assert size.status_code == 200
    follow = client.post(
        f"{settings.API_V1_STR}/data/channels/bulk-follow",
        json={"channels": [{"name": "dt_ru"}], "directory": {}},
        headers=view_as_other,
    )
    assert follow.status_code == 403
