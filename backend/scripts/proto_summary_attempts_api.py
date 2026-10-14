"""PROTOTYPE, throw away. Summary generation attempts in their own storage.

Every Generate or Retry of a Summary is one row: its outcome, the error, the
model and Key it ran on, and any text the stream produced before it died. The
rows are their own entity, deliberately not the LLM logs: logs are pruned for
space and their retention must not erase a Summary's history.

The real build is a Postgres table (`tg_summary_attempts`, user-owned, cascading
from `tg_summaries`, on neither retention inventory). Here it is a local SQLite
file so the prototype writes nothing to the deployment.

Run from `backend/`:
  PROTO_API_BASE=<api-base> PROTO_DB=<path> PROTO_PORT=8021 \
    uv run python scripts/proto_summary_attempts_api.py

Identity: the caller's Authorization header is forwarded to
`<api-base>/api/v1/users/me` and the answer cached per token.
"""

import asyncio
import json
import os
import random
import sqlite3
import time
import uuid
from collections.abc import AsyncIterator
from typing import Literal

import httpx
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

API_BASE = os.environ["PROTO_API_BASE"].rstrip("/")
DB_PATH = os.environ["PROTO_DB"]
PORT = int(os.environ.get("PROTO_PORT", "8021"))

db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.executescript(
    """
    CREATE TABLE IF NOT EXISTS summary_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      summary_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      outcome TEXT NOT NULL,          -- failed | succeeded | kept_draft
      kind TEXT,                      -- quota | auth | transient | model | limit | empty | other
      error TEXT,
      model TEXT NOT NULL,
      key_id TEXT,
      partial_text TEXT,
      auto INTEGER NOT NULL DEFAULT 0,
      created_at REAL NOT NULL,
      UNIQUE (summary_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS summary_attempts_owner
      ON summary_attempts (user_id, summary_id);
    """
)
# A dismissed draft stays stored; it is only no longer offered.
if "draft_dismissed_at" not in {
    r["name"] for r in db.execute("PRAGMA table_info(summary_attempts)")
}:
    db.execute("ALTER TABLE summary_attempts ADD COLUMN draft_dismissed_at REAL")
    db.commit()

app = FastAPI(title="PROTOTYPE summary attempts")
_identity: dict[str, str] = {}


def user_id(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Not authenticated")
    if authorization not in _identity:
        r = httpx.get(
            f"{API_BASE}/api/v1/users/me",
            headers={"Authorization": authorization},
            timeout=20,
        )
        if r.status_code != 200:
            raise HTTPException(r.status_code, "Not authenticated")
        _identity[authorization] = r.json()["id"]
    return _identity[authorization]


class AttemptIn(BaseModel):
    outcome: Literal["failed", "succeeded", "kept_draft"]
    kind: str | None = None
    error: str | None = None
    model: str
    keyId: str | None = None
    partialText: str | None = None
    auto: bool = False


def out(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "summaryId": row["summary_id"],
        "attempt": row["attempt"],
        "outcome": row["outcome"],
        "kind": row["kind"],
        "error": row["error"],
        "model": row["model"],
        "keyId": row["key_id"],
        "partialText": row["partial_text"],
        "auto": bool(row["auto"]),
        "draftDismissed": row["draft_dismissed_at"] is not None,
        "at": int(row["created_at"] * 1000),
    }


@app.get("/summaries/{summary_id}/attempts")
def list_attempts(
    summary_id: str, authorization: str | None = Header(None)
) -> list[dict[str, object]]:
    uid = user_id(authorization)
    rows = db.execute(
        "SELECT * FROM summary_attempts WHERE user_id = ? AND summary_id = ?"
        " ORDER BY attempt",
        (uid, summary_id),
    ).fetchall()
    return [out(r) for r in rows]


def insert_attempt(uid: str, summary_id: str, body: AttemptIn) -> dict[str, object]:
    with db:
        n = db.execute(
            "SELECT COALESCE(MAX(attempt), 0) + 1 FROM summary_attempts"
            " WHERE summary_id = ?",
            (summary_id,),
        ).fetchone()[0]
        row_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO summary_attempts (id, user_id, summary_id, attempt,"
            " outcome, kind, error, model, key_id, partial_text, auto, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                row_id,
                uid,
                summary_id,
                n,
                body.outcome,
                body.kind,
                body.error,
                body.model,
                body.keyId,
                body.partialText,
                int(body.auto),
                time.time(),
            ),
        )
    row = db.execute(
        "SELECT * FROM summary_attempts WHERE id = ?", (row_id,)
    ).fetchone()
    return out(row)


@app.post("/summaries/{summary_id}/attempts")
def add_attempt(
    summary_id: str, body: AttemptIn, authorization: str | None = Header(None)
) -> dict[str, object]:
    return insert_attempt(user_id(authorization), summary_id, body)


def set_dismissed(
    uid: str, summary_id: str, attempt_id: str, at: float | None
) -> dict[str, object]:
    with db:
        db.execute(
            "UPDATE summary_attempts SET draft_dismissed_at = ?"
            " WHERE id = ? AND summary_id = ? AND user_id = ?",
            (at, attempt_id, summary_id, uid),
        )
    row = db.execute(
        "SELECT * FROM summary_attempts WHERE id = ? AND user_id = ?",
        (attempt_id, uid),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Attempt not found")
    return out(row)


@app.post("/summaries/{summary_id}/attempts/{attempt_id}/dismiss-draft")
def dismiss_draft(
    summary_id: str, attempt_id: str, authorization: str | None = Header(None)
) -> dict[str, object]:
    return set_dismissed(user_id(authorization), summary_id, attempt_id, time.time())


@app.post("/summaries/{summary_id}/attempts/{attempt_id}/restore-draft")
def restore_draft(
    summary_id: str, attempt_id: str, authorization: str | None = Header(None)
) -> dict[str, object]:
    return set_dismissed(user_id(authorization), summary_id, attempt_id, None)


# --- Runs on the server (variant F) -----------------------------------------
#
# A retry runs here, not in the browser, so a sleeping laptop or a closed tab
# does not cut it: the page starts a run and watches it over SSE, and a page
# opened later finds the run still going and attaches. The run is stubbed (no
# provider call): it streams made-up report text and ends the way `outcome`
# says, writing its attempt row like a real one would. The real build is a
# worker job, watched over SSE the way sync jobs are.

SAMPLE_REPORT = """This briefing covers the window's most reported developments across the selected channels.

## Executive Summary

Shipping through the strait slowed for a third day as insurers raised war-risk premiums, and two carriers rerouted around the cape. Regional channels reported a new round of talks, though official outlets have not confirmed a date. Fuel prices in border provinces rose for the second week running.

## Security

- **Port strikes:** Several channels reported strikes near the northern port; casualty figures differ widely between sources.
- **Air defence:** Interceptions were claimed over two cities overnight. State-affiliated media confirmed one and denied the other.
- **Border incidents:** Two crossings closed for several hours after an exchange of fire; both reopened by evening.

## Economy

- **Currency:** The free-market rate weakened again, with exchange houses limiting cash sales.
- **Energy:** Rolling outages returned to three provinces as demand outpaced supply during the heat.

## What to watch

Whether the talks get a date, how insurers price the next week of transits, and whether the outages spread to the capital."""


class RunIn(BaseModel):
    outcome: Literal["quota", "timeout", "cut", "succeed"]
    model: str
    keyId: str | None = None
    auto: bool = False


runs: dict[str, dict[str, object]] = {}


def run_out(r: dict[str, object]) -> dict[str, object]:
    return {k: v for k, v in r.items() if k != "user_id"}


async def simulate(run: dict[str, object]) -> None:
    outcome = run["outcome"]
    words = SAMPLE_REPORT.split(" ")
    cut = len(words)
    if outcome == "cut":
        cut = int(len(words) * random.uniform(0.35, 0.8))
    await asyncio.sleep(1.0)
    attempt: AttemptIn
    if outcome == "quota":
        attempt = AttemptIn(
            outcome="failed",
            kind="quota",
            error="The AI provider failed: 429 RESOURCE_EXHAUSTED. You exceeded your"
            " current quota, please check your plan and billing details.",
            model=str(run["model"]),
            keyId=run["keyId"],  # type: ignore[arg-type]
            auto=bool(run["auto"]),
        )
    elif outcome == "timeout":
        await asyncio.sleep(3)
        attempt = AttemptIn(
            outcome="failed",
            kind="transient",
            error="The AI provider failed: 503 Service Unavailable. The model is"
            " overloaded. Retry after 8 seconds.",
            model=str(run["model"]),
            keyId=run["keyId"],  # type: ignore[arg-type]
            auto=bool(run["auto"]),
        )
    else:
        for i in range(cut):
            run["text"] = " ".join(words[: i + 1])
            await asyncio.sleep(0.12)
        attempt = AttemptIn(
            outcome="succeeded" if outcome == "succeed" else "failed",
            kind=None if outcome == "succeed" else "transient",
            error=None
            if outcome == "succeed"
            else "The stream ended early: connection reset by peer.",
            model=str(run["model"]),
            keyId=run["keyId"],  # type: ignore[arg-type]
            partialText=str(run["text"]),
            auto=bool(run["auto"]),
        )
    run["attempt"] = insert_attempt(
        str(run["user_id"]), str(run["summaryId"]), attempt
    )
    run["status"] = "done"


@app.post("/summaries/{summary_id}/runs")
async def start_run(
    summary_id: str, body: RunIn, authorization: str | None = Header(None)
) -> dict[str, object]:
    uid = user_id(authorization)
    for r in runs.values():
        if r["summaryId"] == summary_id and r["status"] == "running":
            raise HTTPException(409, "A run is already going for this Summary")
    run: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "summaryId": summary_id,
        "user_id": uid,
        "status": "running",
        "text": "",
        "outcome": body.outcome,
        "model": body.model,
        "keyId": body.keyId,
        "auto": body.auto,
        "startedAt": int(time.time() * 1000),
        "attempt": None,
    }
    runs[str(run["id"])] = run
    asyncio.create_task(simulate(run))
    return run_out(run)


@app.get("/summaries/{summary_id}/runs/active")
def active_run(
    summary_id: str, authorization: str | None = Header(None)
) -> dict[str, object] | None:
    uid = user_id(authorization)
    for r in runs.values():
        if (
            r["summaryId"] == summary_id
            and r["user_id"] == uid
            and r["status"] == "running"
        ):
            return run_out(r)
    return None


@app.get("/runs/{run_id}/events")
async def run_events(
    run_id: str, authorization: str | None = Header(None)
) -> StreamingResponse:
    uid = user_id(authorization)
    run = runs.get(run_id)
    if run is None or run["user_id"] != uid:
        raise HTTPException(404, "Run not found")

    async def events() -> AsyncIterator[str]:
        sent = None
        while True:
            snapshot = (run["status"], run["text"])
            if snapshot != sent:
                sent = snapshot
                yield f"data: {json.dumps(run_out(run))}\n\n"
            if run["status"] == "done":
                return
            await asyncio.sleep(0.15)

    return StreamingResponse(events(), media_type="text/event-stream")


# --- Context windows (variant F) --------------------------------------------
#
# OpenRouter's catalogue is public and carries each model's context length;
# Gemini's own ids are mapped by rule. The real build should carry
# `context_length` on `POST /ai/models`, which already proxies each Key's list.

_ctx_cache: dict[str, int] = {}


@app.get("/context-lengths")
def context_lengths() -> dict[str, int]:
    if not _ctx_cache:
        r = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
        for m in r.json().get("data", []):
            if m.get("context_length"):
                _ctx_cache[m["id"]] = int(m["context_length"])
    return _ctx_cache


@app.get("/failed")
def failed(authorization: str | None = Header(None)) -> list[dict[str, object]]:
    """Summaries whose latest attempt failed: the `failed` status, derived."""
    uid = user_id(authorization)
    rows = db.execute(
        """
        SELECT a.summary_id, a.attempt, a.kind, a.created_at
        FROM summary_attempts a
        WHERE a.user_id = ? AND a.outcome = 'failed' AND a.attempt = (
          SELECT MAX(attempt) FROM summary_attempts b
          WHERE b.summary_id = a.summary_id
        )
        """,
        (uid,),
    ).fetchall()
    return [
        {
            "summaryId": r["summary_id"],
            "attempts": r["attempt"],
            "kind": r["kind"],
            "at": int(r["created_at"] * 1000),
        }
        for r in rows
    ]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
