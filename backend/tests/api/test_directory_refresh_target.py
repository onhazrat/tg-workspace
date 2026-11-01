"""Setting a Refresh target on Directory entries over HTTP (DRP-02, ADR-045).

`POST /data/directory/refresh-target` sets or clears the target of the named
entries, and their due dates move at once, still clamped by the deployment's
shortest and longest waits. The Operator (the superuser) holds `DATA_ADMIN`;
the other Account holds nothing. A view's matches are covered beside the
boost's in `test_directory_tick_all.py`.

## Watched to fail

Each mutation was applied alone with `scripts/mutate.py` and this module went
red; the commit body lists them.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import DirectoryEntry
from app.services import directory_reads
from app.services.channel_directory import record_probe_result, refresh_entries
from tests.api.test_directory_refresh_routes import _steady
from tests.api.test_settings_registry import Account, _account
from tests.utils.utils import get_superuser_token_headers

V1 = settings.API_V1_STR
TARGET = f"{V1}/data/directory/refresh-target"
DAY = timedelta(days=1)


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    with Session(engine) as session:
        # Twenty Posts a day apart: about one a day, so the deployment's 20
        # waits about nineteen days.
        _steady(session, "rt_one")
        _steady(session, "rt_two")
    return get_superuser_token_headers(client)


@pytest.fixture
def member(client: TestClient) -> Iterator[Account]:
    yield from _account(client)


def _entry(handle: str) -> DirectoryEntry:
    with Session(engine) as session:
        row = session.get(DirectoryEntry, handle)
        assert row is not None
        return row


def _wait(handle: str) -> timedelta:
    row = _entry(handle)
    assert row.refresh_due_at is not None and row.checked_at is not None
    return row.refresh_due_at - row.checked_at


def _due() -> dict[str, datetime | None]:
    return {h: _entry(h).refresh_due_at for h in ("rt_one", "rt_two")}


def test_a_target_moves_only_its_entry_and_is_still_clamped(
    client: TestClient, operator: dict[str, str]
) -> None:
    assert 18 * DAY < _wait("rt_two") < 20 * DAY
    with Session(engine) as session:
        # Off the policy, so a write that recomputed every entry would move it.
        row = session.get(DirectoryEntry, "rt_two")
        assert row is not None and row.checked_at is not None
        row.refresh_due_at = row.checked_at + 50 * DAY
        session.add(row)
        session.commit()
    before = _wait("rt_two")

    r = client.post(
        TARGET,
        json={"handles": ["rt_one", "nobody"], "value": 1000},
        headers=operator,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"changed": 1}
    assert _entry("rt_one").refresh_target == 1000
    assert _wait("rt_one") == 120 * DAY, "the longest wait still binds"
    assert _wait("rt_two") == before

    client.post(TARGET, json={"handles": ["rt_one"], "value": 1}, headers=operator)
    assert _wait("rt_one") == 4 * DAY, "the shortest wait still binds"

    client.post(TARGET, json={"handles": ["rt_one"], "value": 40}, headers=operator)
    assert 37 * DAY < _wait("rt_one") < 39 * DAY


def test_clearing_follows_the_deployment_again(
    client: TestClient, operator: dict[str, str]
) -> None:
    before = _wait("rt_one")
    client.post(TARGET, json={"handles": ["rt_one"], "value": 40}, headers=operator)
    r = client.post(
        TARGET, json={"handles": ["@RT_ONE"], "value": None}, headers=operator
    )
    assert r.status_code == 200, r.text
    assert _entry("rt_one").refresh_target is None
    assert abs(_wait("rt_one") - before) < timedelta(seconds=1)


def test_an_on_demand_refresh_stays_due_and_a_dead_entry_never_comes_due(
    client: TestClient, operator: dict[str, str]
) -> None:
    with Session(engine) as session:
        refresh_entries(session, ["rt_one"])
        record_probe_result(session, "rt_bot", {"isTelegramPage": True, "kind": "bot"})
    asked = _entry("rt_one").refresh_due_at

    r = client.post(
        TARGET,
        json={"handles": ["rt_one", "rt_bot"], "value": 1000},
        headers=operator,
    )
    assert r.json() == {"changed": 2}
    assert _entry("rt_one").refresh_due_at == asked
    bot = _entry("rt_bot")
    assert bot.refresh_target == 1000
    assert bot.refresh_due_at is None


def test_an_account_without_the_permission_is_refused(
    client: TestClient, operator: dict[str, str], member: Account
) -> None:
    before = _due()
    r = client.post(TARGET, json={"handles": ["rt_one"], "value": 5}, headers=member[1])
    assert r.status_code == 403
    assert _entry("rt_one").refresh_target is None
    assert _due() == before


@pytest.mark.parametrize(
    "body",
    [
        {"handles": ["rt_one"], "value": 0},
        {"handles": ["rt_one"], "value": 1001},
        {"handles": [], "value": 5},
        {"handles": ["rt_one"]},
    ],
)
def test_a_bad_request_is_422_and_changes_nothing(
    client: TestClient, operator: dict[str, str], body: dict[str, object]
) -> None:
    before = _due()
    r = client.post(TARGET, json=body, headers=operator)
    assert r.status_code == 422, r.text
    assert _entry("rt_one").refresh_target is None
    assert _due() == before


def test_the_reads_show_the_override_and_the_due_date(
    client: TestClient, operator: dict[str, str]
) -> None:
    client.post(TARGET, json={"handles": ["rt_one"], "value": 40}, headers=operator)
    due_ms = {h: d and directory_reads._epoch_ms(d) for h, d in _due().items()}

    listed = client.post(
        f"{V1}/data/directory/list",
        json={
            "columns": ["refresh_target", "refresh_due_at"],
            "sort": "refresh_target",
        },
        headers=operator,
    )
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["refreshTarget"] == 20, "the deployment's, for the greyed cell"
    rows = {r["handle"]: r for r in body["rows"]}
    assert [r["handle"] for r in body["rows"]][0] == "rt_one", "overrides sort first"
    assert rows["rt_one"]["refreshTarget"] == 40
    assert rows["rt_two"]["refreshTarget"] is None
    assert rows["rt_one"]["refreshDueAt"] == due_ms["rt_one"]

    detail = client.get(f"{V1}/data/directory/rt_one/entry", headers=operator)
    assert detail.status_code == 200, detail.text
    assert detail.json()["refreshTarget"] == 40
    assert detail.json()["refreshDueAt"] == due_ms["rt_one"]


def test_a_view_filtered_on_the_target_moves_every_due_date_it_matched(
    client: TestClient, operator: dict[str, str]
) -> None:
    client.post(TARGET, json={"handles": ["rt_one"], "value": 40}, headers=operator)
    at_least_30 = {
        "kind": "group",
        "id": "root",
        "op": "and",
        "children": [
            {
                "kind": "atom",
                "id": "x",
                "cond": {"type": "measure", "measure": "refresh_target", "min": 30},
            }
        ],
    }
    r = client.post(
        TARGET, json={"view": {"filter": at_least_30}, "value": 10}, headers=operator
    )
    assert r.json() == {"changed": 1}
    # The write takes the entry out of its own view; its due date moves anyway.
    assert _entry("rt_one").refresh_target == 10
    assert 8 * DAY < _wait("rt_one") < 11 * DAY
