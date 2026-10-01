"""The Post filter, end to end over HTTP, with two live accounts (PTR-03).

`POST /data/posts`, `/data/posts/counts` and `/data/posts/lookup` take the
Post filter as a tree of Conditions (AND, OR, NOT, parentheses), the Channels
tab's filter over Posts, and the server evaluates it. `/data/posts/facets`
counts every value in the window, filters aside. The Operator follows `pt_a`
and `pt_b`, the second account `pt_b` and `pt_c`, over one shared corpus, at
the default settings (settling 24h, floor 3h) and the seed curve:

| Post | channel | language | media | forwarded from | views | observed | estimated |
|------|---------|----------|-------|----------------|-------|----------|-----------|
| 1    | pt_a    | fa       | photo |                | 5000  | 48h      | 5000      |
| 2    | pt_a    | en       | video | pt_b           | 1000  | 1h       | too new   |
| 3    | pt_a    | (unread) |       |                | none  |          | none      |
| 4    | pt_b    | fa       | video | elsewhere      | 2000  | 6h       | 2543      |
| 5    | pt_b    | en       | photo |                | 300   | 48h      | 300       |
| 6    | pt_c    | fa       | photo |                | 9000  | 48h      | 9000      |

Ids run in time order, so the feed's newest-first order is the ids descending.

## Watched to fail

* drop the `coalesce` around an atom -> NOT on Post 3's Language and Views
* evaluate an empty group as false -> the empty-group cases
* drop the depth or the node bound -> the size cases 200
* a Channel Condition read outside the follow scope -> Post 6 for the Operator
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import Post
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"
HOUR = 3_600_000
BASE = int(time.time() * 1000) - 200 * HOUR
ALL = ["pt_a", "pt_b", "pt_c"]

#: (channel, id, language, media kinds, forwarded from, views, hours observed)
CORPUS: list[
    tuple[str, int, str | None, list[str], str | None, int | None, float | None]
] = [
    ("pt_a", 1, "fa", ["photo"], None, 5000, 48),
    ("pt_a", 2, "en", ["video"], "pt_b", 1000, 1),
    ("pt_a", 3, None, [], None, None, None),
    ("pt_b", 4, "fa", ["video"], "elsewhere", 2000, 6),
    ("pt_b", 5, "en", ["photo"], None, 300, 48),
    ("pt_c", 6, "fa", ["photo"], None, 9000, 48),
]


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        from app import crud
        from app.models import UserUpdate

        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="ptr03-pass")
        )
        user_id, email = user.id, user.email
    headers = user_authentication_headers(
        client=client, email=email, password="ptr03-pass"
    )
    yield user_id, headers
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


@pytest.fixture
def seeded(
    client: TestClient, other: tuple[uuid.UUID, dict[str, str]]
) -> tuple[dict[str, str], dict[str, str]]:
    """Write the corpus and both accounts' follows; answer both accounts' headers."""
    other_id, other_headers = other
    with Session(engine) as session:
        for channel, post_id, language, kinds, source, views, hours in CORPUS:
            timestamp = BASE + post_id * 60_000
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=f"{channel} post {post_id}",
                    timestamp=timestamp,
                    language=language,
                    media={"kinds": kinds} if kinds else None,
                    forwarded_from=source,
                    views_count=views,
                    views_observed_at=(
                        None if hours is None else timestamp + int(hours * HOUR)
                    ),
                )
            )
        session.commit()
        follow_channels(session, "pt_a", "pt_b")
        follow_channels(session, "pt_b", "pt_c", user_id=other_id)
        session.commit()
    return get_superuser_token_headers(client), other_headers


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


def lang(value: str) -> dict[str, Any]:
    return {"type": "language", "value": value}


def media(value: str) -> dict[str, Any]:
    return {"type": "media", "value": value}


def kind(value: str) -> dict[str, Any]:
    return {"type": "type", "value": value}


def channel(value: str) -> dict[str, Any]:
    return {"type": "channel", "value": value}


def views(measure: str, **bound: Any) -> dict[str, Any]:
    return {"type": "views", "measure": measure, **bound}


def _feed(
    client: TestClient, headers: dict[str, str], tree: Any, **scope: Any
) -> list[int]:
    response = client.post(
        f"{PREFIX}/posts",
        json={"channelNames": ALL, "filter": tree, **scope},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()]


# ---- AND, OR, NOT and parentheses -------------------------------------------


@pytest.mark.parametrize(
    ("tree", "mine", "theirs"),
    [
        (root(atom(lang("fa")), atom(media("photo"))), [1], [6]),
        (root(atom(lang("en")), atom(media("video")), op="or"), [5, 4, 2], [5, 4]),
        # Post 3 has no Language: it fails "fa" and so passes NOT "fa".
        (root(atom(lang("fa"), negated=True)), [5, 3, 2], [5]),
        (
            root(
                group("and", atom(lang("fa")), atom(media("video"))),
                group("and", atom(lang("en")), atom(media("photo"))),
                op="or",
            ),
            [5, 4],
            [5, 4],
        ),
        (
            root(
                group("or", atom(kind("forwarded")), atom(media("photo")), negated=True)
            ),
            [3],
            [],
        ),
        # A negated root is NOT over everything it holds.
        (
            root(atom(lang("fa")), atom(media("photo")), negated=True),
            [5, 4, 3, 2],
            [5, 4],
        ),
    ],
    ids=["and", "or", "not-language", "nested", "not-group", "not-root"],
)
def test_conditions_join_with_and_or_not_and_nest(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    tree: Any,
    mine: list[int],
    theirs: list[int],
) -> None:
    operator, other = seeded

    assert _feed(client, operator, tree) == mine
    assert _feed(client, other, tree) == theirs


@pytest.mark.parametrize(
    "tree",
    [
        root(),
        root(negated=True),
        root(group("and", negated=True)),
        root(group("or"), atom(lang("fa"), negated=True), op="or"),
    ],
    ids=["empty", "negated-empty", "negated-empty-group", "empty-or-sibling"],
)
def test_an_empty_group_keeps_every_post_negated_or_not(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]], tree: Any
) -> None:
    operator, _other = seeded

    assert _feed(client, operator, tree) == [5, 4, 3, 2, 1]


def test_no_filter_keeps_every_post(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    response = client.post(
        f"{PREFIX}/posts", json={"channelNames": ALL}, headers=operator
    )

    assert [row["id"] for row in response.json()] == [5, 4, 3, 2, 1]


# ---- Types, views bounds and Channels ---------------------------------------


@pytest.mark.parametrize(
    ("value", "mine", "theirs"),
    [
        ("forwarded", [4, 2], [4]),
        ("original", [5, 3, 1], [6, 5]),
        # Post 2 forwards a Channel the Operator follows; Post 4 one nobody does.
        ("unfollowed_forwarded", [4], [4]),
    ],
)
def test_a_type_condition(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    value: str,
    mine: list[int],
    theirs: list[int],
) -> None:
    operator, other = seeded
    tree = root(atom(kind(value)))

    assert _feed(client, operator, tree) == mine
    assert _feed(client, other, tree) == theirs


@pytest.mark.parametrize(
    ("cond", "negated", "expected"),
    [
        (views("views", min=2500), False, [1]),
        # Post 4's estimate is 2543; Post 2 is too new to have one.
        (views("estimated", min=2500), False, [4, 1]),
        (views("views", min=500, max=2500), False, [4, 2]),
        (views("views", max=500), False, [5]),
        (views("views", none=True), False, [3]),
        (views("estimated", none=True), False, [3, 2]),
        (views("views", none=True), True, [5, 4, 2, 1]),
        # Post 3 has no View count: it fails the bound and passes its NOT.
        (views("views", min=2500), True, [5, 4, 3, 2]),
        (views("estimated", min=2500), True, [5, 3, 2]),
    ],
    ids=[
        "views-min",
        "estimated-min",
        "between",
        "views-max",
        "views-none",
        "estimated-none",
        "not-none",
        "not-views-min",
        "not-estimated-min",
    ],
)
def test_a_views_bound_reads_the_measure_it_names(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    cond: dict[str, Any],
    negated: bool,
    expected: list[int],
) -> None:
    operator, _other = seeded

    assert _feed(client, operator, root(atom(cond, negated=negated))) == expected


def test_a_bound_on_each_measure_in_one_tree(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Each bound reads its own measure, whatever the sort's measure is."""
    operator, _other = seeded
    tree = root(atom(views("views", min=1000)), atom(views("estimated", max=3000)))

    assert _feed(client, operator, tree, viewMeasure="views") == [4]


def test_a_channel_condition_names_a_followed_channel_or_matches_nothing(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded

    assert _feed(client, operator, root(atom(channel("pt_a")))) == [3, 2, 1]
    assert _feed(client, operator, root(atom(channel("pt_c")))) == []
    assert _feed(client, operator, root(atom(channel("pt_c"), negated=True))) == [
        5,
        4,
        3,
        2,
        1,
    ]
    assert _feed(client, other, root(atom(channel("pt_c")))) == [6]


# ---- The size bounds and the vocabulary -------------------------------------


def _deep(depth: int) -> Any:
    node: Any = atom(lang("fa"))
    for _ in range(depth - 1):
        node = group("and", node)
    return {**node, "id": "root"} if node["kind"] == "group" else root(node)


@pytest.mark.parametrize(
    ("tree", "status"),
    [
        (_deep(6), 200),
        (_deep(7), 422),
        (root(*[atom(lang("fa")) for _ in range(99)]), 200),
        (root(*[atom(lang("fa")) for _ in range(100)]), 422),
        (root(atom({"type": "reach", "value": "1"})), 422),
        (root(atom(media("hologram"))), 422),
        (root(atom(views("reach", min=1))), 422),
        (root(atom(views("views", min=-1))), 422),
        (root(atom({**lang("fa"), "extra": 1})), 422),
    ],
    ids=[
        "depth-6",
        "depth-7",
        "100-nodes",
        "101-nodes",
        "unknown-condition",
        "unknown-media",
        "unknown-measure",
        "negative-bound",
        "unknown-key",
    ],
)
def test_the_tree_is_bounded_and_its_vocabulary_closed(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    tree: Any,
    status: int,
) -> None:
    operator, _other = seeded
    response = client.post(
        f"{PREFIX}/posts", json={"channelNames": ALL, "filter": tree}, headers=operator
    )

    assert response.status_code == status, response.text


@pytest.mark.parametrize(
    "field",
    [
        {"forwarded": "original"},
        {"media": ["photo"]},
        {"languages": ["fa"]},
        {"views": {"op": "gte", "value": 1}},
    ],
    ids=["forwarded", "media", "languages", "views"],
)
@pytest.mark.parametrize("path", ["/posts", "/posts/counts"])
def test_the_flat_filters_are_gone_from_the_reads(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    field: dict[str, Any],
    path: str,
) -> None:
    """A browser on the previous bundle is refused rather than shown everything."""
    operator, _other = seeded
    response = client.post(
        f"{PREFIX}{path}", json={"channelNames": ALL, **field}, headers=operator
    )

    assert response.status_code == 422


# ---- Counts, facets and the lookup under a tree ------------------------------


def _counts(client: TestClient, headers: dict[str, str], tree: Any) -> Any:
    response = client.post(
        f"{PREFIX}/posts/counts",
        json={"channelNames": ALL, "filter": tree},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_counts_are_exactly_what_the_filter_shows(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded
    tree = root(atom(lang("fa"), negated=True))

    assert _counts(client, operator, tree) == {
        "counts": {"pt_a": 2, "pt_b": 1},
        "tooNewToJudge": 0,
    }
    assert _counts(client, other, tree) == {"counts": {"pt_b": 1}, "tooNewToJudge": 0}


def test_too_new_to_judge_counts_the_posts_an_estimate_bound_hid_for_being_new(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Post 2 is too new; Post 3 has no count and Post 5 too few, neither too new."""
    operator, _other = seeded

    assert _counts(client, operator, root(atom(views("estimated", min=500)))) == {
        "counts": {"pt_a": 1, "pt_b": 1},
        "tooNewToJudge": 1,
    }
    # Kept by the other half of an OR, it was not hidden.
    assert (
        _counts(
            client,
            operator,
            root(atom(views("estimated", min=500)), atom(lang("en")), op="or"),
        )["tooNewToJudge"]
        == 0
    )
    assert _counts(client, operator, root(atom(views("views", min=5000)))) == {
        "counts": {"pt_a": 1},
        "tooNewToJudge": 0,
    }


def test_facets_count_every_value_in_the_window_filters_aside(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded

    def facets(headers: dict[str, str]) -> Any:
        response = client.post(
            f"{PREFIX}/posts/facets", json={"channelNames": ALL}, headers=headers
        )
        assert response.status_code == 200, response.text
        body = response.json()
        # The projection: exactly these keys, each value a count, no `null`.
        assert set(body) == {"total", "types", "languages", "media"}
        assert all(
            set(f) == {"value", "count"} for k in body if k != "total" for f in body[k]
        )
        return {
            "total": body["total"],
            **{
                key: {f["value"]: f["count"] for f in body[key] if f["count"]}
                for key in ("types", "media", "languages")
            },
        }

    assert facets(operator) == {
        "total": 5,
        "types": {"forwarded": 2, "original": 3, "unfollowed_forwarded": 1},
        "media": {"photo": 2, "video": 2, "text_only": 1},
        "languages": {"fa": 2, "en": 2},
    }
    assert facets(other) == {
        "total": 3,
        "types": {"forwarded": 1, "original": 2, "unfollowed_forwarded": 1},
        "media": {"photo": 2, "video": 1},
        "languages": {"fa": 2, "en": 1},
    }


def test_facets_take_no_filter(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Filters aside means none is accepted, not one quietly ignored."""
    operator, _other = seeded
    response = client.post(
        f"{PREFIX}/posts/facets",
        json={"channelNames": ALL, "filter": root(atom(lang("fa")))},
        headers=operator,
    )

    assert response.status_code == 422


def test_the_lookup_takes_the_filter(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """A meaning search's ranked Posts pass the filter on the server."""
    operator, _other = seeded
    refs = [
        {"channelName": name, "postId": post_id}
        for name, post_id in (("pt_a", 1), ("pt_a", 2), ("pt_a", 3), ("pt_c", 6))
    ]

    def lookup(**extra: Any) -> list[int]:
        response = client.post(
            f"{PREFIX}/posts/lookup", json={"posts": refs, **extra}, headers=operator
        )
        assert response.status_code == 200, response.text
        return sorted(row["id"] for row in response.json())

    assert lookup() == [1, 2, 3]
    assert lookup(filter=root(atom(lang("fa"), negated=True))) == [2, 3]
    assert lookup(filter=root(atom(views("estimated", min=2500)))) == [1]
