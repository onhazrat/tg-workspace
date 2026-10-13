"""The window histogram behind the Analysis window editor's chart (PTI-03).

`POST /data/posts/window-histogram` counts the Posts in each equal slice of
`[extentStart, extentEnd)`. Filtered, it applies the Post filter, keyword and
Channel spotlight (a Channel Condition) without the per-Channel cap;
unfiltered, only the selected Channels. A Channel posts Condition still counts
within the Analysis window, which is not the extent.

The extent is ten one-minute buckets from `E0`; the window is its first two.
The Operator follows `wh_a` and `wh_b`, the second account `wh_b` and `wh_x`.

| Channel | Posts, minutes after E0                      |
|---------|----------------------------------------------|
| wh_a    | -0.001 (outside), 0, 1 (a boundary), 1.5 "hit", 9.999, 10 (outside) |
| wh_b    | 5 "hit"                                      |
| wh_x    | 2 "hit"                                      |

## Watched to fail

* apply the filter when unfiltered -> `test_unfiltered_counts_every_post_of_the_channels`
* ignore the filter or keyword when filtered -> `test_filtered_applies_the_filter_and_keyword`
* apply the cap -> `test_the_cap_is_ignored`
* a closed end, or a floor that puts a boundary in both buckets -> `test_the_extent_is_half_open`
* count Channel posts over the extent -> `test_channel_posts_count_within_the_window`
* read without the tenancy seam -> `test_another_accounts_posts_are_never_counted`
* bound the replies by the window's start -> `test_has_a_reply_reads_replies_from_the_extent`
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
from app.models_tg import Post
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

URL = f"{settings.API_V1_STR}/data/posts/window-histogram"
BULK = f"{settings.API_V1_STR}/data/posts/bulk"
MINUTE = 60_000
E0 = (int(time.time() * 1000) // MINUTE - 300 * 60) * MINUTE
EXTENT = {"extentStart": E0, "extentEnd": E0 + 10 * MINUTE, "buckets": 10}
WINDOW = {"mode": "fixed", "start": E0, "end": E0 + 2 * MINUTE}

CORPUS: list[tuple[str, int, str]] = [
    ("wh_a", E0 - 1, "early"),
    ("wh_a", E0, "first"),
    ("wh_a", E0 + MINUTE, "boundary"),
    ("wh_a", E0 + MINUTE + 30_000, "hit"),
    ("wh_a", E0 + 10 * MINUTE - 1, "last"),
    ("wh_a", E0 + 10 * MINUTE, "late"),
    ("wh_b", E0 + 5 * MINUTE, "hit"),
    ("wh_x", E0 + 2 * MINUTE, "hit"),
]


def _atom(cond: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "group",
        "id": "root",
        "op": "and",
        "children": [{"kind": "atom", "id": "c", "cond": cond}],
    }


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="pti03-pass")
        )
        user_id, email = user.id, user.email
    yield (
        user_id,
        user_authentication_headers(client=client, email=email, password="pti03-pass"),
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
    rows = [
        {"id": i, "channelName": channel, "text": text, "timestamp": ts}
        for i, (channel, ts, text) in enumerate(CORPUS, start=1)
    ]
    response = client.post(BULK, json=rows, headers=operator)
    assert response.status_code == 200, response.text
    other_id, other_headers = other
    with Session(engine) as session:
        follow_channels(session, "wh_a", "wh_b")
        follow_channels(session, "wh_b", "wh_x", user_id=other_id)
        session.commit()
    return operator, other_headers


def _counts(client: TestClient, headers: dict[str, str], **body: Any) -> list[int]:
    response = client.post(
        URL, json={**EXTENT, "window": WINDOW, **body}, headers=headers
    )
    assert response.status_code == 200, response.text
    counts: list[int] = response.json()["counts"]
    return counts


def test_the_extent_is_half_open(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """A Post on a boundary lands in exactly one bucket, the later one."""
    operator, _ = seeded
    assert _counts(client, operator, channelNames=["wh_a"], unfiltered=True) == [
        1,
        2,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
    ]


def test_unfiltered_counts_every_post_of_the_channels(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = seeded
    got = _counts(
        client,
        operator,
        channelNames=["wh_a", "wh_b"],
        keyword="hit",
        filter=_atom({"type": "channel", "value": "wh_b"}),
        unfiltered=True,
    )
    assert got == [1, 2, 0, 0, 0, 1, 0, 0, 0, 1]


def test_filtered_applies_the_filter_and_keyword(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = seeded
    both = {"channelNames": ["wh_a", "wh_b"]}
    assert _counts(client, operator, keyword="hit", **both) == [
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
    ]
    # A spotlight is a Post filter with one Channel Condition.
    spotlit = _atom({"type": "channel", "value": "wh_b"})
    assert _counts(client, operator, filter=spotlit, **both) == [0] * 5 + [1] + [0] * 4


def test_the_cap_is_ignored(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """The bars do not depend on which Post the feed's order keeps."""
    operator, _ = seeded
    got = _counts(client, operator, channelNames=["wh_a"], maxPerChannel=1)
    assert sum(got) == 4


def test_channel_posts_count_within_the_window(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """`wh_b` has a Post in the extent and none in the window, so it is out."""
    operator, _ = seeded
    busy = _atom({"type": "channel_posts", "min": 1})
    got = _counts(client, operator, channelNames=["wh_a", "wh_b"], filter=busy)
    assert got == [1, 2, 0, 0, 0, 0, 0, 0, 0, 1]


def test_another_accounts_posts_are_never_counted(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded
    # Naming a foreign Channel, and naming none, both stay inside the Follows.
    assert sum(_counts(client, operator, channelNames=["wh_x"], unfiltered=True)) == 0
    assert _counts(client, operator, unfiltered=True)[2] == 0
    assert _counts(client, other, unfiltered=True) == [0, 0, 1, 0, 0, 1, 0, 0, 0, 0]


def test_has_a_reply_reads_replies_from_the_extent(client: TestClient) -> None:
    """A parent answered before the window opens, both inside the extent, has a reply.

    The context bars reach back past the window, so the replies Has a reply
    reads must start where the extent does.
    """
    with Session(engine) as session:
        for post_id, minutes, parent in ((1, 1, None), (2, 2, 1)):
            session.add(
                Post(
                    channel_name="wh_r",
                    post_id=post_id,
                    text="r",
                    timestamp=E0 + minutes * MINUTE,
                    reply_to_post_id=parent,
                    reply_to=None if parent is None else {"channel": "wh_r"},
                )
            )
        session.commit()
        follow_channels(session, "wh_r")
        session.commit()
    answered = _atom({"type": "type", "value": "has_reply"})
    late = {"mode": "fixed", "start": E0 + 5 * MINUTE, "end": E0 + 7 * MINUTE}
    response = client.post(
        URL,
        json={**EXTENT, "window": late, "channelNames": ["wh_r"], "filter": answered},
        headers=get_superuser_token_headers(client),
    )
    assert response.status_code == 200, response.text
    assert response.json()["counts"] == [0, 1] + [0] * 8


@pytest.mark.parametrize("buckets", [0, 501])
def test_the_bucket_count_is_bounded(client: TestClient, buckets: int) -> None:
    response = client.post(
        URL,
        json={**EXTENT, "buckets": buckets},
        headers=get_superuser_token_headers(client),
    )
    assert response.status_code == 422
