"""PROTOTYPE (history-tab-redesign): when Artifacts were Written, as a spread.

Serves `GET /api/v1/data/artifacts/spread` against a deployment's database
through a read-only role, so the local frontend can draw a spread in History's
Written popover while every other route goes to the deployment's real API.
Identity is the deployment's own: the caller's bearer token is forwarded to
`PROTO_API_BASE/api/v1/users/me`.

    PROTO_API_BASE=https://<api-base> PROTO_PG_PORT=5433 PROTO_PG_USER=<role> \
        uv run python backend/scripts/proto_history_api.py

The password comes from ~/.pgpass. Throwaway: never mount this in the real API.
"""

import os
import uuid
from pathlib import Path
from typing import Annotated, Literal

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
    DB_POOL_SIZE="2",
    DB_MAX_OVERFLOW="0",
)

import uvicorn  # noqa: E402
from fastapi import Depends, FastAPI, HTTPException, Query, Request  # noqa: E402
from pydantic import TypeAdapter  # noqa: E402
from sqlalchemy import BigInteger, cast, event, func, union_all  # noqa: E402
from sqlalchemy import select as sa_select  # noqa: E402

from app.api.deps import SessionDep  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.models import User  # noqa: E402
from app.schemas.artifacts import ArtifactListItemResponse  # noqa: E402
from app.schemas.logs import LogBoundQuery, LogSpreadResponse  # noqa: E402
from app.services import artifacts  # noqa: E402
from app.services.logs import LogSpread, resolve_log_bound  # noqa: E402
from app.services.spread_bars import spread_range  # noqa: E402


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


app = FastAPI(title="PROTOTYPE history API")


def _legs(
    user_id: uuid.UUID,
    kind: str | None,
    search: str | None,
    starred: bool,
    status: str | None,
) -> list:  # type: ignore[type-arg]
    """`list_artifacts`' legs and filters, unordered and unpaged."""
    kinds = (kind,) if kind else artifacts.ARTIFACT_KINDS
    if status:
        kinds = tuple(k for k in kinds if k in artifacts._STATUS_KINDS[status])
    term = (search or "").strip()
    legs = []
    for one in kinds:
        leg = artifacts._LEGS[one](user_id)
        if term:
            leg = leg.where(artifacts._search(one, term))
        if starred:
            leg = leg.where(artifacts._starred(artifacts._MODELS[one]))
        if status:
            leg = leg.where(artifacts._STATUS_COLUMNS[one] == status)
        legs.append(leg)
    return legs


_ROWS: TypeAdapter[ArtifactListItemResponse] = TypeAdapter(ArtifactListItemResponse)

Kind = Literal["summary", "chat", "tag", "discovery"]
Status = Literal["failed", "pending"]
#: Which moment the time filter bounds: when the result was Written, or the
#: frozen Analysis window, which matches when it overlaps the bound.
Moment = Literal["written", "window"]


def _window_end(unioned, end: str):  # type: ignore[no-untyped-def]
    return cast(unioned.c.scope.op("->>")(end), BigInteger)


def _bounded(statement, unioned, moment: Moment, bound: LogBoundQuery):  # type: ignore[no-untyped-def]
    """The time filter, on Written or as an overlap with the Analysis window."""
    at = resolve_log_bound(bound.bound())
    if moment == "written":
        if at.start is not None:
            statement = statement.where(unioned.c.timestamp >= at.start)
        if at.end is not None:
            statement = statement.where(unioned.c.timestamp < at.end)
        return statement
    if at.start is not None:
        statement = statement.where(_window_end(unioned, "end") > at.start)
    if at.end is not None:
        statement = statement.where(_window_end(unioned, "start") < at.end)
    return statement


@app.get("/api/v1/data/artifacts/proto-list")
def artifact_list(
    session: SessionDep,
    user: Annotated[User, Depends(proto_user)],
    bound: Annotated[LogBoundQuery, Depends()],
    kind: Kind | None = Query(None),
    search: str | None = Query(None),
    starred: bool = Query(False),
    status: Status | None = Query(None),
    moment: Moment = Query("written"),
    sort: Literal["written", "window"] = Query("written"),
    descending: bool = Query(True),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[ArtifactListItemResponse]:
    """The History page with the time filter and the sort, server-side."""
    legs = _legs(user.id, kind, search, starred, status)
    if not legs:
        return []
    unioned = union_all(*legs).subquery("artifact")
    statement = _bounded(sa_select(unioned), unioned, moment, bound)
    key = (
        unioned.c.timestamp
        if sort == "written"
        # A Scope with no window sorts last either way.
        else _window_end(unioned, "start")
    )
    order = key.desc().nulls_last() if descending else key.asc().nulls_last()
    statement = statement.order_by(order, unioned.c.id).offset(offset).limit(limit)
    rows = session.execute(statement).mappings().all()
    return [_ROWS.validate_python(artifacts._row_to_camel(row)) for row in rows]


def _is_status(kind: str, status: str | None, wanted: str) -> bool:
    return kind in artifacts._STATUS_KINDS[wanted] and status == wanted


@app.get("/api/v1/data/artifacts/proto-counts")
def artifact_counts(
    session: SessionDep,
    user: Annotated[User, Depends(proto_user)],
    bound: Annotated[LogBoundQuery, Depends()],
    kind: Kind | None = Query(None),
    search: str | None = Query(None),
    starred: bool = Query(False),
    status: Status | None = Query(None),
    moment: Moment = Query("written"),
) -> dict[str, object]:
    """The footer's total, and each Kind and Status as a facet: counted under
    every other filter, so a count says what picking it would show.

    One statement, grouped by kind and status; the facets are summed here.
    """
    legs = _legs(user.id, None, search, starred, None)
    unioned = union_all(*legs).subquery("artifact")
    groups = session.execute(
        _bounded(
            sa_select(unioned.c.kind, unioned.c.status, func.count()),
            unioned,
            moment,
            bound,
        ).group_by(unioned.c.kind, unioned.c.status)
    ).all()

    def kind_ok(k: str) -> bool:
        return kind is None or k == kind

    def status_ok(k: str, st: str | None) -> bool:
        return status is None or _is_status(k, st, status)

    kinds = {k: 0 for k in artifacts.ARTIFACT_KINDS}
    statuses = {"failed": 0, "pending": 0}
    total = 0
    for k, st, n in groups:
        if status_ok(k, st):
            kinds[k] += n
        if kind_ok(k):
            for wanted in statuses:
                if _is_status(k, st, wanted):
                    statuses[wanted] += n
        if kind_ok(k) and status_ok(k, st):
            total += n
    return {
        "total": total,
        "kinds": kinds,
        "kindsAll": sum(kinds.values()),
        "statuses": statuses,
        "statusesAll": sum(n for k, st, n in groups if kind_ok(k)),
    }


@app.get("/api/v1/data/artifacts/spread")
def artifact_spread(
    session: SessionDep,
    user: Annotated[User, Depends(proto_user)],
    kind: Kind | None = Query(None),
    search: str | None = Query(None),
    starred: bool = Query(False),
    status: Status | None = Query(None),
    moment: Moment = Query("written"),
    lo: float | None = Query(None),
    hi: float | None = Query(None),
) -> LogSpreadResponse:
    """The time filter's spread under every History filter but the time.

    Written, or the Analysis window's start (a Scope with none is left out).
    32 bars, as the Logs spread; a zoom bins only its range.
    """
    legs = _legs(user.id, kind, search, starred, status)
    if not legs:
        return LogSpreadResponse(total=0, min=None, max=None, median=None, bins=[])
    unioned = union_all(*legs).subquery("artifact")
    value = (
        unioned.c.timestamp if moment == "written" else _window_end(unioned, "start")
    )
    total, low, high, median = session.execute(
        sa_select(
            func.count(value),
            func.min(value),
            func.max(value),
            func.percentile_cont(0.5).within_group(value),
        )
    ).one()
    covered = spread_range(low, high, (lo, hi) if lo is not None and hi is not None else None)
    bins = []
    if covered is not None:
        bar = covered.bar_of(value)
        counts = session.execute(
            sa_select(bar, func.count()).where(*covered.holds(value)).group_by(bar)
        ).all()
        bins = covered.bars({int(i): int(n) for i, n in counts})
    spread = LogSpread(
        total=int(total),
        min=None if low is None else int(low),
        max=None if high is None else int(high),
        median=None if median is None else float(median),
        bins=bins,
    )
    return LogSpreadResponse.model_validate(spread, from_attributes=True)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PROTO_PORT", "8013")))
