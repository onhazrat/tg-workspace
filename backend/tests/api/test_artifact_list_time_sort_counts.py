"""History's time filter, sort, counts and spread, through the HTTP routes.

`GET /data/artifacts` takes the time filter's moment (Written or the Analysis
window) and a Time bound resolved as the Logs bound is, and a sort with a
direction; `GET /data/artifacts/counts` answers the footer's total and each
Kind and Status choice's count; `GET /data/artifacts/spread` bins the Written
moment, or window starts, for the time filter's popover.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import ChatSession, DiscoverReport, Summary, TagRun
from tests.utils.scope import stored_scope

PREFIX = f"{settings.API_V1_STR}/data/artifacts"
MINUTE = 60_000
DAY = 1440 * MINUTE
#: 2021-01-01T00:00:00Z.
T0 = 1_609_459_200_000


def _me(client: TestClient, headers: dict[str, str]) -> uuid.UUID:
    r = client.get(f"{settings.API_V1_STR}/users/me", headers=headers)
    return uuid.UUID(r.json()["id"])


def _window(start: int | None, end: int | None = None) -> dict[str, Any] | None:
    if start is None:
        return None
    return stored_scope(start=start, end=end if end is not None else start + DAY)


def _seed(
    client: TestClient,
    headers: dict[str, str],
    rows: list[tuple[str, str, int, int | None, int | None, dict[str, Any]]],
) -> None:
    """(kind, id, written, window start, window end, extra columns) per row."""
    owner = _me(client, headers)
    with Session(engine) as session:
        for kind, row_id, written, start, end, extra in rows:
            scope = _window(start, end)
            if kind == "summary":
                session.add(
                    Summary(
                        id=row_id,
                        user_id=owner,
                        text=extra.pop("text", "body"),
                        timestamp=written,
                        scope=scope,
                        **extra,
                    )
                )
            elif kind == "chat":
                session.add(
                    ChatSession(
                        id=row_id,
                        user_id=owner,
                        title="chat",
                        timestamp=written,
                        scope=scope,
                        **extra,
                    )
                )
            elif kind == "tag":
                session.add(
                    TagRun(
                        id=row_id,
                        user_id=owner,
                        created_at=written,
                        scope=scope,
                        **extra,
                    )
                )
            else:
                session.add(
                    DiscoverReport(
                        id=row_id,
                        user_id=owner,
                        timestamp=written,
                        scope=scope or stored_scope(start=0, end=1),
                        **extra,
                    )
                )
        session.commit()


def _ids(client: TestClient, headers: dict[str, str], query: str = "") -> list[str]:
    r = client.get(f"{PREFIX}?{query}", headers=headers)
    assert r.status_code == 200, r.text
    return [row["id"] for row in r.json()]


# --------------------------------------------------------------------------
# The time filter
# --------------------------------------------------------------------------


def _written_rows(client: TestClient, headers: dict[str, str]) -> None:
    """One of each kind, a minute apart from T0, each with a window."""
    _seed(
        client,
        headers,
        [
            ("summary", "s", T0, T0, None, {}),
            ("chat", "c", T0 + MINUTE, T0, None, {}),
            ("tag", "t", T0 + 2 * MINUTE, T0, None, {}),
            ("discovery", "d", T0 + 3 * MINUTE, T0, None, {}),
        ],
    )


def test_a_fixed_written_bound_keeps_start_and_drops_end(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _written_rows(client, h)
    # A Tag run's Written moment is its `created_at`.
    assert _ids(client, h, f"mode=fixed&start={T0 + MINUTE}&end={T0 + 3 * MINUTE}") == [
        "t",
        "c",
    ]


def test_either_end_of_a_written_bound_may_be_open(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _written_rows(client, h)
    assert _ids(client, h, f"mode=fixed&end={T0 + 2 * MINUTE}") == ["c", "s"]
    assert _ids(client, h, f"mode=fixed&start={T0 + 2 * MINUTE}") == ["d", "t"]
    assert len(_ids(client, h, "mode=live")) == 4


def test_a_live_written_bound_is_relative_to_the_server_minute(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    now = int(time.time() * 1000)
    _seed(
        client,
        h,
        [
            ("summary", "hour", now - 60 * MINUTE, T0, None, {}),
            ("chat", "three-hours", now - 180 * MINUTE, T0, None, {}),
        ],
    )
    assert _ids(client, h, f"mode=live&start={-120 * MINUTE}") == ["hour"]
    assert _ids(client, h, f"mode=live&end={-120 * MINUTE}") == ["three-hours"]


def test_a_window_bound_keeps_every_window_that_overlaps_it(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    lo, hi = T0 + 10 * DAY, T0 + 20 * DAY
    _seed(
        client,
        h,
        [
            # Starts before the bound and ends inside it.
            ("summary", "into", T0, lo - DAY, lo + DAY, {}),
            ("summary", "inside", T0 + 1, lo + DAY, lo + 2 * DAY, {}),
            ("chat", "around", T0 + 2, lo - DAY, hi + DAY, {}),
            ("tag", "out-of", T0 + 3, hi - DAY, hi + DAY, {}),
            # Ends exactly at the bound's start: `[start, end)` touches nothing.
            ("summary", "before", T0 + 4, lo - 2 * DAY, lo, {}),
            ("chat", "after", T0 + 5, hi, hi + DAY, {}),
            # No window at all never matches a window filter.
            ("summary", "none", T0 + 6, None, None, {}),
        ],
    )
    assert set(_ids(client, h, f"moment=window&mode=fixed&start={lo}&end={hi}")) == {
        "into",
        "inside",
        "around",
        "out-of",
    }
    assert "none" not in _ids(client, h, f"moment=window&mode=fixed&start={lo}")
    # Under Written the same bound reads the Written moment instead.
    assert _ids(client, h, f"mode=fixed&start={lo}&end={hi}") == []
    # And with no bound the moment changes nothing.
    assert len(_ids(client, h, "moment=window")) == 7


def test_a_bad_bound_or_moment_is_refused(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    for query in (
        f"mode=fixed&start={T0 + MINUTE}&end={T0}",
        f"start={T0}",
        "moment=posted",
        "sort=title",
    ):
        r = client.get(f"{PREFIX}?{query}", headers=h)
        assert r.status_code == 422, query


# --------------------------------------------------------------------------
# Sort
# --------------------------------------------------------------------------


def _sort_rows(client: TestClient, headers: dict[str, str]) -> None:
    _seed(
        client,
        headers,
        [
            ("summary", "a", T0 + 3, T0 + 30, None, {}),
            ("chat", "b", T0 + 1, T0 + 10, None, {}),
            ("tag", "c", T0 + 2, None, None, {}),
            ("discovery", "d", T0 + 4, T0 + 20, None, {}),
        ],
    )


def test_written_sorts_newest_first_by_default_and_oldest_on_request(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _sort_rows(client, h)
    assert _ids(client, h) == ["d", "a", "c", "b"]
    assert _ids(client, h, "sort=written&descending=false") == ["b", "c", "a", "d"]


def test_window_sorts_on_its_start_with_a_missing_window_last_either_way(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _sort_rows(client, h)
    assert _ids(client, h, "sort=window") == ["a", "d", "b", "c"]
    assert _ids(client, h, "sort=window&descending=false") == ["b", "d", "a", "c"]


def test_three_pages_back_to_back_return_every_artifact_once_under_every_sort(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Equal keys everywhere, so only the `id` tiebreak orders them."""
    h = superuser_token_headers
    kinds = ("summary", "chat", "tag", "discovery")
    _seed(
        client,
        h,
        [
            (kinds[i % 4], f"p{i:02d}", T0 + i // 5, T0 if i % 3 else None, None, {})
            for i in range(15)
        ],
    )
    for query in (
        "",
        "descending=false",
        "sort=window",
        "sort=window&descending=false",
        f"mode=fixed&start={T0}",
    ):
        seen = [
            row
            for offset in (0, 5, 10)
            for row in _ids(client, h, f"{query}&limit=5&offset={offset}")
        ]
        assert sorted(seen) == [f"p{i:02d}" for i in range(15)], query


# --------------------------------------------------------------------------
# Counts
# --------------------------------------------------------------------------


def _count_rows(client: TestClient, headers: dict[str, str]) -> None:
    _seed(
        client,
        headers,
        [
            ("summary", "s-done", T0, T0, None, {"extra": {"isStarred": True}}),
            (
                "summary",
                "s-failed",
                T0 + MINUTE,
                T0,
                None,
                {"extra": {"status": "failed"}},
            ),
            (
                "summary",
                "s-pending",
                T0 + 2 * MINUTE,
                T0,
                None,
                {"extra": {"status": "pending"}},
            ),
            ("chat", "c", T0 + 3 * MINUTE, T0, None, {"extra": {"isStarred": True}}),
            ("tag", "t-pending", T0 + 4 * MINUTE, T0, None, {"status": "pending"}),
            # A Tag run's own `failed` is not the Failed filter's.
            ("tag", "t-failed", T0 + 5 * MINUTE, T0, None, {"status": "failed"}),
            ("discovery", "d", T0 + 6 * MINUTE, T0, None, {}),
        ],
    )


def _counts(client: TestClient, headers: dict[str, str], query: str = "") -> Any:
    r = client.get(f"{PREFIX}/counts?{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _assert_counts_match_the_list(
    client: TestClient, headers: dict[str, str], filters: dict[str, str]
) -> None:
    """Each count is the length of the list its filters would show."""

    def listed(**over: str | None) -> int:
        params = {**filters, **over}
        query = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
        return len(_ids(client, headers, f"{query}&limit=1000"))

    counts = _counts(client, headers, "&".join(f"{k}={v}" for k, v in filters.items()))
    assert counts["total"] == listed()
    for kind in ("summary", "chat", "tag", "discovery"):
        assert counts["kinds"][kind] == listed(kind=kind), kind
    assert counts["kindsAll"] == listed(kind=None)
    for status in ("failed", "pending"):
        assert counts["statuses"][status] == listed(status=status), status
    assert counts["statusesAll"] == listed(status=None)


def test_with_no_filter_every_count_is_its_list(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _count_rows(client, h)
    assert _counts(client, h) == {
        "total": 7,
        "kinds": {"summary": 3, "chat": 1, "tag": 2, "discovery": 1},
        "kindsAll": 7,
        "statuses": {"failed": 1, "pending": 2},
        "statusesAll": 7,
    }


def test_each_facet_is_counted_under_every_filter_but_its_own(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _count_rows(client, h)
    assert _counts(client, h, "kind=tag&status=pending") == {
        "total": 1,
        # Pending: Summaries and Tag runs only.
        "kinds": {"summary": 1, "chat": 0, "tag": 1, "discovery": 0},
        "kindsAll": 2,
        # Tag runs: never Failed, one Pending.
        "statuses": {"failed": 0, "pending": 1},
        "statusesAll": 2,
    }
    for filters in (
        {},
        {"kind": "summary"},
        {"status": "failed"},
        {"kind": "chat", "status": "failed"},
        {"starred": "true"},
        {"search": "chat"},
        {"mode": "fixed", "start": str(T0 + 2 * MINUTE)},
        {"moment": "window", "mode": "fixed", "start": str(T0 + DAY)},
    ):
        _assert_counts_match_the_list(client, h, filters)


# --------------------------------------------------------------------------
# Spread
# --------------------------------------------------------------------------


def _spread(client: TestClient, headers: dict[str, str], query: str = "") -> Any:
    r = client.get(f"{PREFIX}/spread?{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_spread_bins_when_artifacts_were_written(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    # Nine in the first minute, one 32 minutes later.
    _seed(
        client,
        h,
        [("summary", f"w{i}", T0 + i * 1000, T0, None, {}) for i in range(9)]
        + [("chat", "late", T0 + 32 * MINUTE, None, None, {})],
    )
    spread = _spread(client, h)
    assert spread["total"] == 10
    assert spread["min"] == T0
    assert spread["max"] == T0 + 32 * MINUTE
    # Ten values: the median is halfway between the fifth and the sixth.
    assert spread["median"] == T0 + 4500
    assert len(spread["bins"]) == 32
    assert sum(b["count"] for b in spread["bins"]) == 10
    assert spread["bins"][0]["count"] == 9
    assert spread["bins"][-1]["count"] == 1


def test_a_zoom_bins_only_its_range_and_keeps_the_whole_spreads_fields(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _seed(
        client,
        h,
        [("summary", f"z{i}", T0 + i * MINUTE, T0, None, {}) for i in range(33)],
    )
    zoomed = _spread(client, h, f"lo={T0}&hi={T0 + 15 * MINUTE}")
    assert zoomed["total"] == 33
    assert zoomed["max"] == T0 + 32 * MINUTE
    assert zoomed["bins"][0]["lo"] == T0
    assert zoomed["bins"][-1]["hi"] == T0 + 15 * MINUTE
    assert sum(b["count"] for b in zoomed["bins"]) == 16


def test_the_window_spread_bins_window_starts_and_leaves_out_none(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _seed(
        client,
        h,
        [
            ("summary", "a", T0 + DAY, T0, None, {}),
            ("chat", "b", T0 + DAY, T0 + 10 * MINUTE, None, {}),
            ("tag", "c", T0 + DAY, None, None, {}),
        ],
    )
    spread = _spread(client, h, "moment=window")
    assert (spread["total"], spread["min"], spread["max"]) == (
        2,
        T0,
        T0 + 10 * MINUTE,
    )
    assert sum(b["count"] for b in spread["bins"]) == 2


def test_the_spread_follows_every_filter_but_the_time_bound(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    _count_rows(client, h)
    assert _spread(client, h, "kind=summary")["total"] == 3
    assert _spread(client, h, "status=pending")["total"] == 2
    assert _spread(client, h, "starred=true")["total"] == 2
    # The bound is not a spread parameter, so it cannot narrow it.
    assert _spread(client, h, f"mode=fixed&start={T0 + 5 * MINUTE}")["total"] == 7
    empty = _spread(client, h, "kind=chat&status=failed")
    assert (empty["total"], empty["bins"]) == (0, [])
