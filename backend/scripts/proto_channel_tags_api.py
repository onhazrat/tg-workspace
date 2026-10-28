"""PROTOTYPE (channel-tags-usage): `/data/channels/stats` with `lastPostAt`, standalone.

Serves this branch's channels router against a deployment's database through a
read-only role, so the local frontend can send `/api/v1/data/channels/stats`
here and everything else to the deployment's real API. Variant B's Tag use
and Tag counts are here too, under `/tags/*` (the frontend's `/proto/tags/*`):
use is written to `<schema>.tag_uses`, the one scratch table this API owns.
Identity is the deployment's own: the caller's bearer token is forwarded to
`PROTO_API_BASE/api/v1/users/me`.

    PROTO_API_BASE=https://<api-base> PROTO_PG_PORT=5433 PROTO_PG_USER=<role> PROTO_SCHEMA=<schema> \
        uv run python backend/scripts/proto_channel_tags_api.py

The password comes from ~/.pgpass. Throwaway: never mount this in the real API.
"""

import os
import time
import uuid
from pathlib import Path

import httpx

PG_HOST = "localhost"
PG_PORT = os.environ.get("PROTO_PG_PORT", "5433")
PG_USER = os.environ["PROTO_PG_USER"]
PG_DB = os.environ.get("PROTO_PG_DB", "app")
#: The scratch schema the role may write, the only place this API writes.
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
from fastapi import Depends, FastAPI, HTTPException, Request  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from sqlalchemy import event, text  # noqa: E402

from app.api.deps import CurrentUser, SessionDep, get_current_user  # noqa: E402
from app.api.routes.data import channels  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.services.telegram_web import normalize_handle  # noqa: E402
from app.models import User  # noqa: E402


@event.listens_for(engine, "connect")
def _no_parallel(dbapi_connection, _record):  # type: ignore[no-untyped-def]
    # The deployment's /dev/shm is small; a parallel hash join fails there.
    with dbapi_connection.cursor() as cursor:
        cursor.execute("SET max_parallel_workers_per_gather = 0")
    dbapi_connection.commit()


API_BASE = os.environ["PROTO_API_BASE"].rstrip("/")
_identities: dict[str, uuid.UUID] = {}


def proto_user(request: Request, session: SessionDep) -> User:
    auth = request.headers.get("authorization", "")
    if auth not in _identities:
        answer = httpx.get(
            f"{API_BASE}/api/v1/users/me", headers={"Authorization": auth}
        )
        if answer.status_code != 200:
            raise HTTPException(status_code=401, detail="Not authenticated")
        _identities[auth] = uuid.UUID(answer.json()["id"])
    user = session.get(User, _identities[auth])
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


app = FastAPI(title="PROTOTYPE channel tags API")
app.dependency_overrides[get_current_user] = proto_user
app.include_router(
    channels.router, prefix="/api/v1/data", dependencies=[Depends(proto_user)]
)

# PROTOTYPE, wipe me: one row per use of a Tag on a tab.
with engine.begin() as conn:
    conn.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS {SCHEMA}.tag_uses ("
            " user_id uuid NOT NULL, tab text NOT NULL, tag_key text NOT NULL,"
            " used_at bigint NOT NULL)"
        )
    )

# A use today counts 1, two weeks ago 0.5, a month ago 0.25.
HALF_LIFE_MS = 14 * 86_400_000


class TagUse(BaseModel):
    tab: str
    name: str


class TagRename(BaseModel):
    name: str
    to: str


class TagCountsRequest(BaseModel):
    #: The handles the tab lists; None for every channel, as the Directory.
    scope: list[str] | None = None
    selected: list[str] = []


@app.get("/tags/uses")
def tag_uses(tab: str, session: SessionDep, user: CurrentUser) -> dict[str, dict[str, float]]:
    """Each Tag key's decayed use on `tab` and its last use."""
    rows = session.execute(
        text(
            "SELECT tag_key, max(used_at),"
            " sum(power(0.5, (:now - used_at)::float8 / :half))"
            f" FROM {SCHEMA}.tag_uses WHERE user_id = :user AND tab = :tab"
            " GROUP BY tag_key"
        ),
        {"now": int(time.time() * 1000), "half": HALF_LIFE_MS, "user": user.id, "tab": tab},
    ).all()
    return {key: {"last": last, "score": score} for key, last, score in rows}


@app.post("/tags/uses")
def add_tag_use(body: TagUse, session: SessionDep, user: CurrentUser) -> None:
    session.execute(
        text(f"INSERT INTO {SCHEMA}.tag_uses VALUES (:user, :tab, :key, :at)"),
        {"user": user.id, "tab": body.tab, "key": body.name.strip().lower(), "at": int(time.time() * 1000)},
    )
    session.commit()


@app.post("/tags/uses/rename")
def rename_tag_uses(body: TagRename, session: SessionDep, user: CurrentUser) -> None:
    """A rename is the Account's, so every tab's history follows the Tag."""
    session.execute(
        text(f"UPDATE {SCHEMA}.tag_uses SET tag_key = :to WHERE user_id = :user AND tag_key = :from"),
        {"user": user.id, "from": body.name.strip().lower(), "to": body.to.strip().lower()},
    )
    session.commit()


@app.post("/tags/counts")
def tag_counts(
    body: TagCountsRequest, session: SessionDep, user: CurrentUser
) -> dict[str, dict[str, int]]:
    """Per Tag key: its channels in `scope`, and how many of those are `selected`."""
    scope = None if body.scope is None else [normalize_handle(h) for h in body.scope]
    selected = [normalize_handle(h) for h in body.selected]
    rows = session.execute(
        text(
            "SELECT tag_key,"
            " count(*) FILTER (WHERE CAST(:scope AS text[]) IS NULL OR handle = ANY(:scope)),"
            " count(*) FILTER (WHERE handle = ANY(:selected)"
            "   AND (CAST(:scope AS text[]) IS NULL OR handle = ANY(:scope)))"
            " FROM tg_tags WHERE user_id = :user GROUP BY tag_key"
        ),
        {"user": user.id, "scope": scope, "selected": selected},
    ).all()
    return {key: {"total": total, "selected": sel} for key, total, sel in rows}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PROTO_PORT", "8215")))
