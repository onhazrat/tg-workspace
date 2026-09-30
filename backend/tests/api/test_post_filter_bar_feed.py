"""The filter bar's choices, end to end over HTTP, with two live accounts (PFB-02).

`POST /data/posts`, `/data/posts/counts` and `/data/posts/facets` answer for
the Language set, grouping's block placement and the per-channel cap under
each order. Two accounts read one shared corpus throughout: the Operator
follows `pfb_a` and `pfb_b`, the second account `pfb_b` and `pfb_c`. Every
answer is asserted for both, because the cap ranks, grouping places and the
facets count **over the scoped rows**, and a predicate outside the window
function would let a Post one account cannot see move what the other is shown.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, update

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import Post
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"
BASE = int(time.time() * 1000)


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        # The password is not kept on the row, so set a known one to log in.
        from app import crud
        from app.models import UserUpdate

        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="pfb02-pass")
        )
        user_id, email = user.id, user.email
    headers = user_authentication_headers(
        client=client, email=email, password="pfb02-pass"
    )
    yield user_id, headers
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


def _post(
    channel: str,
    post_id: int,
    ts: int,
    *,
    language: str | None = None,
    kinds: list[str] | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": post_id,
        "channelName": channel,
        "text": f"{channel} {post_id}",
        "timestamp": BASE + ts,
        "language": language,
    }
    if kinds:
        row["media"] = {"kinds": kinds}
    return row


def _seed(
    client: TestClient,
    operator: dict[str, str],
    other_id: uuid.UUID,
    rows: list[dict[str, Any]],
) -> None:
    """Write the corpus, set each Post's Language, and give both accounts follows.

    The Language is set after the write because the upsert reads it from the
    words and never from the payload (LANG-01); `None` leaves it unread.
    """
    response = client.post(f"{PREFIX}/posts/bulk", json=rows, headers=operator)
    assert response.status_code == 200, response.text
    with Session(engine) as session:
        for row in rows:
            session.exec(
                update(Post)
                .where(
                    col(Post.channel_name) == row["channelName"],
                    col(Post.post_id) == row["id"],
                )
                .values(language=row["language"])
            )
        session.commit()
        follow_channels(session, "pfb_a", "pfb_b")
        follow_channels(session, "pfb_b", "pfb_c", user_id=other_id)
        session.commit()


def _feed(
    client: TestClient, headers: dict[str, str], **scope: Any
) -> list[tuple[str, int]]:
    response = client.post(f"{PREFIX}/posts", json=scope, headers=headers)
    assert response.status_code == 200, response.text
    return [(row["channelName"], row["id"]) for row in response.json()]


ALL = ["pfb_a", "pfb_b", "pfb_c"]


def test_a_language_set_keeps_posts_whose_own_language_is_ticked(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
) -> None:
    """Several Languages widen; a Post with no Language read never matches."""
    other_id, other_headers = other
    _seed(
        client,
        operator,
        other_id,
        [
            _post("pfb_a", 1, 1, language="fa"),
            _post("pfb_a", 2, 2, language="en"),
            _post("pfb_a", 3, 3, language=None),
            _post("pfb_b", 4, 4, language="fa"),
            _post("pfb_b", 5, 5, language="zxx"),
            _post("pfb_c", 6, 6, language="fa"),
        ],
    )

    assert _feed(client, operator, channelNames=ALL, languages=["fa"]) == [
        ("pfb_b", 4),
        ("pfb_a", 1),
    ]
    assert _feed(client, operator, channelNames=ALL, languages=["fa", "en"]) == [
        ("pfb_b", 4),
        ("pfb_a", 2),
        ("pfb_a", 1),
    ]
    assert _feed(client, other_headers, channelNames=ALL, languages=["fa"]) == [
        ("pfb_c", 6),
        ("pfb_b", 4),
    ]
    # Unfiltered, the unread Post is there; no Language set ever claims it.
    assert ("pfb_a", 3) in _feed(client, operator, channelNames=ALL)


def test_the_counts_honour_the_language_set(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
) -> None:
    other_id, other_headers = other
    _seed(
        client,
        operator,
        other_id,
        [
            _post("pfb_a", 1, 1, language="fa"),
            _post("pfb_a", 2, 2, language="fa"),
            _post("pfb_a", 3, 3, language="en"),
            _post("pfb_b", 4, 4, language="fa"),
            _post("pfb_c", 5, 5, language="fa"),
        ],
    )

    def counts(headers: dict[str, str], **scope: Any) -> Any:
        response = client.post(
            f"{PREFIX}/posts/counts",
            json={"channelNames": ALL, **scope},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    assert counts(operator, languages=["fa"]) == {"pfb_a": 2, "pfb_b": 1}
    assert counts(operator, languages=["fa"], maxPerChannel=1) == {
        "pfb_a": 1,
        "pfb_b": 1,
    }
    assert counts(other_headers, languages=["fa"]) == {"pfb_b": 1, "pfb_c": 1}


def _seed_blocks(
    client: TestClient, operator: dict[str, str], other_id: uuid.UUID
) -> None:
    """Channels whose alphabetical order is neither block order.

    `pfb_a` holds the middle of the timeline, `pfb_b` the newest Post and
    `pfb_c` the oldest; `pfb_b` also holds an old Post, so its block is placed
    by its *best* key under the order rather than any one Post's.
    """
    _seed(
        client,
        operator,
        other_id,
        [
            _post("pfb_a", 1, 30),
            _post("pfb_a", 2, 40),
            _post("pfb_b", 3, 5),
            _post("pfb_b", 4, 90),
            _post("pfb_c", 5, 1),
            _post("pfb_c", 6, 2),
        ],
    )


@pytest.mark.parametrize(
    ("sort", "operator_rows", "other_rows"),
    [
        (
            "newest",
            [("pfb_b", 4), ("pfb_b", 3), ("pfb_a", 2), ("pfb_a", 1)],
            [("pfb_b", 4), ("pfb_b", 3), ("pfb_c", 6), ("pfb_c", 5)],
        ),
        (
            "oldest",
            [("pfb_b", 3), ("pfb_b", 4), ("pfb_a", 1), ("pfb_a", 2)],
            [("pfb_c", 5), ("pfb_c", 6), ("pfb_b", 3), ("pfb_b", 4)],
        ),
    ],
)
def test_a_channels_block_sits_where_its_first_post_falls(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
    sort: str,
    operator_rows: list[tuple[str, int]],
    other_rows: list[tuple[str, int]],
) -> None:
    """Grouping leads with each channel's best key, and keeps the order inside."""
    other_id, other_headers = other
    _seed_blocks(client, operator, other_id)
    scope = {"channelNames": ALL, "sort": sort, "groupByChannel": True}

    assert _feed(client, operator, **scope) == operator_rows
    assert _feed(client, other_headers, **scope) == other_rows

    # Paging stays stable: two-row pages concatenate to the whole.
    pages = [_feed(client, operator, **scope, limit=2, offset=o) for o in (0, 2)]
    assert pages[0] + pages[1] == operator_rows


@pytest.mark.parametrize(
    ("sort", "expected"),
    [
        ("newest", [("pfb_b", 4), ("pfb_a", 2)]),
        ("oldest", [("pfb_b", 3), ("pfb_a", 1)]),
    ],
)
def test_the_cap_keeps_the_first_n_in_the_order_before_grouping_places_it(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
    sort: str,
    expected: list[tuple[str, int]],
) -> None:
    """A capped block is placed by the Posts the cap kept, not the ones it dropped."""
    other_id, _ = other
    _seed_blocks(client, operator, other_id)

    assert (
        _feed(
            client,
            operator,
            channelNames=ALL,
            sort=sort,
            groupByChannel=True,
            maxPerChannel=1,
        )
        == expected
    )


def test_a_grouped_random_cap_pages_without_repeats(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
) -> None:
    other_id, _ = other
    _seed(
        client,
        operator,
        other_id,
        [_post(ch, i, i) for ch in ("pfb_a", "pfb_b") for i in range(8)],
    )
    scope = {
        "channelNames": ALL,
        "groupByChannel": True,
        "maxPerChannel": 5,
        "maxPerChannelMode": "random",
        "seed": 11,
    }

    whole = _feed(client, operator, **scope)
    pages = [_feed(client, operator, **scope, limit=3, offset=o) for o in (0, 3, 6, 9)]

    assert len(whole) == 10
    assert [row for page in pages for row in page] == whole


def _facets(client: TestClient, headers: dict[str, str], **scope: Any) -> Any:
    response = client.post(
        f"{PREFIX}/posts/facets", json={"channelNames": ALL, **scope}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_facets_count_each_choice_under_every_other_filter(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
) -> None:
    """What ticking one option alone would leave, cap included.

    Languages present, most frequent first, the unread left out; all six media
    kinds, in their own order. A facet ignores its own selection, so ticking a
    Language does not zero the other Languages' counts, and honours the other
    facet's, so ticking Photo narrows the Language counts.
    """
    other_id, other_headers = other
    _seed(
        client,
        operator,
        other_id,
        [
            _post("pfb_a", 1, 1, language="en", kinds=["photo"]),
            _post("pfb_a", 2, 2, language="fa", kinds=["photo"]),
            _post("pfb_a", 3, 3, language="fa"),
            _post("pfb_a", 4, 4, language=None),
            _post("pfb_b", 5, 5, language="fa", kinds=["video"]),
            _post("pfb_c", 6, 6, language="de", kinds=["photo"]),
        ],
    )

    facets = _facets(client, operator)
    assert facets["languages"] == [
        {"value": "fa", "count": 3},
        {"value": "en", "count": 1},
    ]
    media = {row["value"]: row["count"] for row in facets["media"]}
    assert [row["value"] for row in facets["media"]] == [
        "text_only",
        "media_only",
        "photo",
        "video",
        "link_preview",
        "grouped",
    ]
    assert media["photo"] == 2
    assert media["video"] == 1
    assert media["text_only"] == 2

    # Its own selection does not narrow a facet; the other one's does.
    narrowed = _facets(client, operator, languages=["en"], media=["photo"])
    assert narrowed["languages"] == [
        {"value": "en", "count": 1},
        {"value": "fa", "count": 1},
    ]
    assert {row["value"]: row["count"] for row in narrowed["media"]}["photo"] == 1

    # The cap clamps each channel's count, as the counts route does.
    capped = _facets(client, operator, maxPerChannel=1)
    assert capped["languages"] == [
        {"value": "fa", "count": 2},
        {"value": "en", "count": 1},
    ]

    # The second account's facets are about its own Follows.
    assert _facets(client, other_headers)["languages"] == [
        {"value": "de", "count": 1},
        {"value": "fa", "count": 1},
    ]


def test_a_media_set_and_oldest_first_for_each_account(
    client: TestClient,
    operator: dict[str, str],
    other: tuple[uuid.UUID, dict[str, str]],
) -> None:
    """Ticking more kinds widens; oldest first runs by timestamp ascending."""
    other_id, other_headers = other
    _seed(
        client,
        operator,
        other_id,
        [
            _post("pfb_a", 1, 1, kinds=["photo"]),
            _post("pfb_a", 2, 2),
            _post("pfb_b", 3, 3, kinds=["video"]),
            _post("pfb_c", 4, 4, kinds=["photo"]),
        ],
    )
    scope = {"channelNames": ALL, "media": ["photo", "video"], "sort": "oldest"}

    assert _feed(client, operator, **scope) == [("pfb_a", 1), ("pfb_b", 3)]
    assert _feed(client, other_headers, **scope) == [("pfb_b", 3), ("pfb_c", 4)]
