"""PROTOTYPE (posts-tab-improvements): the real `/data/posts*` routes, standalone.

Serves this branch's posts router against a deployment's database through a
read-only role, so the local frontend can send `/api/v1/data/posts*` here and
everything else to the deployment's real API. Identity is the deployment's own:
the caller's bearer token is forwarded to `PROTO_API_BASE/api/v1/users/me`.

    PROTO_API_BASE=https://<api-base> PROTO_PG_PORT=5433 PROTO_PG_USER=<role> \
        uv run python backend/scripts/proto_posts_api.py

The password comes from ~/.pgpass. Throwaway: never mount this in the real API.
"""

import os
import uuid
from pathlib import Path

import httpx

PG_HOST = "localhost"
PG_PORT = os.environ.get("PROTO_PG_PORT", "5433")
PG_USER = os.environ["PROTO_PG_USER"]
PG_DB = os.environ.get("PROTO_PG_DB", "app")


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
    DB_POOL_SIZE="4",
    DB_MAX_OVERFLOW="0",
)

import uvicorn  # noqa: E402
from fastapi import Depends, FastAPI, HTTPException, Request  # noqa: E402
from sqlalchemy import event  # noqa: E402

from app.api.deps import SessionDep, get_current_user  # noqa: E402
from app.api.routes.data import posts  # noqa: E402
from app.core.db import engine  # noqa: E402
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


app = FastAPI(title="PROTOTYPE posts API")
app.dependency_overrides[get_current_user] = proto_user
app.include_router(
    posts.router, prefix="/api/v1/data", dependencies=[Depends(proto_user)]
)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PROTO_PORT", "8011")))
