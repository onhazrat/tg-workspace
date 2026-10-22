"""PROTOTYPE (request-stats): the real inputs the Requests tab's synthetic data is scaled from.

Serves `GET /request-stats` (the frontend reaches it as `/proto/request-stats`) against a
deployment's database through a read-only role. Every other route goes to the deployment's
real API. Identity is the deployment's own: the caller's bearer token is forwarded to
`PROTO_API_BASE/api/v1/quota/usage`, which answers 200 only to an account holding the
permission to read every account's quota, so that permission gates this route too.

    PROTO_API_BASE=https://<api-base> PROTO_PG_USER=<role> PROTO_PORT=8131 \
        python backend/scripts/proto_request_stats_api.py

libpq reads the password from ~/.pgpass. Throwaway: never mount this in the real API.
"""

import os
import time
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware

API_BASE = os.environ["PROTO_API_BASE"].rstrip("/")
DSN = (
    f"host=localhost port={os.environ.get('PROTO_PG_PORT', '5433')} "
    f"dbname={os.environ.get('PROTO_PG_DB', 'app')} user={os.environ['PROTO_PG_USER']} "
    "connect_timeout=10 options='-c max_parallel_workers_per_gather=0'"
)
_operators: dict[str, bool] = {}
_cache: dict[int, tuple[float, dict[str, object]]] = {}

app = FastAPI(title="PROTOTYPE request stats API")
# The answer is ~1.5 MB of JSON; the prototype has no Traefik in front of it.
app.add_middleware(GZipMiddleware)


def _require_operator(request: Request) -> None:
    auth = request.headers.get("authorization", "")
    if auth not in _operators:
        answer = httpx.get(f"{API_BASE}/api/v1/quota/usage", headers={"Authorization": auth})
        if answer.status_code == 401:
            raise HTTPException(status_code=401, detail="Not authenticated")
        _operators[auth] = answer.status_code == 200
    if not _operators[auth]:
        raise HTTPException(status_code=403, detail="Operator only")


# Sync log timestamps are epoch milliseconds; everything is bucketed in UTC because the
# Budgets reset at UTC midnight.
_LOG_DAY = "(to_timestamp(timestamp / 1000.0) at time zone 'UTC')::date"
_LOG_HOUR = "extract(hour from to_timestamp(timestamp / 1000.0) at time zone 'UTC')::int"

QUERIES = {
    "ledger": """
        select q.day::text, q.user_id::text, q.budget, q.requests
        from tg_quota_usage q where q.day >= %(d0)s order by 1""",
    "accounts": """
        select distinct u.id::text, u.email from tg_quota_usage q
        join "user" u on u.id = q.user_id where q.day >= %(d0)s""",
    "probes": """
        select day::text, requests from tg_directory_probe_usage
        where day >= %(d0)s order by 1""",
    # A Directory entry keeps only its latest check, so this is the latest verdict's day
    # and hour: a proxy for when probing happened and how often it found nothing.
    "verdicts": """
        select checked_at::date::text, extract(hour from checked_at)::int, status, count(*)
        from tg_channel_directory where checked_at >= %(d0)s group by 1, 2, 3""",
    "channel_days": f"""
        select {_LOG_DAY}::text, channel_name, source, status, posts_count = 0,
               count(*), sum(posts_count)
        from tg_sync_logs where timestamp >= %(ms0)s group by 1, 2, 3, 4, 5""",
    # The last 7 days, the span each Request is kept, in 5-minute buckets: the finest
    # grain the trend draws. Sync log times are epoch ms; checked_at is UTC.
    "fine_syncs": """
        select (timestamp / 300000) * 300000, source, status, posts_count = 0, count(*), sum(posts_count)
        from tg_sync_logs where timestamp >= %(ms7)s group by 1, 2, 3, 4""",
    "fine_probes": """
        select (floor(extract(epoch from checked_at) / 300) * 300000)::bigint, status, count(*)
        from tg_channel_directory where checked_at >= now() - interval '7 days' group by 1, 2""",
    "hours": f"""
        select {_LOG_DAY}::text, {_LOG_HOUR}, source, status, posts_count = 0,
               count(*), sum(posts_count)
        from tg_sync_logs where timestamp >= %(ms0)s group by 1, 2, 3, 4, 5""",
}


def _load(days: int) -> dict[str, object]:
    d0 = (datetime.now(UTC) - timedelta(days=days - 1)).date()
    ms0 = int(datetime(d0.year, d0.month, d0.day, tzinfo=UTC).timestamp() * 1000)
    ms7 = int((datetime.now(UTC) - timedelta(days=7)).timestamp() * 1000)
    with psycopg.connect(DSN) as conn:
        out: dict[str, object] = {"since": d0.isoformat()}
        for name, sql in QUERIES.items():
            out[name] = conn.execute(sql, {"d0": d0, "ms0": ms0, "ms7": ms7}).fetchall()
    return out


@app.get("/request-stats")
def request_stats(request: Request, days: int = 30) -> dict[str, object]:
    _require_operator(request)
    days = max(1, min(days, 120))
    hit = _cache.get(days)
    # ponytail: 10-minute in-process cache, the prototype only needs it fresh-ish
    if hit is None or time.monotonic() - hit[0] > 600:
        hit = (time.monotonic(), _load(days))
        _cache[days] = hit
    return hit[1]


# One Channel's syncs, or the Directory's latest probe verdicts, over the 7 days each
# Request is kept: the raw material the per-Request panel expands into Requests.
_SYNCS = """
    select timestamp, status, posts_count, source, coalesce(error, '')
    from tg_sync_logs where channel_name = %(channel)s and timestamp >= %(ms0)s
    order by timestamp desc limit 2000"""
_PROBES = """
    select (extract(epoch from checked_at) * 1000)::bigint, status, handle, coalesce(last_error, '')
    from tg_channel_directory where checked_at >= now() - interval '7 days'
    order by checked_at desc limit 500"""


@app.get("/request-stats/requests")
def channel_requests(request: Request, channel: str) -> dict[str, object]:
    _require_operator(request)
    ms0 = int((datetime.now(UTC) - timedelta(days=7)).timestamp() * 1000)
    with psycopg.connect(DSN) as conn:
        if channel == "Directory probes":
            return {"probes": conn.execute(_PROBES).fetchall()}
        return {"syncs": conn.execute(_SYNCS, {"channel": channel, "ms0": ms0}).fetchall()}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PROTO_PORT", "8131")))
