"""POST /data/posts/chain reads a Reply chain in one request (RCH-02).

The Posts tab's chain panel used to look each parent up in turn, about 0.7 s
a level on staging. The route walks from the given Post up to the top in one
recursive query and says why it stopped. The Operator follows `rc_a` and
`rc_b`; `rc_x` is followed by nobody:

| Post    | replies to                       |
|---------|----------------------------------|
| rc_a 10 | nothing (the top)                |
| rc_a 11 | rc_a 10                          |
| rc_b 5  | rc_a 11 (`replyTo.channel`)      |
| rc_b 6  | rc_b 5 (no channel: its own)     |
| rc_a 20 | rc_a 10: an Album's first Post   |
| rc_a 21 | an Album Post, no reply of its own |
| rc_a 30 | rc_a 21                          |
| rc_x 1  | nothing                          |
| rc_b 7  | rc_x 1, which nobody follows     |
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
BASE = (int(time.time() * 1000) // HOUR - 100) * HOUR


def _post(
    channel: str,
    post_id: int,
    hour: int = 0,
    *,
    reply: int | None = None,
    reply_to: dict[str, Any] | None = None,
    album: int | None = None,
) -> Post:
    return Post(
        channel_name=channel,
        post_id=post_id,
        text=f"{channel} {post_id}",
        timestamp=BASE + hour * HOUR,
        reply_to_post_id=reply,
        reply_to=reply_to,
        album_id=album,
    )


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    with Session(engine) as session:
        session.add_all(
            [
                _post("rc_a", 10, 1),
                _post("rc_a", 11, 2, reply=10),
                _post("rc_b", 5, 3, reply=11, reply_to={"channel": "rc_a"}),
                _post("rc_b", 6, 4, reply=5, reply_to={"text": "five"}),
                _post("rc_a", 20, 5, reply=10, reply_to={"text": "ten"}, album=20),
                _post("rc_a", 21, 5, album=20),
                _post("rc_a", 30, 6, reply=21),
                _post("rc_x", 1, 1),
                _post("rc_b", 7, 7, reply=1, reply_to={"channel": "rc_x"}),
            ]
        )
        session.commit()
        follow_channels(session, "rc_a", "rc_b")
        session.commit()
    return get_superuser_token_headers(client)


def _chain(
    client: TestClient, headers: dict[str, str], channel: str, post_id: int, **body: Any
) -> dict[str, Any]:
    response = client.post(
        f"{PREFIX}/posts/chain",
        json={"channelName": channel, "postId": post_id, **body},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _refs(chain: dict[str, Any]) -> list[tuple[str, int]]:
    return [(p["channelName"], p["id"]) for p in chain["posts"]]


def test_the_chain_runs_from_the_post_to_the_top_across_channels(
    client: TestClient, operator: dict[str, str]
) -> None:
    chain = _chain(client, operator, "rc_b", 6)

    assert _refs(chain) == [("rc_b", 6), ("rc_b", 5), ("rc_a", 11), ("rc_a", 10)]
    assert chain["stop"] == "notReply"


def test_a_post_that_is_not_a_reply_is_its_own_chain(
    client: TestClient, operator: dict[str, str]
) -> None:
    chain = _chain(client, operator, "rc_a", 10)

    assert _refs(chain) == [("rc_a", 10)]
    assert chain["stop"] == "notReply"


def test_each_post_carries_its_pick_state_under_the_window_and_selection(
    client: TestClient, operator: dict[str, str]
) -> None:
    chain = _chain(
        client,
        operator,
        "rc_b",
        6,
        channelNames=["rc_a", "rc_b"],
        window={"mode": "fixed", "start": BASE, "end": BASE + 10 * HOUR},
        selection=[
            {"kind": "rule", "select": True, "filter": {"tree": None}},
            {"kind": "pick", "select": False, "channelName": "rc_a", "postId": 11},
        ],
    )

    assert {p["id"]: p["selected"] for p in chain["posts"]} == {
        6: True,
        5: True,
        11: False,
        10: True,
    }


def test_a_parent_not_stored_ends_the_chain_with_the_excerpt(
    client: TestClient, operator: dict[str, str]
) -> None:
    with Session(engine) as session:
        session.add(_post("rc_a", 40, 8, reply=39, reply_to={"text": "gone"}))
        session.commit()

    chain = _chain(client, operator, "rc_a", 40)

    assert _refs(chain) == [("rc_a", 40)]
    assert chain["stop"] == "parentNotStored"
    assert chain["posts"][-1]["replyTo"]["text"] == "gone"


def test_a_parent_in_a_channel_nobody_follows_is_not_stored_for_the_account(
    client: TestClient, operator: dict[str, str]
) -> None:
    chain = _chain(client, operator, "rc_b", 7)

    assert _refs(chain) == [("rc_b", 7)]
    assert chain["stop"] == "parentNotStored"


def test_a_post_the_account_cannot_see_answers_404(
    client: TestClient, operator: dict[str, str]
) -> None:
    for channel, post_id in (("rc_x", 1), ("rc_a", 999)):
        response = client.post(
            f"{PREFIX}/posts/chain",
            json={"channelName": channel, "postId": post_id},
            headers=operator,
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Post not found"


def test_a_reply_to_a_private_channel_stops_there(
    client: TestClient, operator: dict[str, str]
) -> None:
    with Session(engine) as session:
        # A Post of its own Channel under the same id, which is not the parent.
        session.add(_post("rc_a", 3, 0))
        session.add(
            _post(
                "rc_a",
                41,
                8,
                reply=3,
                reply_to={"url": "https://t.me/c/123/3", "text": "secret"},
            )
        )
        session.commit()

    chain = _chain(client, operator, "rc_a", 41)

    assert _refs(chain) == [("rc_a", 41)]
    assert chain["stop"] == "privateParent"


def test_the_walk_stops_at_one_hundred_posts(
    client: TestClient, operator: dict[str, str]
) -> None:
    with Session(engine) as session:
        session.add_all(
            [
                _post("rc_a", 1000 + n, 9, reply=999 + n if n else None)
                for n in range(105)
            ]
        )
        session.commit()

    chain = _chain(client, operator, "rc_a", 1104)

    assert len(chain["posts"]) == 100
    assert _refs(chain)[-1] == ("rc_a", 1005)
    assert chain["stop"] == "depthCap"


def test_a_later_album_post_climbs_through_its_albums_first_post(
    client: TestClient, operator: dict[str, str]
) -> None:
    chain = _chain(client, operator, "rc_a", 30)

    assert _refs(chain) == [("rc_a", 30), ("rc_a", 21), ("rc_a", 10)]
    assert chain["stop"] == "notReply"
    # The answered photo carries its Album's reply, as the hover preview does.
    photo = chain["posts"][1]
    assert (photo["replyToPostId"], photo["replyTo"]) == (10, {"text": "ten"})


def test_requires_auth(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/posts/chain", json={"channelName": "rc_a", "postId": 1}
    )
    assert response.status_code == 401
