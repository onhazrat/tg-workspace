"""`scripts/slow_endpoints.py` — the parser and the grouping it depends on.

The script's value is entirely in its grouping: the first hand-run of this
analysis produced fourteen single-request rows for `/data/channels/<name>` and
buried `/data/logs/sync`, which was costing minutes. A parser that silently
drops lines, or a normaliser that fails to collapse ids, turns the whole thing
into noise — and neither failure is visible in the output, which just looks
like a shorter report.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
from types import ModuleType

import pytest

_SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "slow_endpoints.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("slow_endpoints", _SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["slow_endpoints"] = module
    spec.loader.exec_module(module)
    return module


slow_endpoints = _load()

CLF = (
    '1.2.3.4 - - [18/Aug/2026:22:22:25 +0000] "GET {path} HTTP/2.0" {status} {size} '
    '"-" "-" 3081 "tg-backend@docker" "http://172.18.0.5:8000" {dur}'
)


def clf(path: str, dur: str = "929ms", size: int = 449, status: int = 200) -> str:
    return CLF.format(path=path, dur=dur, size=size, status=status)


def jsonline(path: str, duration_ns: int, origin_ns: int, size: int = 449) -> str:
    return json.dumps(
        {
            "RequestPath": path,
            "Duration": duration_ns,
            "OriginDuration": origin_ns,
            "DownstreamContentSize": size,
            "DownstreamStatus": 200,
            "StartUTC": "2026-08-18T22:22:25Z",
        }
    )


# --- normalisation ----------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/api/v1/data/channels/mizanplus", "/data/channels/{id}"),
        ("/api/v1/data/channels/SANDIS_MEME/stats", "/data/channels/{id}/stats"),
        ("/api/v1/data/summaries/1755123456789", "/data/summaries/{id}"),
        (
            "/api/v1/data/setting-groups/default-e1f0b6d9-2d60-4a79-96e7-5a22ebd63589",
            "/data/setting-groups/{id}",
        ),
        ("/api/v1/telegram/post-thumb/farsna/12345", "/telegram/post-thumb/{id}/{id}"),
        ("/api/v1/data/posts?limit=20&offset=0", "/data/posts"),
    ],
)
def test_ids_collapse_into_one_row(raw: str, expected: str) -> None:
    assert slow_endpoints.normalise(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "/api/v1/data/channels/stats",
        "/api/v1/data/channels/bios",
        "/api/v1/data/posts/counts",
    ],
)
def test_real_sub_resources_are_not_collapsed(raw: str) -> None:
    """`/channels/stats` is a route; `/channels/mizanplus` is an id.

    Collapsing the first would merge a 3.2 s batch endpoint into the same row as
    single-channel reads and hide it.
    """
    assert "{id}" not in slow_endpoints.normalise(raw)


def test_sse_streams_are_bucketed_apart() -> None:
    """Their duration is stream lifetime, so averaging them with anything else
    makes both numbers meaningless."""
    assert (
        slow_endpoints.normalise(
            "/api/v1/jobs/sync/8f0e1b2c-3d4e-5f60-7181-92a3b4c5d6e7/events"
        )
        == "(SSE stream)"
    )


# --- parsing ----------------------------------------------------------------


def test_clf_lines_parse_with_no_origin_split() -> None:
    buckets, first, last = slow_endpoints.parse([clf("/api/v1/data/posts")])

    bucket = buckets["/data/posts"]
    assert bucket.count == 1
    assert bucket.total_ms == pytest.approx(929)
    assert bucket.origin_seen == 0  # CLF carries no backend/total split
    assert first == last == "18/Aug/2026:22:22:25 +0000"


def test_json_lines_carry_the_backend_versus_transfer_split() -> None:
    """The column that would have shortcut rounds three to five."""
    buckets, _, _ = slow_endpoints.parse(
        [
            jsonline(
                "/api/v1/data/channels",
                duration_ns=3_000_000_000,
                origin_ns=800_000_000,
            )
        ]
    )

    bucket = buckets["/data/channels"]
    assert bucket.total_ms == pytest.approx(3000)
    assert bucket.origin_ms == pytest.approx(800)
    assert bucket.origin_seen == 1


def test_a_docker_log_prefix_before_the_json_is_tolerated() -> None:
    """`docker logs` interleaves Traefik's own lines with the access log."""
    line = "2026-08-18T22:22:25Z " + jsonline("/api/v1/data/posts", 1_000_000, 500_000)

    buckets, _, _ = slow_endpoints.parse([line])

    assert buckets["/data/posts"].count == 1


def test_unparsable_and_non_api_lines_are_skipped_not_counted() -> None:
    lines = [
        'time="2026-08-18" level=info msg="Configuration loaded"',
        "",
        clf("/assets/index-abc123.js"),
        clf("/api/v1/data/posts"),
    ]

    buckets, _, _ = slow_endpoints.parse(lines)

    assert set(buckets) == {"/data/posts"}


def test_non_api_paths_can_be_opted_back_in() -> None:
    buckets, _, _ = slow_endpoints.parse(
        [clf("/assets/index-abc123.js")], api_only=False
    )

    assert buckets


@pytest.mark.parametrize(
    ("raw", "expected_ms"),
    [("929ms", 929.0), ("1.5s", 1500.0), ("400µs", 0.4)],
)
def test_every_duration_unit_traefik_emits(raw: str, expected_ms: float) -> None:
    assert slow_endpoints._duration_ms(raw) == pytest.approx(expected_ms)


# --- ranking ----------------------------------------------------------------


def test_ranking_by_total_beats_ranking_by_mean() -> None:
    """The reason `total` is the default.

    A route hit twice at 30 s and one hit 500 times at 400 ms: the second is
    why the app feels slow, and sorting by mean puts it second.
    """
    lines = [clf("/api/v1/data/logs/sync", dur="30000ms")] * 2
    lines += [clf("/api/v1/data/posts", dur="400ms")] * 500

    buckets, _, _ = slow_endpoints.parse(lines)
    by_total = slow_endpoints.render(buckets, "total", 10).splitlines()[2]
    by_mean = slow_endpoints.render(buckets, "mean", 10).splitlines()[2]

    assert "/data/posts" in by_total
    assert "/data/logs/sync" in by_mean


def test_server_errors_are_flagged_in_the_row() -> None:
    buckets, _, _ = slow_endpoints.parse(
        [clf("/api/v1/data/posts"), clf("/api/v1/data/posts", status=500)]
    )

    assert "[1 5xx]" in slow_endpoints.render(buckets, "total", 10)
