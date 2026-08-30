"""`POST /data/posts/counts` — the scope travels in the body, not the URL.

The route used to be a GET taking `?channelNames=a,b,c,...`. That worked at the
43 channels the audit observed (~700 characters) but a real account holds ~1,070,
which as a query string runs to roughly 13 KB — past the request-line and header
limits that proxies and servers enforce, so the request fails before it is served.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models_tg import Post
from tests.utils.tenancy import follow_channels

COUNTS_URL = f"{settings.API_V1_STR}/data/posts/counts"


def _seed(db: Session, channel: str, post_id: int, timestamp: int) -> None:
    # Ticket 21: `Post` is `FOLLOW_SCOPED`, so under enforcement a bare row with
    # no Channel and no Follow is invisible. The route reads as the superuser,
    # which is the operator `follow_channels` defaults to.
    follow_channels(db, channel)
    db.add(
        Post(
            channel_name=channel,
            post_id=post_id,
            text=f"{channel}-{post_id}",
            timestamp=timestamp,
        )
    )


def test_counts_returns_per_channel_totals(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    _seed(db, "alpha", 1, 1_000)
    _seed(db, "alpha", 2, 1_100)
    _seed(db, "beta", 1, 1_200)
    db.commit()

    response = client.post(
        COUNTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": ["alpha", "beta"]},
    )

    assert response.status_code == 200
    assert response.json() == {"alpha": 2, "beta": 1}


def test_counts_accept_a_selection_far_larger_than_a_url_could_carry(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """The regression guard for B5.

    1,200 handles is past the account size that motivated this change, and the
    equivalent query string would be well over 10 KB. As a body it is unremarkable.
    """
    names = [f"channel{i:05d}" for i in range(1_200)]
    _seed(db, names[0], 1, 1_000)
    _seed(db, names[-1], 1, 1_100)
    db.commit()

    assert len(",".join(names)) > 10_000

    response = client.post(
        COUNTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": names},
    )

    assert response.status_code == 200
    assert response.json() == {names[0]: 1, names[-1]: 1}


def test_counts_respect_the_date_window(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    _seed(db, "alpha", 1, 1_000)
    _seed(db, "alpha", 2, 5_000)
    db.commit()

    response = client.post(
        COUNTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": ["alpha"], "startDate": 4_000, "endDate": 6_000},
    )

    assert response.status_code == 200
    assert response.json() == {"alpha": 1}


def test_counts_treat_blank_handles_as_absent(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Mirrors the old comma-split, which dropped empty segments."""
    _seed(db, "alpha", 1, 1_000)
    db.commit()

    response = client.post(
        COUNTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": ["  alpha  ", "   ", ""]},
    )

    assert response.status_code == 200
    assert response.json() == {"alpha": 1}


def test_counts_reject_an_unknown_filter_value(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        COUNTS_URL,
        headers=superuser_token_headers,
        json={"channelNames": ["alpha"], "forwarded": "sideways"},
    )

    assert response.status_code == 422


def test_counts_require_authentication(client: TestClient) -> None:
    response = client.post(COUNTS_URL, json={"channelNames": ["alpha"]})

    assert response.status_code in (401, 403)


def test_counts_no_longer_answer_a_get(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The long-URL shape is gone, not merely unused by our own client."""
    response = client.get(
        COUNTS_URL,
        headers=superuser_token_headers,
        params={"channelNames": "alpha"},
    )

    assert response.status_code == 405
