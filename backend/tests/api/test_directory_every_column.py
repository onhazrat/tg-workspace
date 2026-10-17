"""Sorting and filtering the Directory on every column (DPF).

The Operator (the superuser) holds `DATA_ADMIN` and sees every kind of entry;
the other Account holds nothing and sees Channels only, and may neither sort
nor filter by a column it cannot see.

| entry       | kind    | status      | samples | checked   | refresh due | last error    |
|-------------|---------|-------------|---------|-----------|-------------|---------------|
| ec_alpha    | channel | ok          | 10      | 3 days ago| in 1 day    |               |
| ec_beta     | channel | ok          | 3       | 1 day ago | in 5 days   | proxy timeout |
| ec_gone     | channel | unavailable |         | 10 days   |             |               |
| ec_bot      | bot     | unavailable |         | 10 days   |             |               |
| ec_pending  | unknown | unknown     |         |           |             |               |

## Watched to fail

Each mutation was applied alone and this module went red:

* list every kind for every caller -> the Channels-only case
* skip the internal refusal on a Condition -> the refusal case
* make a Time bound's end inclusive -> the half-open case
* resolve a Live end against zero rather than now -> the Live case
* sort a moment by its epoch-ms expression -> the raw-column case
* add or drop a key in either `INTERNAL_COLUMNS` -> the browser-set case
"""

from __future__ import annotations

import importlib
import re
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlmodel import Session, col, delete

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models import User, UserUpdate
from app.models_tg import DirectoryEntry, utc_now
from app.services import directory_reads
from app.services.channel_directory import enqueue_handles, record_probe_result
from app.services.settings_registry import DIRECTORY_COLUMNS_KEY
from app.services.settings_store import get_global_setting
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

DIRECTORY = f"{settings.API_V1_STR}/data/directory"
DAY_MS = 86_400_000
CHANNELS = ["ec_alpha", "ec_beta", "ec_gone"]
EVERY_KIND = sorted([*CHANNELS, "ec_bot", "ec_pending"])

FRONTEND_COLUMNS = (
    Path(__file__).resolve().parents[3]
    / "frontend/src/lib/directory/directory-columns.ts"
)

# Whole seconds, so a bound at exactly a seeded moment lands on it.
_NOW = utc_now().replace(microsecond=0)


def _ms(days: float) -> int:
    moment = _NOW + timedelta(days=days)
    return directory_reads._epoch_ms(moment)


def _seed() -> None:
    with Session(engine) as session:
        for handle in ("ec_alpha", "ec_beta"):
            record_probe_result(
                session, handle, {"isTelegramPage": True, "kind": "channel"}
            )
        record_probe_result(
            session,
            "ec_gone",
            {"isTelegramPage": True, "kind": "channel", "isUnavailableOnWebView": True},
        )
        record_probe_result(
            session,
            "ec_bot",
            {"isTelegramPage": True, "kind": "bot", "isUnavailableOnWebView": True},
        )
        enqueue_handles(session, ["ec_pending"])
        for handle, samples, checked, due, error, language in (
            ("ec_alpha", 10, -3, 1, None, "fa"),
            ("ec_beta", 3, -1, 5, "Proxy TIMEOUT on p3", "en"),
        ):
            row = session.get(DirectoryEntry, handle)
            assert row is not None
            row.sample_count = samples
            row.checked_at = _NOW + timedelta(days=checked)
            row.refresh_due_at = _NOW + timedelta(days=due)
            row.last_error = error
            row.language = language
            session.add(row)
        for handle in ("ec_gone", "ec_bot"):
            row = session.get(DirectoryEntry, handle)
            assert row is not None
            row.checked_at = _NOW - timedelta(days=10)
            session.add(row)
        session.commit()


@pytest.fixture
def accounts(client: TestClient) -> Iterator[tuple[dict[str, str], dict[str, str]]]:
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="dpf-pass")
        )
        other_id, email = user.id, user.email
    _seed()
    other = user_authentication_headers(client=client, email=email, password="dpf-pass")
    yield get_superuser_token_headers(client), other
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == other_id))
        session.commit()


def _where(*conds: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "group",
        "op": "and",
        "children": [{"kind": "atom", "cond": c} for c in conds],
    }


def _list(client: TestClient, headers: dict[str, str], **body: Any) -> list[str] | int:
    response = client.post(
        f"{DIRECTORY}/list", json={"columns": [], **body}, headers=headers
    )
    if response.status_code != 200:
        return response.status_code
    return [row["handle"] for row in response.json()["rows"]]


# ---- Who sees what -------------------------------------------------------------


def test_the_operator_sees_every_kind_and_others_see_channels(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    assert sorted(_list(client, operator, sort="subscribers")) == EVERY_KIND  # type: ignore[arg-type]
    assert sorted(_list(client, other, sort="subscribers")) == CHANNELS  # type: ignore[arg-type]
    size = {
        who: client.get(f"{DIRECTORY}/size", headers=h).json()["size"]
        for who, h in (("operator", operator), ("other", other))
    }
    assert size == {"operator": 5, "other": 3}
    count = client.post(f"{DIRECTORY}/count", json={}, headers=operator).json()
    assert count == {"total": 5}


def test_the_operator_opens_any_entry_and_others_only_channels(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    mine = client.get(f"{DIRECTORY}/ec_bot/entry", headers=operator)
    assert mine.status_code == 200
    assert mine.json()["priorityBoost"] == 0
    assert mine.json()["kind"] == "bot"
    assert client.get(f"{DIRECTORY}/ec_bot/entry", headers=other).status_code == 404
    theirs = client.get(f"{DIRECTORY}/ec_alpha/entry", headers=other).json()
    assert "priorityBoost" not in theirs


# ---- The new Conditions --------------------------------------------------------


@pytest.mark.parametrize(
    ("cond", "expected"),
    [
        (
            {"type": "is", "field": "status", "value": "unavailable"},
            ["ec_bot", "ec_gone"],
        ),
        ({"type": "is", "field": "kind", "value": "unknown"}, ["ec_pending"]),
        (
            {"type": "contains", "field": "last_error", "value": "timeout"},
            ["ec_beta"],
        ),
        ({"type": "measure", "measure": "sample_count", "min": 5}, ["ec_alpha"]),
        (
            {"type": "measure", "measure": "priority_boost", "min": 0, "max": 0},
            EVERY_KIND,
        ),
        # Fixed, end open: checked within the last two days.
        (
            {"type": "time", "moment": "checked_at", "mode": "fixed", "start": _ms(-2)},
            ["ec_beta"],
        ),
        # Live, end ahead: due within the next two days.
        (
            {
                "type": "time",
                "moment": "refresh_due_at",
                "mode": "live",
                "start": 0,
                "end": 2 * DAY_MS,
            },
            ["ec_alpha"],
        ),
        # Live, start open, end back: checked more than two days ago.
        (
            {
                "type": "time",
                "moment": "checked_at",
                "mode": "live",
                "end": -2 * DAY_MS,
            },
            ["ec_alpha", "ec_bot", "ec_gone"],
        ),
        (
            {"type": "time", "moment": "checked_at", "mode": "fixed", "none": True},
            ["ec_pending"],
        ),
    ],
)
def test_every_new_condition_narrows(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    cond: dict[str, Any],
    expected: list[str],
) -> None:
    operator, _ = accounts
    got = _list(client, operator, sort="subscribers", filter=_where(cond))
    assert sorted(got) == expected  # type: ignore[arg-type]


def test_a_time_bound_includes_its_start_and_excludes_its_end(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    beta = _ms(-1)
    at = {"type": "time", "moment": "checked_at", "mode": "fixed"}
    assert _list(client, operator, filter=_where({**at, "start": beta})) == ["ec_beta"]
    assert _list(
        client, operator, filter=_where({**at, "start": _ms(-5), "end": beta})
    ) == ["ec_alpha"]


# ---- Sorting -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sort", "descending", "expected"),
    [
        ("sample_count", True, ["ec_alpha", "ec_beta"]),
        ("checked_at", False, ["ec_bot", "ec_gone", "ec_alpha", "ec_beta"]),
        ("refresh_due_at", True, ["ec_beta", "ec_alpha"]),
        ("language", False, ["ec_beta", "ec_alpha"]),
        ("last_error", False, ["ec_beta"]),
        ("status", True, ["ec_pending", "ec_bot", "ec_gone"]),
        ("kind", False, ["ec_bot", "ec_alpha", "ec_beta", "ec_gone", "ec_pending"]),
        ("followable", True, ["ec_alpha", "ec_beta"]),
    ],
)
def test_the_new_sorts_order_the_list(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    sort: str,
    descending: bool,
    expected: list[str],
) -> None:
    """Only the leading rows are asserted: no value sorts last, ties fall to the handle."""
    operator, _ = accounts
    got = _list(client, operator, sort=sort, descending=descending)
    assert got[: len(expected)] == expected  # type: ignore[index]


@pytest.fixture
def captured_sql() -> Iterator[list[str]]:
    statements: list[str] = []

    def before_cursor_execute(*args: Any) -> None:
        statements.append(str(args[2]))

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


@pytest.mark.parametrize("moment", directory_reads.DIRECTORY_MOMENTS)
def test_a_moment_sorts_by_its_column_not_its_epoch(
    client: TestClient,
    accounts: tuple[dict[str, str], dict[str, str]],
    captured_sql: list[str],
    moment: str,
) -> None:
    """The same order, about 100 ms cheaper a page on staging's 1.06M entries,
    because the epoch expression is computed for every row the sort reads."""
    operator, _ = accounts
    assert isinstance(_list(client, operator, sort=moment), list)
    [page] = [s for s in captured_sql if "LIMIT" in s and "ORDER BY" in s]
    order = page.split("ORDER BY", 1)[1]
    assert order.lstrip().startswith(f"tg_channel_directory.{moment} DESC NULLS LAST")
    assert "EXTRACT" not in order


def test_effective_priority_sorts_in_drain_order(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    client.post(
        f"{DIRECTORY}/boost",
        json={"handles": ["ec_beta"], "mode": "set", "value": 5},
        headers=operator,
    )
    got = _list(
        client,
        operator,
        sort="effective_priority",
        descending=False,
        filter=_where({"type": "is", "field": "status", "value": "ok"}),
    )
    assert got == ["ec_beta", "ec_alpha"]


def test_every_catalogue_column_is_a_sort(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    catalogue = client.get(f"{DIRECTORY}/columns", headers=operator).json()
    for column in (c["key"] for c in catalogue):
        for descending in (True, False):
            got = _list(client, operator, sort=column, descending=descending)
            assert isinstance(got, list), (column, got)


# ---- What a caller may not read ------------------------------------------------


def test_an_internal_sort_or_condition_is_refused_to_a_non_holder(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = accounts
    error = _where({"type": "contains", "field": "last_error", "value": "x"})
    retry = _where(
        {"type": "time", "moment": "retry_after", "mode": "fixed", "none": True}
    )
    for body in (
        {"sort": "attempts"},
        {"sort": "effective_priority"},
        {"filter": error},
        {"filter": retry},
        {"filter": _where({"type": "is", "field": "kind", "value": "bot"})},
    ):
        assert _list(client, other, **body) == 422, body
        assert isinstance(_list(client, operator, **body), list), body
    for path, body in (
        ("count", {"filter": error}),
        (
            "count",
            {
                "candidate": {
                    "kind": "atom",
                    "cond": {"type": "measure", "measure": "priority"},
                }
            },
        ),
        ("distribution", {"measure": "attempts"}),
    ):
        refused = client.post(f"{DIRECTORY}/{path}", json=body, headers=other)
        assert refused.status_code == 422, (path, body)
        allowed = client.post(f"{DIRECTORY}/{path}", json=body, headers=operator)
        assert allowed.status_code == 200, (path, body)


def _browser_internal_columns() -> set[str]:
    source = FRONTEND_COLUMNS.read_text()
    block = re.search(
        r"export const INTERNAL_COLUMNS\b.*?\(\[(.*?)\]\)", source, re.DOTALL
    )
    assert block, f"INTERNAL_COLUMNS not found in {FRONTEND_COLUMNS}"
    return set(re.findall(r'"(\w+)"', block.group(1)))


def test_the_browser_hides_exactly_the_columns_the_server_refuses() -> None:
    """Both directions, because each drift fails differently. A key only the
    server holds is a sort and a Condition the browser offers every reader and
    the server answers with a 422. A key only the browser holds hides a column
    a reader is entitled to, so nothing fails at all and nobody notices.

    The browser's set is one constant every gate reads (the sort picker, the
    condition picker, `seesInternals`), so this one comparison covers all of
    them."""
    assert _browser_internal_columns() == directory_reads.INTERNAL_COLUMNS


def test_a_moment_has_a_linear_distribution_in_epoch_ms(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    spread = client.post(
        f"{DIRECTORY}/distribution", json={"measure": "checked_at"}, headers=operator
    ).json()
    assert spread["scale"] == "linear"
    assert spread["min"] == pytest.approx(_ms(-10), abs=1000)
    assert spread["max"] == pytest.approx(_ms(-1), abs=1000)
    assert spread["noValue"] == 1
    assert sum(b["count"] for b in spread["bins"]) == 4


def test_a_condition_the_server_cannot_answer_is_422_not_500(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    for cond in (
        # Past what a datetime holds, so it would overflow rather than match.
        {"type": "time", "moment": "checked_at", "mode": "fixed", "start": 10**16},
        {"type": "time", "moment": "checked_at", "mode": "fixed", "end": -(10**16)},
        # A value the Directory never writes would match nothing, silently.
        {"type": "is", "field": "kind", "value": "robot"},
        {"type": "is", "field": "status", "value": "fine"},
    ):
        assert _list(client, operator, filter=_where(cond)) == 422, cond


# ---- The renamed keys ----------------------------------------------------------


def test_the_old_day_keys_are_gone(
    client: TestClient, accounts: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _ = accounts
    assert _list(client, operator, sort="last_post_days") == 422
    assert _list(client, operator, columns=["found_days"]) == 422
    old = _where({"type": "measure", "measure": "found_days", "min": 1})
    assert _list(client, operator, filter=old) == 422


def test_the_migration_renames_the_stored_defaults() -> None:
    migration = importlib.import_module(
        "app.alembic.versions.c4e8a1f6d2b9_directory_priority_boost"
    )
    with Session(engine) as session:
        session.execute(
            text(
                "INSERT INTO tg_app_settings (key, value, updated_at) "
                "VALUES (:k, CAST(:v AS json), now())"
            ),
            {
                "k": DIRECTORY_COLUMNS_KEY,
                "v": '{"on": ["last_post_days", "found_days", "photos"]}',
            },
        )
        original, migration.op = migration.op, SimpleNamespace(execute=session.execute)
        try:
            migration._rename_defaults(migration._RENAMES)
        finally:
            migration.op = original
        session.commit()
        assert get_global_setting(session, DIRECTORY_COLUMNS_KEY) == {
            "on": ["last_post_at", "created_at", "photos"]
        }
