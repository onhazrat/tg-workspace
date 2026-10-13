"""The value histogram behind the Views and Estimated views editors (PTI-01).

`POST /data/posts/value-histogram` bins one measure over the Analysis window
and the selected Channels, the Post filter and keyword aside, by the Channels
tab's rule: 32 bars from the lowest value to the highest, logarithmic (log, or
log(1 + x) from zero) when the highest is over 100 times the lowest.

The Operator follows the `vh_lin`, `vh_log`, `vh_zero` and `vh_est` Channels,
the second account `vh_est` and `vh_x`, over one shared corpus.

## Watched to fail

* bin linearly whatever the spread -> the logarithmic cases
* bin from zero on log rather than log(1 + x) -> `vh_zero`
* count a Post with no value as measured -> `measured` against `total`
* read without the tenancy seam -> another account's Posts
* apply the Post filter or keyword -> `test_the_filter_and_keyword_are_aside`
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models import User, UserUpdate
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

URL = f"{settings.API_V1_STR}/data/posts/value-histogram"
BULK = f"{settings.API_V1_STR}/data/posts/bulk"
HOUR = 3_600_000
#: Every Post sits in this hour, 300 hours ago.
BASE = (int(time.time() * 1000) // HOUR - 300) * HOUR

#: (channel, views, age at observation in hours). Settled at 48h, so the
#: Estimated View count is the View count; under the 3h floor it has none.
CORPUS: list[tuple[str, int | None, float]] = [
    *(("vh_lin", v, 48) for v in range(100, 1001, 100)),
    *(("vh_log", v, 48) for v in (1, 5, 50, 500, 5000)),
    *(("vh_zero", v, 48) for v in (0, 9, 99, 999)),
    ("vh_est", 1000, 48),
    ("vh_est", 500, 1),
    ("vh_est", None, 48),
    ("vh_x", 1_000_000, 48),
]


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="pti01-pass")
        )
        user_id, email = user.id, user.email
    yield (
        user_id,
        user_authentication_headers(client=client, email=email, password="pti01-pass"),
    )
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


@pytest.fixture
def seeded(
    client: TestClient, other: tuple[uuid.UUID, dict[str, str]]
) -> tuple[dict[str, str], dict[str, str]]:
    """Write the corpus and both accounts' follows; answer both accounts' headers."""
    operator = get_superuser_token_headers(client)
    rows: list[dict[str, Any]] = []
    for post_id, (channel, views, age) in enumerate(CORPUS, start=1):
        timestamp = BASE + post_id * 60_000
        row: dict[str, Any] = {
            "id": post_id,
            "channelName": channel,
            "text": f"{channel} {post_id}",
            "timestamp": timestamp,
        }
        if views is not None:
            row["viewsCount"] = views
            row["viewsObservedAt"] = timestamp + int(age * HOUR)
        rows.append(row)
    response = client.post(BULK, json=rows, headers=operator)
    assert response.status_code == 200, response.text
    other_id, other_headers = other
    with Session(engine) as session:
        follow_channels(session, "vh_lin", "vh_log", "vh_zero", "vh_est")
        follow_channels(session, "vh_est", "vh_x", user_id=other_id)
        session.commit()
    return operator, other_headers


def _histogram(
    client: TestClient, headers: dict[str, str], measure: str, **scope: Any
) -> dict[str, Any]:
    response = client.post(URL, json={"measure": measure, **scope}, headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _filled(bins: list[int]) -> list[int]:
    return [i for i, n in enumerate(bins) if n]


def test_two_orders_of_magnitude_or_fewer_bin_linearly(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = seeded
    got = _histogram(client, operator, "views", channelNames=["vh_lin"])

    assert got["log"] is False
    assert len(got["bins"]) == 32
    assert len(got["edges"]) == 33
    # 100 to 1,000 in 32 bars of 28.125: 200 lands in bar 3, 1,000 in the last.
    assert got["edges"][0] == 100
    assert got["edges"][16] == 550
    assert got["edges"][32] == 1000
    assert _filled(got["bins"]) == [0, 3, 7, 10, 14, 17, 21, 24, 28, 31]
    assert got["median"] == 550
    assert (got["measured"], got["total"]) == (10, 10)


def test_past_two_orders_of_magnitude_the_bars_are_logarithmic(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """A linear axis would put 1, 5, 50 and 500 all in the first bar."""
    operator, _ = seeded
    got = _histogram(client, operator, "views", channelNames=["vh_log"])

    assert got["log"] is True
    # ln(v) / ln(5000) x 32: 5 -> 6.05, 50 -> 14.7, 500 -> 23.4.
    assert _filled(got["bins"]) == [0, 6, 14, 23, 31]
    assert (got["edges"][0], got["edges"][32]) == (1, 5000)
    assert got["edges"][16] == pytest.approx(5000**0.5)
    assert got["median"] == 50


def test_a_range_from_zero_is_logarithmic_on_one_plus_the_value(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = seeded
    got = _histogram(client, operator, "views", channelNames=["vh_zero"])

    assert got["log"] is True
    # ln(1 + v) / ln(1000) x 32: 9 -> 10.7, 99 -> 21.3.
    assert _filled(got["bins"]) == [0, 10, 21, 31]
    assert got["edges"][0] == 0
    assert got["edges"][16] == pytest.approx(1000**0.5 - 1)


def test_a_post_with_no_value_is_counted_but_not_measured(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Under the floor a Post has a View count and no Estimated View count."""
    operator, _ = seeded
    views = _histogram(client, operator, "views", channelNames=["vh_est"])
    estimated = _histogram(client, operator, "estimated", channelNames=["vh_est"])

    assert (views["measured"], views["total"]) == (2, 3)
    assert (estimated["measured"], estimated["total"]) == (1, 3)
    assert sum(estimated["bins"]) == 1
    assert estimated["median"] == 1000


def test_an_empty_window_has_nothing_measured(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = seeded
    window = {"mode": "fixed", "start": BASE - 2 * HOUR, "end": BASE - HOUR}
    got = _histogram(client, operator, "views", window=window)

    assert got == {
        "bins": [],
        "edges": [],
        "log": False,
        "median": None,
        "measured": 0,
        "total": 0,
    }
    # And the same window around the Posts finds them.
    window = {"mode": "fixed", "start": BASE, "end": BASE + HOUR}
    assert _histogram(client, operator, "views", window=window)["total"] == 22


def test_another_accounts_posts_are_never_counted(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """`vh_x`'s million views would stretch the Operator's axis if it leaked."""
    operator, other = seeded

    mine = _histogram(client, operator, "views", channelNames=["vh_est", "vh_x"])
    assert (mine["measured"], mine["total"], mine["edges"][32]) == (2, 3, 1000)
    # No Channels named is every Channel the account follows, and only those.
    assert _histogram(client, operator, "views")["total"] == 22

    theirs = _histogram(client, other, "views", channelNames=["vh_lin", "vh_est"])
    assert (theirs["measured"], theirs["total"]) == (2, 3)
    assert _histogram(client, other, "views")["edges"][32] == 1_000_000


def test_the_filter_and_keyword_are_aside(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """The bars hold still while the Account changes another Condition."""
    operator, _ = seeded
    keeps_nothing = {
        "kind": "group",
        "id": "root",
        "op": "and",
        "children": [
            {
                "kind": "atom",
                "id": "v",
                "cond": {"type": "views", "measure": "views", "min": 10**9},
            }
        ],
    }
    scope: dict[str, Any] = {"channelNames": ["vh_lin"]}
    plain = _histogram(client, operator, "views", **scope)
    filtered = _histogram(
        client, operator, "views", filter=keeps_nothing, keyword="nowhere", **scope
    )

    assert filtered == plain
