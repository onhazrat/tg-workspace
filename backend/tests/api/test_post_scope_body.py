"""`POST /data/posts` and `POST /data/discover/candidates` carry scope in the body.

`/posts/counts` moved off a query string first (see
`routes/test_posts_counts_route.py`). These two siblings built the identical
`?channelNames=a,b,c,...` string from the same selection and would have failed the
same way — `/posts` is the hot Posts-feed path, so it is the one a real account
hits first.

At the ~1,070 channels a real account holds the query string runs to roughly 13 KB,
past the request-line and header limits proxies and servers enforce, so the request
fails before it is served.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models_tg import Post

POSTS_URL = f"{settings.API_V1_STR}/data/posts"
CANDIDATES_URL = f"{settings.API_V1_STR}/data/discover/candidates"


def _seed(db: Session, channel: str, post_id: int, timestamp: int) -> None:
    db.add(
        Post(
            channel_name=channel,
            post_id=post_id,
            text=f"{channel}-{post_id}",
            timestamp=timestamp,
        )
    )


def _huge_selection() -> list[str]:
    """Past the account size that motivated the change, as a query string >10 KB."""
    names = [f"channel{i:05d}" for i in range(1_200)]
    assert len(",".join(names)) > 10_000
    return names


def test_posts_accept_a_selection_far_larger_than_a_url_could_carry(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """The regression guard for the feed path."""
    names = _huge_selection()
    _seed(db, names[0], 1, 1_000)
    _seed(db, names[-1], 1, 1_100)
    db.commit()

    response = client.post(
        POSTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": names},
    )

    assert response.status_code == 200, response.text
    assert {row["channelName"] for row in response.json()} == {names[0], names[-1]}


def test_discover_candidates_accept_the_same_selection(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    names = _huge_selection()
    _seed(db, names[0], 1, 1_000)
    db.commit()

    response = client.post(
        CANDIDATES_URL,
        headers=superuser_token_headers,
        json={"channelNames": names},
    )

    assert response.status_code == 200, response.text
    assert "candidates" in response.json()


def test_posts_treat_blank_handles_as_absent(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Mirrors the old comma-split, which dropped empty segments."""
    _seed(db, "alpha", 1, 1_000)
    db.commit()

    response = client.post(
        POSTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": ["  alpha  ", "   ", ""]},
    )

    assert response.status_code == 200, response.text
    assert {row["channelName"] for row in response.json()} == {"alpha"}


def test_discover_candidates_require_a_selection(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """`channelNames` was a required query param; it stays required in the body."""
    response = client.post(CANDIDATES_URL, headers=superuser_token_headers, json={})

    assert response.status_code == 422


def test_discover_candidates_reject_an_unknown_signal(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        CANDIDATES_URL,
        headers=superuser_token_headers,
        json={"channelNames": ["alpha"], "signals": ["forward", "telepathy"]},
    )

    assert response.status_code == 422


def test_posts_reject_an_unknown_filter_value(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        POSTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": ["alpha"], "forwarded": "sideways"},
    )

    assert response.status_code == 422


def test_both_routes_require_authentication(client: TestClient) -> None:
    assert client.post(POSTS_URL, json={}).status_code in (401, 403)
    assert client.post(
        CANDIDATES_URL, json={"channelNames": ["alpha"]}
    ).status_code in (401, 403)


def test_neither_route_answers_a_get_any_more(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The long-URL shape is gone, not merely unused by our own client.

    Without this, the GET could be reintroduced and the frontend would keep
    working while the failure at scale quietly came back.
    """
    assert (
        client.get(
            POSTS_URL,
            headers=superuser_token_headers,
            params={"channelNames": "alpha"},
        ).status_code
        == 405
    )
    assert (
        client.get(
            CANDIDATES_URL,
            headers=superuser_token_headers,
            params={"channelNames": "alpha"},
        ).status_code
        == 405
    )
