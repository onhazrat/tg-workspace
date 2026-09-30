"""Views and Estimated views, end to end over HTTP, with two live accounts (PFB-03).

`POST /data/posts` and `/data/posts/counts` filter and order by a Post's View
count or its Estimated View count (ADR-025). The Operator follows `pv_a` and
`pv_b`, the second account `pv_b` and `pv_c`, over one shared corpus, so a
threshold, an order and a cap are all asserted to read only the rows each
account can see.

The corpus, at the default settings (settling 24h, floor 3h) and the seed
curve, is laid out so the two measures disagree:

| Post  | views | age observed | estimated          |
|-------|-------|--------------|--------------------|
| a1    | 5000  | 48h          | 5000               |
| a2    | 1000  | 1h           | too new to judge   |
| a3    | none  |              | none               |
| a4    | 2000  | 6h           | 2000 x .89/.70 = 2543 |
| b5    | 3000  | 30h          | 3000               |
| b6    | 800   | 12h          | 800 x .89/.86 = 828 |
| c7    | 10000 | 2h           | too new to judge   |
| c8    | 400   | 100h         | 400                |

## Watched to fail

* compare with `>` rather than `>=` -> the boundary case
* sort nulls first under either views order
* rank the cap by time under a views order -> `test_the_cap_keeps_the_top_n`
* read the seed curve when a fit exists -> `test_the_newest_fit_is_the_curve`
* count too-new Posts under the raw measure, or outside the Scope
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
from app.models_tg import SettlingCurveFit
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"
BASE = int(time.time() * 1000)
HOUR = 3_600_000
ALL = ["pv_a", "pv_b", "pv_c"]

#: (channel, post id, views, age at observation in hours)
CORPUS: list[tuple[str, int, int | None, float | None]] = [
    ("pv_a", 1, 5000, 48),
    ("pv_a", 2, 1000, 1),
    ("pv_a", 3, None, None),
    ("pv_a", 4, 2000, 6),
    ("pv_b", 5, 3000, 30),
    ("pv_b", 6, 800, 12),
    ("pv_c", 7, 10000, 2),
    ("pv_c", 8, 400, 100),
]


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        from app import crud
        from app.models import UserUpdate

        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="pfb03-pass")
        )
        user_id, email = user.id, user.email
    headers = user_authentication_headers(
        client=client, email=email, password="pfb03-pass"
    )
    yield user_id, headers
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


@pytest.fixture
def seeded(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
) -> tuple[dict[str, str], dict[str, str]]:
    """Write the corpus and both accounts' follows; answer both accounts' headers."""
    rows: list[dict[str, Any]] = []
    for channel, post_id, views, age in CORPUS:
        # Each Post a minute apart, the id order being the time order.
        timestamp = BASE - 200 * HOUR + post_id * 60_000
        row: dict[str, Any] = {
            "id": post_id,
            "channelName": channel,
            "text": f"{channel} {post_id}",
            "timestamp": timestamp,
        }
        if views is not None and age is not None:
            row["viewsCount"] = views
            row["viewsObservedAt"] = timestamp + int(age * HOUR)
        rows.append(row)
    response = client.post(f"{PREFIX}/posts/bulk", json=rows, headers=operator)
    assert response.status_code == 200, response.text
    other_id, other_headers = other
    with Session(engine) as session:
        follow_channels(session, "pv_a", "pv_b")
        follow_channels(session, "pv_b", "pv_c", user_id=other_id)
        session.commit()
    return operator, other_headers


def _feed(client: TestClient, headers: dict[str, str], **scope: Any) -> list[int]:
    response = client.post(
        f"{PREFIX}/posts", json={"channelNames": ALL, **scope}, headers=headers
    )
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()]


def _counts(client: TestClient, headers: dict[str, str], **scope: Any) -> Any:
    response = client.post(
        f"{PREFIX}/posts/counts", json={"channelNames": ALL, **scope}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def _at_least(n: int) -> dict[str, Any]:
    return {"op": "gte", "value": n}


def _at_most(n: int) -> dict[str, Any]:
    return {"op": "lte", "value": n}


@pytest.mark.parametrize(
    ("measure", "views", "mine", "theirs"),
    [
        ("estimated", _at_least(2500), [5, 4, 1], [5]),
        ("views", _at_least(2500), [5, 1], [7, 5]),
        ("estimated", _at_most(900), [6], [8, 6]),
        ("views", _at_most(900), [6], [8, 6]),
        # A threshold on the value itself keeps it.
        ("views", _at_least(3000), [5, 1], [7, 5]),
    ],
)
def test_a_threshold_keeps_posts_on_its_side_under_either_measure(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    measure: str,
    views: dict[str, Any],
    mine: list[int],
    theirs: list[int],
) -> None:
    """A Post with no value never matches: not a3 (no count), not a2 or c7 (too new)."""
    operator, other = seeded
    scope = {"viewMeasure": measure, "views": views}

    assert _feed(client, operator, **scope) == mine
    assert _feed(client, other, **scope) == theirs


def test_estimated_is_the_measure_by_default(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded

    assert _feed(client, operator, views=_at_least(2500)) == [5, 4, 1]


@pytest.mark.parametrize(
    ("measure", "sort", "expected"),
    [
        ("estimated", "most_views", [1, 5, 4, 6, 3, 2]),
        ("estimated", "fewest_views", [6, 4, 5, 1, 3, 2]),
        ("views", "most_views", [1, 5, 4, 2, 6, 3]),
        ("views", "fewest_views", [6, 2, 4, 5, 1, 3]),
    ],
)
def test_the_views_orders_put_posts_with_no_value_last(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    measure: str,
    sort: str,
    expected: list[int],
) -> None:
    """With no threshold set, in both directions; ties fall to newest first."""
    operator, _other = seeded

    assert _feed(client, operator, viewMeasure=measure, sort=sort) == expected


def test_the_cap_keeps_the_top_n_under_a_views_order(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded
    scope = {"sort": "most_views", "maxPerChannel": 1}

    assert _feed(client, operator, **scope) == [1, 5]
    # c7 has the most raw views but no estimate, so c8 is pv_c's top one.
    assert _feed(client, other, **scope) == [5, 8]


def test_grouping_places_a_block_by_its_best_value(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded

    assert _feed(client, operator, sort="most_views", groupByChannel=True) == [
        1,
        4,
        3,
        2,
        5,
        6,
    ]
    # pv_c's best estimate is 400 and pv_b's 3000, so pv_b leads under most
    # and pv_c under fewest.
    assert _feed(client, other, sort="most_views", groupByChannel=True) == [
        5,
        6,
        8,
        7,
    ]
    assert _feed(client, other, sort="fewest_views", groupByChannel=True) == [
        8,
        7,
        6,
        5,
    ]


def test_paging_a_views_order_neither_repeats_nor_skips(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    pages = [
        _feed(client, operator, sort="most_views", limit=2, offset=offset)
        for offset in (0, 2, 4)
    ]

    assert [post for page in pages for post in page] == [1, 5, 4, 6, 3, 2]


def test_the_counts_say_how_many_posts_were_too_new_to_judge(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded
    estimated = {"views": _at_least(2500)}

    assert _counts(client, operator, **estimated) == {
        "counts": {"pv_a": 2, "pv_b": 1},
        "tooNewToJudge": 1,
    }
    assert _counts(client, other, **estimated) == {
        "counts": {"pv_b": 1},
        "tooNewToJudge": 1,
    }
    # An at-most threshold hides them too.
    assert _counts(client, operator, views=_at_most(900))["tooNewToJudge"] == 1
    # The raw measure judges every Post with a count, and no threshold hides none.
    assert _counts(client, operator, viewMeasure="views", **estimated) == {
        "counts": {"pv_a": 1, "pv_b": 1},
        "tooNewToJudge": 0,
    }
    assert _counts(client, operator) == {
        "counts": {"pv_a": 4, "pv_b": 2},
        "tooNewToJudge": 0,
    }


def test_the_newest_fit_is_the_curve(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """A fit that reads a 6-hour Post at a tenth of its settled count lifts a4."""
    operator, _other = seeded
    with Session(engine) as session:
        session.add(
            SettlingCurveFit(
                knots=[[1.0, 0.1], [6.0, 0.1], [24.0, 1.0]],
                settling_age_hours=24,
                observation_stride=1,
                pair_count=100,
                post_count=10,
                channel_count=2,
            )
        )
        session.commit()

    assert _feed(client, operator, views=_at_least(10_000)) == [4]


def test_the_browser_is_handed_the_curve_the_feed_reads(
    client: TestClient, operator: dict[str, str]
) -> None:
    """The seed's steps before any fit, then the newest fit's knots."""
    path = f"{PREFIX}/posts/view-estimate"
    before = client.get(path, headers=operator).json()
    assert before == {
        "curve": {
            "kind": "steps",
            "points": [[0, 0.2], [3, 0.59], [6, 0.7], [12, 0.86], [24, 0.89]],
        },
        "settlingAgeHours": 24,
        "estimationFloorHours": 3,
    }
    with Session(engine) as session:
        session.add(
            SettlingCurveFit(
                knots=[[1.0, 0.1], [24.0, 1.0]],
                settling_age_hours=24,
                observation_stride=1,
                pair_count=100,
                post_count=10,
                channel_count=2,
            )
        )
        session.commit()

    after = client.get(path, headers=operator).json()
    assert after["curve"] == {"kind": "knots", "points": [[1, 0.1], [24, 1]]}
    assert client.get(path).status_code == 401


@pytest.mark.parametrize(
    "scope",
    [
        {"viewMeasure": "reach"},
        {"views": {"op": "gt", "value": 10}},
        {"views": {"op": "gte", "value": -1}},
        {"views": {"op": "gte"}},
        {"sort": "most_reach"},
    ],
)
def test_an_unknown_value_is_refused(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    scope: dict[str, Any],
) -> None:
    operator, _other = seeded
    # The counts take no order, so an order is the feed's alone to refuse.
    paths = ["posts"] if "sort" in scope else ["posts", "posts/counts"]
    for path in paths:
        response = client.post(
            f"{PREFIX}/{path}", json={"channelNames": ALL, **scope}, headers=operator
        )
        assert response.status_code == 422, (path, response.text)
