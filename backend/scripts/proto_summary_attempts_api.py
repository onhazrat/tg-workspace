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

import os
import sqlite3
import time
import uuid
from typing import Literal

import httpx
import uvicorn
from fastapi import FastAPI, Header, HTTPException
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


@app.post("/summaries/{summary_id}/attempts")
def add_attempt(
    summary_id: str, body: AttemptIn, authorization: str | None = Header(None)
) -> dict[str, object]:
    uid = user_id(authorization)
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


@app.post("/summaries/{summary_id}/attempts/{attempt_id}/dismiss-draft")
def dismiss_draft(
    summary_id: str, attempt_id: str, authorization: str | None = Header(None)
) -> dict[str, object]:
    uid = user_id(authorization)
    with db:
        db.execute(
            "UPDATE summary_attempts SET draft_dismissed_at = ?"
            " WHERE id = ? AND summary_id = ? AND user_id = ?",
            (time.time(), attempt_id, summary_id, uid),
        )
    row = db.execute(
        "SELECT * FROM summary_attempts WHERE id = ? AND user_id = ?",
        (attempt_id, uid),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Attempt not found")
    return out(row)


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
