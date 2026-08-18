#!/usr/bin/env python3
"""Rank API endpoints by how much time they actually cost, from Traefik's log.

## Why a script and not a dashboard

Every performance problem on this deployment so far was found by hand, and the
data to find them faster was already on the box: Traefik logs one line per
request with a duration and a response size, and nobody had ever read it. The
first run of this script over eleven days of that log named four endpoints in
one command, including the 14 MB `/data/logs/sync`.

A Prometheus/Grafana stack would answer the same question, and costs RAM on an
8 GB single-VM box whose RAM budget already had to be investigated once, to
serve dashboards for one operator. This costs nothing and runs on demand.

## Ranked by total time, not mean

Mean latency over-weights the rare call: a route hit twice at 30 s looks worse
than one hit ten thousand times at 400 ms, and only the second is why the app
feels slow. `total` is `count x mean` — the seconds this endpoint has actually
taken from someone. Both are printed; sort with `--by`.

## Reading the columns

`total` is what to fix first. `origin` is time inside the application and
`xfer` is `total - origin` — the bytes going down the wire. That split is the
one this project kept getting wrong: rounds three to five of
`docs/channels-tab-load-investigation.md` were transfer, not compute, and every
server-side measurement said the backend was fine. A row with a small `origin`
and a large `xfer` needs fewer bytes, not a faster query.

`xfer` only appears for JSON-format logs. Older CLF lines are still parsed —
that is what the archived history is — but CLF has no origin/total split, so
their `origin` column reads `-`.

Usage:
    # on the VM
    docker logs traefik-public-traefik-1 2>&1 | uv run python slow_endpoints.py
    zcat /root/perf-history/*.log.gz | uv run python slow_endpoints.py --by mean

    # from anywhere
    ssh root@staging-vm 'docker logs traefik-public-traefik-1 2>&1' \\
        | uv run python backend/scripts/slow_endpoints.py --top 30
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field

# Traefik's CLF line, e.g.
#   1.2.3.4 - - [18/Aug/2026:22:22:25 +0000] "GET /api/v1/x HTTP/2.0" 200 449
#   "-" "-" 3081 "router@docker" "http://172.18.0.5:8000" 929ms
_CLF = re.compile(
    r'^\S+ \S+ \S+ \[(?P<ts>[^\]]+)\] "(?P<method>[A-Z]+) (?P<path>\S+) [^"]*"'
    r" (?P<status>\d+) (?P<size>\d+) .*? (?P<dur>[\d.]+(?:ms|µs|s))$"
)

_UUID = re.compile(
    r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
)
_LONG_NUMBER = re.compile(r"/\d{3,}")

#: Path segments that are an identifier rather than part of the route. Traefik
#: does not know the FastAPI route template, so the collapsing happens here;
#: the application's own log line has the real template and does not need this.
_ID_PARENTS = {
    "channels",
    "summaries",
    "posts",
    "tag-runs",
    "reports",
    "bot-credentials",
    "chat-destinations",
    "setting-groups",
    "channel-photo",
    "post-thumb",
    "sync",
}


def _duration_ms(raw: str) -> float:
    if raw.endswith("ms"):
        return float(raw[:-2])
    if raw.endswith("µs"):
        return float(raw[:-2]) / 1000
    if raw.endswith("s"):
        return float(raw[:-1]) * 1000
    return float(raw)


def normalise(path: str) -> str:
    """Collapse a URL into something a group-by can total up.

    Without this every channel is its own row — the first run of this analysis
    produced fourteen single-request rows for `/data/channels/<name>` and buried
    the endpoint that was actually costing minutes.
    """
    path = path.split("?", 1)[0]
    path = path.removeprefix("/api/v1")
    path = _UUID.sub("/{id}", path)
    path = _LONG_NUMBER.sub("/{id}", path)

    segments = path.split("/")
    for i in range(1, len(segments)):
        if segments[i - 1] in _ID_PARENTS and segments[i] not in ("", "{id}"):
            # A known collection followed by anything that is not itself a
            # sub-resource name — `/channels/stats` stays, `/channels/foo` does not.
            if not _looks_like_a_subresource(segments, i):
                segments[i] = "{id}"
    path = "/".join(segments)

    if path.endswith("/events"):
        return "(SSE stream)"
    return path or "/"


def _looks_like_a_subresource(segments: list[str], i: int) -> bool:
    """True for `/channels/stats`, false for `/channels/some_channel_name`.

    A sub-resource is a fixed word the API declares; an id is whatever the user
    named their channel. There is no way to tell them apart from the URL alone,
    so this uses the one signal available: a real sub-resource is the *last*
    segment of a route that also exists without it, and this deployment has a
    small closed set of them.
    """
    return segments[i] in {"stats", "bios", "counts", "events", "latest", "queue"}


@dataclass
class Bucket:
    count: int = 0
    total_ms: float = 0.0
    origin_ms: float = 0.0
    origin_seen: int = 0
    max_ms: float = 0.0
    bytes_: int = 0
    statuses: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    def add(self, ms: float, origin: float | None, size: int, status: int) -> None:
        self.count += 1
        self.total_ms += ms
        self.max_ms = max(self.max_ms, ms)
        self.bytes_ += size
        self.statuses[status] += 1
        if origin is not None:
            self.origin_ms += origin
            self.origin_seen += 1


def parse(
    lines: Iterable[str], *, api_only: bool = True
) -> tuple[dict[str, Bucket], str, str]:
    buckets: dict[str, Bucket] = defaultdict(Bucket)
    first = last = ""

    for line in lines:
        record = _parse_json(line) or _parse_clf(line)
        if record is None:
            continue
        path, ms, origin, size, status, ts = record
        if api_only and not path.startswith("/api/"):
            continue
        if not first:
            first = ts
        last = ts
        buckets[normalise(path)].add(ms, origin, size, status)

    return buckets, first, last


def _parse_json(line: str) -> tuple[str, float, float | None, int, int, str] | None:
    start = line.find("{")
    if start < 0:
        return None
    try:
        row = json.loads(line[start:])
    except ValueError:
        return None
    path = row.get("RequestPath")
    duration = row.get("Duration")
    if not isinstance(path, str) or not isinstance(duration, int | float):
        return None
    origin = row.get("OriginDuration")
    return (
        path,
        duration / 1_000_000,  # Traefik writes nanoseconds in JSON mode
        origin / 1_000_000 if isinstance(origin, int | float) else None,
        int(row.get("DownstreamContentSize") or 0),
        int(row.get("DownstreamStatus") or 0),
        str(row.get("StartUTC") or row.get("time") or ""),
    )


def _parse_clf(line: str) -> tuple[str, float, float | None, int, int, str] | None:
    match = _CLF.search(line)
    if match is None:
        return None
    return (
        match["path"],
        _duration_ms(match["dur"]),
        None,  # CLF carries no origin/total split
        int(match["size"]),
        int(match["status"]),
        match["ts"],
    )


def render(buckets: dict[str, Bucket], by: str, top: int) -> str:
    keys = {
        "total": lambda b: b.total_ms,
        "mean": lambda b: b.total_ms / b.count,
        "max": lambda b: b.max_ms,
        "bytes": lambda b: b.bytes_,
        "count": lambda b: float(b.count),
    }
    ranked = sorted(buckets.items(), key=lambda kv: keys[by](kv[1]), reverse=True)

    out = [
        f"{'total(s)':>9} {'count':>7} {'mean':>8} {'origin':>8} {'xfer':>8} "
        f"{'max':>9} {'meanKB':>8}  path",
        f"{'-' * 9} {'-' * 7} {'-' * 8} {'-' * 8} {'-' * 8} {'-' * 9} {'-' * 8}  {'-' * 40}",
    ]
    for path, b in ranked[:top]:
        mean = b.total_ms / b.count
        if b.origin_seen:
            origin = b.origin_ms / b.origin_seen
            origin_col = f"{origin:8.0f}"
            xfer_col = f"{mean - origin:8.0f}"
        else:
            origin_col = f"{'-':>8}"
            xfer_col = f"{'-':>8}"
        errors = sum(n for s, n in b.statuses.items() if s >= 500)
        flag = f"  [{errors} 5xx]" if errors else ""
        out.append(
            f"{b.total_ms / 1000:9.1f} {b.count:7d} {mean:8.0f} {origin_col} "
            f"{xfer_col} {b.max_ms:9.0f} {b.bytes_ / b.count / 1024:8.1f}  {path}{flag}"
        )
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--by",
        default="total",
        choices=("total", "mean", "max", "bytes", "count"),
        help="ranking key (default: total time, which is what to fix first)",
    )
    parser.add_argument("--top", type=int, default=25)
    parser.add_argument(
        "--include-non-api",
        action="store_true",
        help="also count the frontend's own document and asset requests",
    )
    args = parser.parse_args()

    buckets, first, last = parse(sys.stdin, api_only=not args.include_non_api)
    if not buckets:
        print("no parseable access-log lines on stdin", file=sys.stderr)
        return 1

    requests = sum(b.count for b in buckets.values())
    print(f"{requests} requests, {first} -> {last}\n")
    print(render(buckets, args.by, args.top))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
