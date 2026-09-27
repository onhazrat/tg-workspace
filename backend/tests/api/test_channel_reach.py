"""A followed Channel's Reach on the stats reads (REACH-03, ADR-024).

Reach rides `GET /channels/stats` (the list) and `GET /channels/{id}/stats` (the
detail) rather than the grid's own list: it is a Post aggregate like the other
four, and the grid paints without those on purpose.

The corpus case is the ticket's: Posts carry no owner, so what it pins is that
Reach is read by Channel name and not through anybody's Follow, including an
Account that followed after the Posts arrived.

## Watched to fail

* answer every Channel not measured -> the corpus case
* compute Reach per Channel in the list rather than in one query -> the list
  and the detail still agree, so only the query-count case catches it
* ignore the sample size setting -> the narrowing case
* validate a `reach` PUT against the body alone -> a lone settling age below
  the stored floor is written
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

PREFIX = f"{settings.API_V1_STR}/data"
HOUR_MS = 3_600_000
T0 = 1_760_000_000_000


def _seed_posts(channel: str, rows: list[tuple[int | None, int]]) -> None:
    """`(views, hours between publication and observation)` per Post."""
    with Session(engine) as session:
        for i, (views, age_hours) in enumerate(rows, start=1):
            timestamp = T0 + i * 60_000
            session.add(
                Post(
                    channel_name=channel,
                    post_id=i,
                    text=f"p{i}",
                    timestamp=timestamp,
                    views_count=views,
                    views_observed_at=timestamp + age_hours * HOUR_MS,
                )
            )
        session.commit()


@pytest.fixture
def shared_channel() -> Iterator[str]:
    """Followed by a second Account first, whose sync brought the Posts in,
    then by the superuser the tests read as."""
    with Session(engine) as session:
        other = create_random_user(session)
        add_test_channel(session, "reach-shared", user_id=other.id)
        add_test_channel(session, "reach-shared")
    _seed_posts("reach-shared", [(100, 48), (200, 30), (300, 25), (400, 72), (500, 24)])
    yield "reach-shared"


def test_reach_comes_from_the_corpus(
    client: TestClient, superuser_token_headers: dict[str, str], shared_channel: str
) -> None:
    listed = client.get(f"{PREFIX}/channels/stats", headers=superuser_token_headers)
    detail = client.get(
        f"{PREFIX}/channels/{shared_channel}/stats", headers=superuser_token_headers
    )

    assert listed.json()[shared_channel]["reach"] == 300
    assert listed.json()[shared_channel]["reachEstimated"] is False
    assert detail.json()["reach"] == 300
    assert detail.json()["reachEstimated"] is False


def test_young_counts_answer_an_estimate(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    add_test_channel_and_posts("reach-young", [(89, 12)] * 5)

    body = client.get(
        f"{PREFIX}/channels/reach-young/stats", headers=superuser_token_headers
    ).json()

    assert body["reach"] == 92  # 89 / (0.86 / 0.89)
    assert body["reachEstimated"] is True


def test_no_view_counts_is_not_measured_rather_than_zero(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    add_test_channel_and_posts("reach-blank", [(None, 48)] * 6 + [(100, 48)])

    body = client.get(
        f"{PREFIX}/channels/stats", headers=superuser_token_headers
    ).json()["reach-blank"]

    assert body["reach"] is None
    assert body["reachEstimated"] is False


def test_the_list_reads_reach_in_one_query(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    for name in ("reach-q1", "reach-q2", "reach-q3"):
        add_test_channel_and_posts(name, [(10, 48)] * 5)
    statements: list[str] = []

    def record(*args: object) -> None:
        statements.append(str(args[2]))

    event.listen(engine, "before_cursor_execute", record)
    try:
        client.get(f"{PREFIX}/channels/stats", headers=superuser_token_headers)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert sum("views_observed_at" in sql for sql in statements) == 1


def test_the_sample_size_setting_narrows_the_read(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The newest five are Settled at 10 views, older ones at 1000."""
    add_test_channel_and_posts("reach-narrow", [(1000, 48)] * 6 + [(10, 48)] * 5)
    url = f"{PREFIX}/channels/reach-narrow/stats"

    wide = client.get(url, headers=superuser_token_headers).json()["reach"]
    client.put(
        f"{PREFIX}/settings/reach",
        json={"reachSampleSize": 5},
        headers=superuser_token_headers,
    )
    narrow = client.get(url, headers=superuser_token_headers).json()["reach"]

    assert (wide, narrow) == (1000, 10)


def test_a_contradictory_setting_is_refused_with_its_reason(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    ok = client.put(
        f"{PREFIX}/settings/reach",
        json={"estimationFloorHours": 10},
        headers=superuser_token_headers,
    )
    refused = client.put(
        f"{PREFIX}/settings/reach",
        json={"settlingAgeHours": 8},
        headers=superuser_token_headers,
    )
    stored = client.get(f"{PREFIX}/settings/reach", headers=superuser_token_headers)

    assert ok.status_code == 200
    assert refused.status_code == 422
    assert "below the settling age" in refused.json()["detail"]
    assert stored.json()["value"] == {
        "settlingAgeHours": 24,
        "estimationFloorHours": 10,
        "reachSampleSize": 100,
    }


def add_test_channel_and_posts(name: str, rows: list[tuple[int | None, int]]) -> None:
    with Session(engine) as session:
        add_test_channel(session, name)
    _seed_posts(name, rows)
