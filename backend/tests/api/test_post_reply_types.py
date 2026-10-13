"""Is a reply and Has a reply (PTI-04).

Two Types. **Is a reply** keeps a Post that names a parent post id, whatever
Channel the parent is in and whether or not it is stored. **Has a reply**
keeps a Post that a Post of its own Channel answers; an answer from another
Channel leaves its parent without one. The Operator follows both Channels:

| Post   | in W | what it is                                              |
|--------|------|---------------------------------------------------------|
| rp_a 1 | yes  | original, answered by rp_a 2                            |
| rp_a 2 | yes  | reply to rp_a 1, its parent's Channel spelled `RP_A`    |
| rp_a 3 | yes  | forward, answered by rp_a 4 there                       |
| rp_a 4 | yes  | reply to rp_a 3                                         |
| rp_a 6 | yes  | answered only from rp_b (by rp_b 5)                     |
| rp_a 9 | yes  | answered by rp_a 10, after W ends                       |
| rp_a 10| no   | reply to rp_a 9                                         |
| rp_b 5 | yes  | reply to rp_a 6, across Channels                        |
| rp_b 6 | yes  | shares rp_a 6's id; nothing answers it                  |
| rp_b 7 | yes  | reply to a private parent (no Channel, id 99)           |

## Watched to fail

* match on the parent id alone, the reply in the Post's Channel -> rp_b 6 marked
* match the parent's Channel, ignoring the reply's own -> rp_a 6 marked
* compare the Channel case-sensitively -> rp_a 1 unmarked
* bound the replies by the window's end -> rp_a 9 unmarked
* drop either Type from the facets' single scan -> the Type counts
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from tests.utils.tenancy import follow_channels
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"
HOUR = 3_600_000
BASE = (int(time.time() * 1000) // HOUR - 500) * HOUR
W = {"mode": "fixed", "start": BASE, "end": BASE + 10 * HOUR}

#: (channel, id, hours after BASE, forwarded, parent id, parent's Channel)
CORPUS: list[tuple[str, int, int, bool, int | None, str | None]] = [
    ("rp_a", 1, 1, False, None, None),
    ("rp_a", 2, 2, False, 1, "RP_A"),
    ("rp_a", 3, 1, True, None, None),
    ("rp_a", 4, 3, False, 3, "rp_a"),
    ("rp_a", 6, 1, False, None, None),
    ("rp_a", 9, 5, False, None, None),
    ("rp_a", 10, 20, False, 9, "rp_a"),
    ("rp_b", 5, 2, False, 6, "rp_a"),
    ("rp_b", 6, 1, False, None, None),
    ("rp_b", 7, 2, False, 99, None),
]


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    with Session(engine) as session:
        for channel, post_id, hours, forwarded, parent, parent_channel in CORPUS:
            reply_to: dict[str, Any] | None = None
            if parent is not None:
                reply_to = {"text": "parent"}
                if parent_channel is not None:
                    reply_to["channel"] = parent_channel
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=f"post {post_id}",
                    timestamp=BASE + hours * HOUR + post_id * 1000,
                    forwarded_from="elsewhere" if forwarded else None,
                    reply_to_post_id=parent,
                    reply_to=reply_to,
                )
            )
        session.commit()
        follow_channels(session, "rp_a", "rp_b")
        session.commit()
    return get_superuser_token_headers(client)


def atom(value: str) -> dict[str, Any]:
    return {
        "kind": "atom",
        "id": value,
        "not": False,
        "cond": {"type": "type", "value": value},
    }


def group(op: str, *children: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "group",
        "id": "g",
        "op": op,
        "not": False,
        "children": list(children),
    }


def feed(
    client: TestClient, headers: dict[str, str], tree: Any
) -> list[tuple[str, int]]:
    response = client.post(
        f"{PREFIX}/posts", json={"window": W, "filter": tree}, headers=headers
    )
    assert response.status_code == 200, response.text
    return sorted((p["channelName"], p["id"]) for p in response.json())


def test_is_a_reply_whatever_the_parent(
    client: TestClient, operator: dict[str, str]
) -> None:
    """Same Channel, across Channels and a private parent are all replies."""
    assert feed(client, operator, group("and", atom("is_reply"))) == [
        ("rp_a", 2),
        ("rp_a", 4),
        ("rp_b", 5),
        ("rp_b", 7),
    ]


def test_has_a_reply_only_from_its_own_channel(
    client: TestClient, operator: dict[str, str]
) -> None:
    """rp_a 6 is answered only from rp_b, and rp_b 6 merely shares its id."""
    assert feed(client, operator, group("and", atom("has_reply"))) == [
        ("rp_a", 1),
        ("rp_a", 3),
        ("rp_a", 9),
    ]


def test_they_combine_like_every_type(
    client: TestClient, operator: dict[str, str]
) -> None:
    """OR inside the dropdown, AND across it and another Condition."""
    either = group("or", atom("is_reply"), atom("has_reply"))
    assert feed(client, operator, either) == [
        ("rp_a", 1),
        ("rp_a", 2),
        ("rp_a", 3),
        ("rp_a", 4),
        ("rp_a", 9),
        ("rp_b", 5),
        ("rp_b", 7),
    ]
    forwarded_answered = group("and", atom("forwarded"), atom("has_reply"))
    assert feed(client, operator, forwarded_answered) == [("rp_a", 3)]


def test_the_type_counts_include_both(
    client: TestClient, operator: dict[str, str]
) -> None:
    response = client.post(
        f"{PREFIX}/posts/facets", json={"window": W}, headers=operator
    )
    assert response.status_code == 200, response.text
    types = {t["value"]: t["count"] for t in response.json()["types"]}

    assert types == {
        "forwarded": 1,
        "original": 8,
        "unfollowed_forwarded": 1,
        "is_reply": 4,
        "has_reply": 3,
    }


def test_a_filtered_channel_posts_count_reads_has_a_reply(
    client: TestClient, operator: dict[str, str]
) -> None:
    """The count's own filter is Has a reply: rp_a has 3 such Posts, rp_b none."""
    bound = {"type": "channel_posts_filtered", "min": 3, "max": None}
    tree = group("and", atom("has_reply"), {**atom("x"), "cond": bound})
    assert feed(client, operator, tree) == [("rp_a", 1), ("rp_a", 3), ("rp_a", 9)]

    response = client.post(
        f"{PREFIX}/posts/value-histogram",
        json={"window": W, "measure": "channel_posts_filtered", "filter": tree},
        headers=operator,
    )
    assert response.status_code == 200, response.text
    got = response.json()
    assert (got["total"], got["edges"][0], got["edges"][32]) == (2, 0, 3)
