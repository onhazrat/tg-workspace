"""PROTOTYPE (complete-window): ADR-043's check, standalone. Never mount this.

Answers which Channels of a Scope are Incomplete and why, against a
deployment's database through a read-only role. The frontend calls it as
`/proto/*`; everything else goes to the deployment's real API. Identity is the
deployment's own: the caller's bearer token is forwarded to
`PROTO_API_BASE/api/v1/users/me`.

    PROTO_API_BASE=https://<api-base> PROTO_PG_USER=<role> PROTO_SCHEMA=<schema> \
        uv run python scripts/proto_complete_window_api.py

Two approximations, both because the stamps ADR-043 adds do not exist yet:
- The head test reads Last sync (when a sync finished) where the ADR reads the
  moment the newest page was read.
- A reconstructed check of an existing Summary reads Posts by `retrieved_at`,
  confirmed gaps by `confirmed_at` and Last sync from the sync logs, all up to
  the Summary's creation; retention may since have removed Posts it held.

Every gated action writes one row per run to `<schema>.complete_window_runs`,
the one scratch table this API owns, and a manual Summary made right after a
run shows that run's record. PROTOTYPE, wipe me.
"""

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

PG_HOST = "localhost"
PG_PORT = os.environ.get("PROTO_PG_PORT", "5433")
PG_USER = os.environ["PROTO_PG_USER"]
PG_DB = os.environ.get("PROTO_PG_DB", "app")
SCHEMA = os.environ["PROTO_SCHEMA"]


def _pgpass() -> str:
    for line in (Path.home() / ".pgpass").read_text().splitlines():
        host, port, db, user, password = line.split(":", 4)
        if (host, port, db, user) == (PG_HOST, PG_PORT, PG_DB, PG_USER):
            return password
    raise SystemExit("no ~/.pgpass line for the prototype role")


os.environ.update(
    POSTGRES_SERVER=PG_HOST,
    POSTGRES_PORT=PG_PORT,
    POSTGRES_USER=PG_USER,
    POSTGRES_DB=PG_DB,
    POSTGRES_PASSWORD=_pgpass(),
    DB_POOL_SIZE="5",
    DB_MAX_OVERFLOW="0",
)

import uvicorn  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from sqlalchemy import event, text  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.core.db import engine  # noqa: E402
from app.jobs.settings import (  # noqa: E402
    compute_scrape_cutoff_ms,
    load_retention_policy,
    load_sync_settings,
)
from app.services.telegram_web import UNAVAILABLE_WEB_VIEW_MESSAGE  # noqa: E402


@event.listens_for(engine, "connect")
def _no_parallel(dbapi_connection, _record):  # type: ignore[no-untyped-def]
    with dbapi_connection.cursor() as cursor:
        cursor.execute("SET max_parallel_workers_per_gather = 0")
    dbapi_connection.commit()


API_BASE = os.environ["PROTO_API_BASE"].rstrip("/")
_identities: dict[str, uuid.UUID] = {}


def _user(request: Request) -> uuid.UUID:
    auth = request.headers.get("authorization", "")
    if auth not in _identities:
        answer = httpx.get(
            f"{API_BASE}/api/v1/users/me", headers={"Authorization": auth}
        )
        if answer.status_code != 200:
            raise HTTPException(status_code=401, detail="Not authenticated")
        _identities[auth] = uuid.UUID(answer.json()["id"])
    return _identities[auth]


app = FastAPI(title="PROTOTYPE complete window API")

with engine.begin() as conn:
    conn.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS {SCHEMA}.complete_window_runs ("
            " id text PRIMARY KEY, user_id uuid NOT NULL, made_at bigint NOT NULL,"
            " body jsonb NOT NULL)"
        )
    )

# One statement for every Channel. `:fz` is the frozen moment the Posts,
# gaps and sync logs are read up to; a live check passes a far future, so it
# reads everything the workspace holds now.
_CHECK_SQL = """
WITH ch AS (
  SELECT c.name, c.history_reached_channel_start AS reached_start,
         coalesce(g.is_frozen, false) AS frozen, c.last_updated AS live_last_sync,
         coalesce(g.is_unavailable_on_web_view, false) AS web_gone,
         coalesce(g.auto_sync_interval_minutes, 60) AS interval_min
  FROM tg_channel_follows f
  JOIN tg_channels c ON c.id = f.channel_id
  LEFT JOIN tg_channel_setting_groups g ON g.id = f.setting_group_id
  WHERE f.user_id = :uid AND c.name = ANY(:names)
),
succ AS (
  SELECT channel_name, max(timestamp) AS last_sync FROM tg_sync_logs
  WHERE channel_name = ANY(:names) AND status = 'success' AND timestamp <= :fz
  GROUP BY channel_name
),
ll AS (
  SELECT DISTINCT ON (channel_name) channel_name, status, error, timestamp FROM tg_sync_logs
  WHERE channel_name = ANY(:names) AND timestamp <= :fz
  ORDER BY channel_name, timestamp DESC
),
held AS (
  SELECT ch.*,
    (SELECT p.post_id FROM tg_posts p WHERE p.channel_name = ch.name
       AND p.timestamp <= :s AND coalesce(p.retrieved_at, 0) <= :fz
       ORDER BY p.timestamp DESC LIMIT 1) AS lo_id,
    (SELECT min(p.post_id) FROM tg_posts p WHERE p.channel_name = ch.name
       AND coalesce(p.retrieved_at, 0) <= :fz) AS first_id,
    (SELECT min(p.timestamp) FROM tg_posts p WHERE p.channel_name = ch.name
       AND coalesce(p.retrieved_at, 0) <= :fz) AS first_ts,
    (SELECT p.post_id FROM tg_posts p WHERE p.channel_name = ch.name
       AND p.timestamp > :e AND coalesce(p.retrieved_at, 0) <= :fz
       ORDER BY p.timestamp ASC LIMIT 1) AS head_id,
    (SELECT p.post_id FROM tg_posts p WHERE p.channel_name = ch.name
       AND coalesce(p.retrieved_at, 0) <= :fz
       ORDER BY p.timestamp DESC LIMIT 1) AS max_id,
    -- Its own pace over the week before its last sync (a Post after that
    -- cannot be held yet), and every Post held inside the window.
    (SELECT count(*) FROM tg_posts p WHERE p.channel_name = ch.name
       AND p.timestamp > pace.to_ts - 604800000 AND p.timestamp <= pace.to_ts
       AND coalesce(p.retrieved_at, 0) <= :fz) AS week_posts,
    pace.to_ts AS pace_to,
    (SELECT count(*) FROM tg_posts p WHERE p.channel_name = ch.name
       AND p.timestamp >= :s AND p.timestamp <= :e
       AND coalesce(p.retrieved_at, 0) <= :fz) AS held,
    succ.last_sync AS log_last_sync,
    json_build_object('status', ll.status, 'error', ll.error, 'at', ll.timestamp) AS last_log
  FROM ch
  LEFT JOIN succ ON succ.channel_name = ch.name
  LEFT JOIN ll ON ll.channel_name = ch.name
  CROSS JOIN LATERAL (SELECT least(:e, coalesce(
    CASE WHEN :recon THEN succ.last_sync ELSE ch.live_last_sync END, 0)) AS to_ts) pace
),
r AS (
  SELECT held.*,
    coalesce(lo_id, CASE WHEN reached_start THEN first_id END) AS lo2,
    coalesce(head_id, max_id) AS hi
  FROM held
)
SELECT r.*,
  CASE WHEN lo2 IS NULL OR hi IS NULL OR hi < lo2 THEN 0 ELSE
    (hi - lo2 + 1)
    - (SELECT count(*) FROM tg_posts p WHERE p.channel_name = r.name
         AND p.post_id BETWEEN r.lo2 AND r.hi AND coalesce(p.retrieved_at, 0) <= :fz)
    - (SELECT count(*) FROM tg_post_sync_state g WHERE g.channel_name = r.name
         AND g.post_id BETWEEN r.lo2 AND r.hi AND g.confirmed_at <= :fz
         -- A gap confirmed and later stored as a Post counts once.
         AND NOT EXISTS (SELECT 1 FROM tg_posts p WHERE p.channel_name = g.channel_name
           AND p.post_id = g.post_id AND coalesce(p.retrieved_at, 0) <= :fz))
  END AS missing
FROM r
"""
#: A live check reads everything held now, so it drops the moment filters and
#: lets the (channel, timestamp) and (channel, post id) indexes answer.
_CHECKS = {
    True: text(_CHECK_SQL),
    False: text(
        _CHECK_SQL.replace("coalesce(p.retrieved_at, 0) <= :fz", "TRUE").replace(
            "g.confirmed_at <= :fz", "TRUE"
        )
    ),
}

# Where each hole is, in one statement for every Channel that has one: the
# Posts either side of its first and last missing id.
_HOLES = text(
    """
WITH h AS (
  SELECT * FROM unnest(CAST(:names AS text[]), CAST(:los AS int[]), CAST(:his AS int[]))
    AS t(name, lo, hi)
),
m AS (
  SELECT h.name, min(x) AS first_missing, max(x) AS last_missing
  FROM h CROSS JOIN LATERAL generate_series(h.lo, h.hi) x
  WHERE NOT EXISTS (SELECT 1 FROM tg_posts p WHERE p.channel_name = h.name
                      AND p.post_id = x AND coalesce(p.retrieved_at, 0) <= :fz)
    AND NOT EXISTS (SELECT 1 FROM tg_post_sync_state g WHERE g.channel_name = h.name
                      AND g.post_id = x AND g.confirmed_at <= :fz)
  GROUP BY h.name
)
SELECT m.name,
  (SELECT p.timestamp FROM tg_posts p WHERE p.channel_name = m.name
     AND p.post_id < m.first_missing ORDER BY p.post_id DESC LIMIT 1) AS from_ts,
  (SELECT p.timestamp FROM tg_posts p WHERE p.channel_name = m.name
     AND p.post_id > m.last_missing ORDER BY p.post_id ASC LIMIT 1) AS to_ts
FROM m
"""
)

FAR_FUTURE = 2**62
# ponytail: never refreshed; restart the API after changing retention.
_settings: dict[uuid.UUID, tuple[dict[str, Any], dict[str, Any]]] = {}

#: ADR-043's order: what a person can act on first.
ORDER = [
    "skipped",
    "failed",
    "timed_out",
    "refused",
    "end",
    "hole",
    "start",
    "retention",
    "frozen",
]


def _check(
    session: Session,
    uid: uuid.UUID,
    names: list[str],
    start: int,
    end: int,
    freeze: int,
    *,
    reconstruct: bool,
) -> list[dict[str, Any]]:
    e = min(end, freeze)
    fz = freeze if reconstruct else FAR_FUTURE
    if uid not in _settings:
        _settings[uid] = (
            load_sync_settings(session, user_id=uid),
            load_retention_policy(session),
        )
    cutoff = compute_scrape_cutoff_ms(*_settings[uid], now_ms=freeze)
    rows = (
        session.execute(
            _CHECKS[reconstruct],
            {
                "uid": uid,
                "names": names,
                "s": start,
                "e": e,
                "fz": fz,
                "recon": reconstruct,
            },
        )
        .mappings()
        .all()
    )
    holed = [r for r in rows if r["missing"] > 0]
    holes = (
        {
            h["name"]: h
            for h in session.execute(
                _HOLES,
                {
                    "names": [r["name"] for r in holed],
                    "los": [r["lo2"] for r in holed],
                    "his": [r["hi"] for r in holed],
                    "fz": fz,
                },
            ).mappings()
        }
        if holed
        else {}
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        last_sync = r["log_last_sync"] if reconstruct else r["live_last_sync"]
        reasons: list[str] = []
        stretches: list[dict[str, Any]] = []
        if r["frozen"]:
            reasons.append("frozen")
        if r["head_id"] is None and (last_sync or 0) < e:
            reasons.append("end")
            stretches.append(
                {"kind": "end", "from": max(last_sync or start, start), "to": e}
            )
        if r["lo2"] is None:
            short_to = r["first_ts"] or e
            reasons.append("retention" if start < cutoff else "start")
            stretches.append({"kind": "start", "from": start, "to": min(short_to, e)})
        if r["missing"] > 0:
            reasons.append("hole")
            hole = holes.get(r["name"], {"from_ts": None, "to_ts": None})
            stretches.append(
                {
                    "kind": "hole",
                    "from": hole["from_ts"] or start,
                    "to": hole["to_ts"] or e,
                }
            )
        last_log = r["last_log"]
        error = None
        if reasons and last_log and last_log.get("status") == "failed":
            reasons.append("failed")
            error = last_log["error"]
        reasons.sort(key=ORDER.index)
        # Telegram will not serve this Channel's web view: never worth a retry.
        web_gone = r["web_gone"] or UNAVAILABLE_WEB_VIEW_MESSAGE in (error or "")
        # Posts an hour over the week before its last sync, starting no
        # earlier than its history or the retention cutoff.
        pace_to = r["pace_to"]
        pace_from = max(pace_to - 7 * 86_400_000, r["first_ts"] or pace_to, cutoff)
        rate = (
            r["week_posts"] / ((pace_to - pace_from) / 3_600_000)
            if pace_to - pace_from >= 3_600_000
            else None
        )
        out.append(
            {
                "name": r["name"],
                "lastSync": last_sync,
                "reasons": reasons,
                "reason": reasons[0] if reasons else None,
                "error": error,
                "missingIds": int(r["missing"]),
                "rate": rate,
                "held": int(r["held"]),
                "stretches": stretches,
                "syncable": not r["frozen"]
                and not web_gone
                and reasons != ["retention"],
                # Behind by more than two sync intervals is overdue, not routine.
                "behindLimit": 2 * r["interval_min"] * 60_000,
            }
        )
    return out


class CheckRequest(BaseModel):
    channels: list[str]
    start: int
    end: int
    #: The moment the action started; now when absent.
    freeze: int | None = None


@app.post("/completeness")
def completeness(body: CheckRequest, request: Request) -> dict[str, Any]:
    uid = _user(request)
    freeze = body.freeze or int(time.time() * 1000)
    began = time.monotonic()
    with Session(engine) as session:
        channels = _check(
            session, uid, body.channels, body.start, body.end, freeze, reconstruct=False
        )
    return {
        "freeze": freeze,
        "end": min(body.end, freeze),
        "start": body.start,
        "channels": channels,
        "posts": sum(c["held"] for c in channels),
        "ms": int((time.monotonic() - began) * 1000),
    }


#: Each Artifact kind's table, its creation column, and the gate kinds that make it.
ARTIFACTS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "summary": ("tg_summaries", "timestamp", ("summary", "summary-prompt")),
    "chat": ("tg_chat_sessions", "timestamp", ("chat",)),
    "tag": ("tg_tag_runs", "created_at", ("tags", "tags-prompt")),
    "discovery": ("tg_discover_reports", "timestamp", ("discover",)),
}


class ArtifactRef(BaseModel):
    id: str
    kind: str


class ArtifactsRequest(BaseModel):
    items: list[ArtifactRef]


_reconstructed: dict[str, dict[str, Any]] = {}


@app.post("/artifacts/completeness")
def artifacts_completeness(body: ArtifactsRequest, request: Request) -> dict[str, Any]:
    """Each Artifact's check: the gate's record when it went through the gate,
    otherwise as the check would have answered when the Artifact was made."""
    uid = _user(request)
    out: dict[str, Any] = {}
    with Session(engine) as session:
        for item in body.items:
            sid, kind = item.id, item.kind
            if sid in _reconstructed:
                out[sid] = _reconstructed[sid]
                continue
            if kind not in ARTIFACTS:
                out[sid] = {"checked": False}
                continue
            table, made, gate_kinds = ARTIFACTS[kind]
            row = (
                session.execute(
                    text(
                        f"SELECT scope, {made} AS made FROM {table}"
                        " WHERE id = :id AND user_id = :uid"
                    ),
                    {"id": sid, "uid": uid},
                )
                .mappings()
                .first()
            )
            # An Artifact made through the gate carries what the gate recorded:
            # the latest run of its kind before it, with no other Artifact of
            # that kind between. Hand-made ids are UUIDs; the scheduler's are
            # timestamps and never went through the gate.
            if row and "-" in sid:
                linked = session.execute(
                    text(
                        f"SELECT r.body FROM {SCHEMA}.complete_window_runs r"
                        " WHERE r.user_id = :uid"
                        " AND r.body->>'kind' = ANY(:kinds)"
                        " AND r.made_at <= :ts AND r.made_at >= :ts - 600000"
                        f" AND NOT EXISTS (SELECT 1 FROM {table} s"
                        "   WHERE s.user_id = :uid AND s.id LIKE '%-%'"
                        f"   AND s.{made} >= r.made_at AND s.{made} < :ts)"
                        " ORDER BY r.made_at DESC LIMIT 1"
                    ),
                    {"uid": uid, "ts": int(row["made"]), "kinds": list(gate_kinds)},
                ).scalar()
                if linked:
                    out[sid] = _reconstructed[sid] = linked
                    continue
            scope = row and row["scope"]
            if not scope or "start" not in scope:
                out[sid] = {"checked": False}
                continue
            channels = _check(
                session,
                uid,
                list(scope.get("channels") or []),
                int(scope["start"]),
                int(scope["end"]),
                int(row["made"]),
                reconstruct=True,
            )
            out[sid] = _reconstructed[sid] = {
                "checked": True,
                "reconstructed": True,
                "freeze": int(row["made"]),
                "start": int(scope["start"]),
                "end": min(int(scope["end"]), int(row["made"])),
                "channels": [c for c in channels if c["reason"]],
                "total": len(channels),
                "posts": sum(c["held"] for c in channels),
            }
    return out


class RunRecord(BaseModel):
    freeze: int
    start: int
    end: int
    choice: str
    #: Which Action row's button ran: summary, chat, tags, discover, or a prompt copy.
    kind: str = "summary"
    channels: list[dict[str, Any]]
    total: int
    #: Posts the window held across every Channel, for the share unproven.
    posts: int | None = None
    #: "complete only": the Incomplete Channels left out of the selection.
    excluded: list[str] = []


@app.post("/runs")
def record_run(body: RunRecord, request: Request) -> dict[str, Any]:
    """One pass through the gate: what the action's Artifact froze."""
    uid = _user(request)
    rid = f"proto-{uuid.uuid4()}"
    doc = {"checked": True, "reconstructed": False, "id": rid, **body.model_dump()}
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.complete_window_runs (id, user_id, made_at, body)"
                " VALUES (:id, :uid, :at, CAST(:body AS jsonb))"
            ),
            {
                "id": rid,
                "uid": uid,
                "at": int(time.time() * 1000),
                "body": json.dumps(doc),
            },
        )
    return doc


@app.get("/runs")
def list_runs(request: Request) -> list[dict[str, Any]]:
    uid = _user(request)
    with Session(engine) as session:
        return [
            {**row["body"], "madeAt": row["made_at"]}
            for row in session.execute(
                text(
                    f"SELECT body, made_at FROM {SCHEMA}.complete_window_runs"
                    " WHERE user_id = :uid ORDER BY made_at DESC LIMIT 20"
                ),
                {"uid": uid},
            ).mappings()
        ]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PROTO_PORT", "8107")))
