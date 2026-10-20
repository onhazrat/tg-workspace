"""The Logs tab's Time bound, applied by the server before paging (TB-05).

The browser used to filter by date over the newest page it had fetched, so
"logged in the last 30 days" silently missed anything older than that page.
The bound is now `[start, end)` in SQL, either end open, a Live end relative
to the server's current minute, ahead of the offset and the limit.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = f"{settings.API_V1_STR}/data"
MINUTE = 60_000
#: 2021-01-01T00:00:00Z, far behind any page of newer rows.
T0 = 1_609_459_200_000


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed(client: TestClient, headers: dict[str, str], stamps: dict[str, int]) -> None:
    r = client.post(
        f"{PREFIX}/logs/embedding",
        json=[
            {"id": i, "textCount": 1, "status": "success", "timestamp": ts}
            for i, ts in stamps.items()
        ],
        headers=headers,
    )
    assert r.status_code == 200, r.text


def _ids(client: TestClient, headers: dict[str, str], query: str) -> list[str]:
    r = client.get(f"{PREFIX}/logs/embedding?{query}", headers=headers)
    assert r.status_code == 200, r.text
    return [row["id"] for row in r.json()]


def _old_and_new(client: TestClient) -> dict[str, str]:
    """Ten old rows a minute apart, and a page's worth of newer ones above them."""
    headers = _auth(client)
    _seed(client, headers, {f"old-{i}": T0 + i * MINUTE for i in range(10)})
    now = int(time.time() * 1000)
    _seed(client, headers, {f"new-{i}": now - i * 1000 for i in range(5)})
    return headers


def test_a_fixed_bound_reaches_entries_older_than_the_first_page(
    client: TestClient,
) -> None:
    headers = _old_and_new(client)
    start, end = T0 + 2 * MINUTE, T0 + 5 * MINUTE
    # Start included, end excluded, and the page of five newer rows skipped.
    assert _ids(client, headers, f"mode=fixed&start={start}&end={end}&limit=3") == [
        "old-4",
        "old-3",
        "old-2",
    ]


def test_each_end_may_be_open(client: TestClient) -> None:
    headers = _old_and_new(client)
    assert _ids(client, headers, f"mode=fixed&end={T0 + 2 * MINUTE}") == [
        "old-1",
        "old-0",
    ]
    assert _ids(client, headers, f"mode=fixed&start={T0 + 8 * MINUTE}")[-2:] == [
        "old-9",
        "old-8",
    ]
    assert len(_ids(client, headers, f"mode=fixed&start={T0 + 8 * MINUTE}")) == 7


def test_a_live_bound_is_relative_to_the_server_minute(client: TestClient) -> None:
    headers = _auth(client)
    now = int(time.time() * 1000)
    _seed(
        client,
        headers,
        {"an-hour-ago": now - 60 * MINUTE, "three-hours-ago": now - 180 * MINUTE},
    )
    assert _ids(client, headers, f"mode=live&start={-120 * MINUTE}") == ["an-hour-ago"]
    assert _ids(client, headers, f"mode=live&end={-120 * MINUTE}") == [
        "three-hours-ago"
    ]


def test_an_empty_bound_filters_nothing(client: TestClient) -> None:
    headers = _old_and_new(client)
    assert len(_ids(client, headers, "mode=live")) == 15
    assert len(_ids(client, headers, "")) == 15


def test_a_crossed_bound_is_refused(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(
        f"{PREFIX}/logs/embedding?mode=fixed&start={T0 + MINUTE}&end={T0}",
        headers=headers,
    )
    assert r.status_code == 422


def test_an_end_without_a_mode_is_refused(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/logs/embedding?start={T0}", headers=headers)
    assert r.status_code == 422


def _spread(client: TestClient, headers: dict[str, str], query: str = "") -> dict:  # type: ignore[type-arg]
    r = client.get(f"{PREFIX}/logs/embedding/spread?{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def test_the_spread_draws_when_the_whole_log_was_logged(client: TestClient) -> None:
    headers = _auth(client)
    # Nine rows in the first minute, one 32 minutes later: the first bar holds
    # nine and the last one.
    _seed(client, headers, {f"burst-{i}": T0 + i * 1000 for i in range(9)})
    _seed(client, headers, {"late": T0 + 32 * MINUTE})
    spread = _spread(client, headers)
    assert spread["total"] == 10
    assert spread["min"] == T0
    assert spread["max"] == T0 + 32 * MINUTE
    assert len(spread["bins"]) == 32
    assert spread["bins"][0] == {"lo": T0, "hi": T0 + MINUTE, "count": 9}
    assert spread["bins"][-1]["count"] == 1
    assert sum(b["count"] for b in spread["bins"]) == 10


def test_a_zoomed_spread_bins_only_its_range(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, {f"m-{i}": T0 + i * MINUTE for i in range(33)})
    lo, hi = T0 + 8 * MINUTE, T0 + 16 * MINUTE
    spread = _spread(client, headers, f"lo={lo}&hi={hi}")
    # The whole spread's fields stay whole.
    assert spread["total"] == 33
    assert spread["min"] == T0
    assert spread["max"] == T0 + 32 * MINUTE
    assert spread["bins"][0]["lo"] == lo
    assert spread["bins"][-1]["hi"] == hi
    # Rows at minutes 8..16 inclusive, nine of them.
    assert sum(b["count"] for b in spread["bins"]) == 9


def test_the_spread_follows_the_search(client: TestClient) -> None:
    headers = _auth(client)
    r = client.post(
        f"{PREFIX}/logs/embedding",
        json=[
            {
                "id": "a",
                "textCount": 1,
                "status": "failed",
                "error": "boom",
                "timestamp": T0,
            },
            {"id": "b", "textCount": 1, "status": "success", "timestamp": T0},
        ],
        headers=headers,
    )
    assert r.status_code == 200
    assert _spread(client, headers, "search=boom")["total"] == 1


def test_a_half_zoom_is_refused(client: TestClient) -> None:
    r = client.get(f"{PREFIX}/logs/embedding/spread?lo={T0}", headers=_auth(client))
    assert r.status_code == 422


def test_an_empty_log_has_an_empty_spread(client: TestClient) -> None:
    spread = _spread(client, _auth(client))
    assert spread == {"total": 0, "min": None, "max": None, "median": None, "bins": []}
