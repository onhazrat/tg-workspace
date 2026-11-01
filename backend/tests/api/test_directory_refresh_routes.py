"""The Refresh settings and their projection over HTTP (DRP-01, ADR-045).

`PUT /settings/directory.deployment.refresh*` changes the target and the two
waits; a save moves every live entry's due date at once, observed through the
queue. `GET /data/directory/refresh-projection` prices values before they are
saved. The Operator holds `settings:manage`; a member holds nothing.

## Watched to fail

Each mutation was applied alone with `scripts/mutate.py` and this module went
red; the commit body lists them.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.core.request_recording import RequestKind
from app.jobs.settings import load_directory_settings
from app.models_tg import DirectoryEntry, RequestDaily, utc_now
from app.services.channel_directory import (
    dequeue_handles,
    record_probe_result,
    refresh_entries,
)
from tests.api.test_settings_registry import Account, _account

V1 = settings.API_V1_STR
PROJECTION = f"{V1}/data/directory/refresh-projection"
DAY = timedelta(days=1)


@pytest.fixture
def member(client: TestClient) -> Iterator[Account]:
    yield from _account(client)


@pytest.fixture
def operator(client: TestClient) -> Iterator[Account]:
    from app.core.permissions import ROLE_OWNER

    yield from _account(client, role=ROLE_OWNER)


def _put(client: TestClient, headers: dict[str, str], name: str, value: int) -> Any:
    return client.put(
        f"{V1}/settings/directory.deployment.{name}",
        headers=headers,
        json={"value": value},
    )


def _steady(session: Session, handle: str) -> None:
    """Twenty Posts a day apart, the newest today: about one a day."""
    newest = utc_now()
    samples = []
    for i in range(20):
        at = newest - i * DAY
        samples.append(
            {
                "id": 100 - i,
                "text": "post",
                "date": at.isoformat(),
                "timestamp": int(at.replace(tzinfo=UTC).timestamp() * 1000),
                "channelName": handle,
            }
        )
    record_probe_result(
        session, handle, {"isTelegramPage": True, "kind": "channel", "samples": samples}
    )


def test_saving_the_target_moves_due_dates_now(
    client: TestClient, operator: Account
) -> None:
    with Session(engine) as session:
        _steady(session, "steady")
        _steady(session, "asked")
        refresh_entries(session, ["asked"])
        in_five_days = utc_now() + DAY * 5
        assert dequeue_handles(session, limit=10, now=in_five_days) == ["asked"]

    response = _put(client, operator[1], "refreshTarget", 2)
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        # Two Posts of a one-a-day Channel is two days, clamped to the 4-day
        # minimum: due inside five days now, where it was nineteen before.
        assert dequeue_handles(session, limit=10, now=in_five_days) == [
            "asked",
            "steady",
        ]
        asked = session.get(DirectoryEntry, "asked")
        assert asked is not None and asked.refresh_due_at is not None
        assert asked.refresh_due_at <= utc_now(), "an on-demand Refresh stays due"


def test_a_shortest_wait_above_the_longest_is_refused(
    client: TestClient, operator: Account
) -> None:
    _put(client, operator[1], "refreshMaxDays", 10)
    response = _put(client, operator[1], "refreshMinDays", 11)
    assert response.status_code == 422
    assert "shortest wait" in response.json()["detail"]
    with Session(engine) as session:
        stored = load_directory_settings(session)
        assert stored["directoryRefreshMinDays"] == 4
        assert stored["directoryRefreshMaxDays"] == 10


def test_a_member_cannot_see_or_change_the_refresh_settings(
    client: TestClient, member: Account
) -> None:
    assert _put(client, member[1], "refreshTarget", 5).status_code == 404
    response = client.get(
        PROJECTION,
        headers=member[1],
        params={"target": 20, "minDays": 4, "maxDays": 120},
    )
    assert response.status_code == 403


def test_the_projection_prices_values_beside_measured_probing(
    client: TestClient, operator: Account
) -> None:
    with Session(engine) as session:
        _steady(session, "steady")
        record_probe_result(
            session, "quiet", {"isTelegramPage": True, "kind": "channel"}
        )
        record_probe_result(session, "a_bot", {"isTelegramPage": True, "kind": "bot"})
        today = utc_now().date()
        for days_ago, requests in ((1, 700), (7, 700), (8, 99_999), (0, 99_999)):
            session.add(
                RequestDaily(
                    day=today - timedelta(days=days_ago),
                    kind=RequestKind.PROBE.value,
                    outcome="ok",
                    page_type="channel",
                    charged=False,
                    requests=requests,
                    new_posts=0,
                    repeated_posts=0,
                )
            )
        session.commit()
        steady = session.get(DirectoryEntry, "steady")
        assert steady is not None and steady.posts_per_week is not None
        steady_wait = 7 * 2 / steady.posts_per_week

    response = client.get(
        PROJECTION,
        headers=operator[1],
        params={"target": 2, "minDays": 1, "maxDays": 30},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # The steady Channel every `steady_wait` days, the quiet one (no rate)
    # every 30; the bot never.
    assert body["refreshesPerDay"] == pytest.approx(1 / steady_wait + 1 / 30)
    assert body["atMin"] == 0
    assert body["atMax"] == 1
    # Days 1 to 7 only: today is not over, and day 8 is out of the week.
    assert body["measuredPerDay"] == pytest.approx(1400 / 7)


def test_the_projection_refuses_a_shortest_wait_above_the_longest(
    client: TestClient, operator: Account
) -> None:
    response = client.get(
        PROJECTION,
        headers=operator[1],
        params={"target": 20, "minDays": 9, "maxDays": 8},
    )
    assert response.status_code == 422


def test_the_section_route_refuses_a_policy_out_of_bounds(
    client: TestClient, operator: Account
) -> None:
    """`PUT /data/settings/directory` bounds nothing on its own, unlike the
    Settings page's declarations. A longest wait of 0 once meant "never
    refresh", and storing it now would null every due date."""
    section = f"{V1}/data/settings/directory"
    for body in (
        {"directoryRefreshMaxDays": 0},
        {"directoryRefreshMinDays": 0},
        {"directoryRefreshTarget": 0},
        {"directoryRefreshTarget": 1001},
        {"directoryRefreshMinDays": 200},
    ):
        response = client.put(section, headers=operator[1], json=body)
        assert response.status_code == 422, body
    with Session(engine) as session:
        assert load_directory_settings(session)["directoryRefreshMaxDays"] == 120
