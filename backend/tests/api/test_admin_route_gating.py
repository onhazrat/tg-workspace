"""Ticket 18: a newly registered account cannot administer the deployment.

The routes here answer for the whole installation rather than for one account:
database statistics, clearing a table, import, export, the proxy list, the log
purge, the scheduler, and the network logs. Every one of them was reachable by
any authenticated person, which on a single-operator deployment was invisible
and on an open registration is the whole problem.

Three failure modes, and only the first is obvious.

* **A route is not gated.** Caught by `test_a_plain_user_is_refused`, route by
  route. Running it against `DELETE /data/tables/{name}` is safe *because* the
  route is gated: a refusal happens in the dependency, before the handler, so a
  passing test never clears a table. If the gate is ever removed this test
  fails, and it fails having cleared a table in the test database, which is the
  correct amount of alarming.
* **Everything is gated, including the Admin.** A ticket whose checkboxes say
  "rejects a non-Admin" is trivially satisfied by breaking the routes for
  everybody. `test_an_admin_still_reaches_it` is the other direction.
* **The gate is added to today's routes and forgotten on tomorrow's.** That is
  what `test_every_admin_module_route_is_gated` is for: it walks what is
  actually mounted, not a list somebody remembered to update, so a new route in
  `routes/data/admin.py` has to be gated or excused with a reason.

The log routes get their own pair, because there the gate is *inside* one
handler serving five types. "Network is refused" without "publish is not" would
pass just as well if the whole family became Admin-only, which would be a
different and much worse change.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.routing import APIRoute, _IncludedRouter
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.deps import require_permission
from app.core.config import settings
from app.core.db import engine
from app.core.permissions import Permission
from app.main import app
from app.models_tg import SyncJob
from app.services.logs import (
    LOG_MODELS,
    SHARED_LOG_TYPES,
    upsert_embedding_log,
    upsert_llm_log,
    upsert_network_log,
    upsert_publish_log,
    upsert_sync_log,
)
from app.services.tenancy import Scope, scope_of
from tests.utils.user import create_random_user

PREFIX = settings.API_V1_STR

#: The refusal `require_permission` gives. Asserted rather than just the status
#: code because 403 is also what the approval gate answers, and a test that
#: cannot tell those apart would keep passing if the permission check were
#: deleted from an unapproved account's route.
NO_PRIVILEGES = "The user doesn't have enough privileges"

_UPSERTS = {
    "publish": upsert_publish_log,
    "sync": upsert_sync_log,
    "llm": upsert_llm_log,
    "embedding": upsert_embedding_log,
    "network": upsert_network_log,
}

#: Every administrative route, with a body where the method needs one.
#:
#: Destructive entries are deliberately included. A plain user's request is
#: refused by the dependency before the handler runs, so this list costs
#: nothing to execute — and the day that stops being true is the day the test
#: is supposed to fail.
ADMIN_ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", f"{PREFIX}/data/stats", None),
    ("GET", f"{PREFIX}/data/table-sizes", None),
    ("DELETE", f"{PREFIX}/data/tables/summaries", None),
    ("POST", f"{PREFIX}/data/import", {}),
    ("GET", f"{PREFIX}/data/export", None),
    ("GET", f"{PREFIX}/data/settings/network", None),
    ("PUT", f"{PREFIX}/data/settings/network", {}),
    ("DELETE", f"{PREFIX}/data/logs?type=publish&clearAll=true", None),
    ("GET", f"{PREFIX}/data/logs/network", None),
    ("GET", f"{PREFIX}/data/logs/network/nonexistent-id", None),
    ("GET", f"{PREFIX}/jobs/status", None),
    ("POST", f"{PREFIX}/jobs/retention/trigger", None),
    ("PUT", f"{PREFIX}/jobs/retention", {"enabled": True}),
]

#: Administrative routes an Admin is checked against too. A subset, because the
#: point of that direction is "the gate did not lock everyone out" and proving
#: it does not require importing a database dump or triggering the retention
#: sweep against a live scheduler on the way past.
ADMIN_REACHABLE: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", f"{PREFIX}/data/stats", None),
    ("GET", f"{PREFIX}/data/table-sizes", None),
    ("GET", f"{PREFIX}/data/settings/network", None),
    ("GET", f"{PREFIX}/data/logs/network", None),
    ("GET", f"{PREFIX}/jobs/status", None),
]


@pytest.fixture
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the tenancy seam on for one test. See `test_tenancy_seam.py`.

    The ownership tests below need it: `assert_owner` is a no-op while the flag
    is off, so without this they would assert the *current* behaviour rather
    than the behaviour the flag will switch on, and pass either way.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


def _call(
    client: TestClient,
    method: str,
    path: str,
    body: dict[str, Any] | None,
    headers: dict,
) -> Any:
    if method == "GET":
        return client.get(path, headers=headers)
    if method == "PUT":
        return client.put(path, json=body, headers=headers)
    if method == "DELETE":
        return client.delete(path, headers=headers)
    return client.post(path, json=body, headers=headers)


@pytest.mark.security
@pytest.mark.parametrize(
    "method,path,body", ADMIN_ROUTES, ids=lambda value: str(value).replace("/", "|")
)
def test_a_plain_user_is_refused(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    """The ticket in one line: a newly registered account cannot get in here."""
    response = _call(client, method, path, body, normal_user_token_headers)
    assert response.status_code == 403, (
        f"{method} {path} answered {response.status_code} for an account with "
        f"no permissions: {response.text[:200]}"
    )
    assert response.json()["detail"] == NO_PRIVILEGES, (
        f"{method} {path} refused for some other reason than a missing "
        f"permission: {response.json().get('detail')!r}"
    )


@pytest.mark.security
@pytest.mark.parametrize(
    "method,path,body", ADMIN_REACHABLE, ids=lambda value: str(value).replace("/", "|")
)
def test_an_admin_still_reaches_it(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    """Gating everything for everybody would satisfy the checkbox and be wrong."""
    response = _call(client, method, path, body, superuser_token_headers)
    assert response.status_code < 400, (
        f"{method} {path} answered {response.status_code} for the Admin: "
        f"{response.text[:200]}"
    )


# --------------------------------------------------- both directions on logs


@pytest.mark.security
def test_a_plain_user_reads_their_own_log_types(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """The four owned types stay open; only `network` is Admin-only.

    Without this, making the whole `/data/logs/{type}` family Admin-only would
    pass every other test in this file. Publish, sync, LLM and embedding logs
    are things an account produced, and taking them away is not what ticket 18
    asks for — the tenancy seam narrows them to the caller's own rows instead.
    """
    for log_type in ("publish", "sync", "llm", "embedding"):
        response = client.get(
            f"{PREFIX}/data/logs/{log_type}", headers=normal_user_token_headers
        )
        assert response.status_code == 200, (
            f"a plain user cannot read their own {log_type} logs: "
            f"{response.status_code} {response.text[:200]}"
        )


@pytest.mark.security
def test_writing_a_log_is_not_admin_only(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """`POST /data/logs/{type}` is open, network telemetry included.

    The first cut of this ticket gated the network write alongside the read.
    Six frontend flows record network telemetry and `writeLog` swallows a
    failure with a `console.warn`, so that change refused nothing visibly and
    silently stopped recording a non-Admin's telemetry.

    Open is **not** the same as unowned: `create_logs` refuses a write that
    lands on somebody else's row, which is the test below. This docstring used
    to say the route was safe because it "stamps the caller" — the sentence that
    made the hole look considered.
    """
    for log_type, row in (
        ("publish", {"id": "gating-test-log", "summary_id": "s", "timestamp": 1}),
        ("network", {"id": "gating-test-net", "url": "u", "timestamp": 1}),
    ):
        response = client.post(
            f"{PREFIX}/data/logs/{log_type}",
            json=[row],
            headers=normal_user_token_headers,
        )
        assert response.status_code == 200, (
            f"a plain user cannot record a {log_type} log: {response.text[:200]}"
        )


@pytest.mark.security
@pytest.mark.parametrize("log_type", ["publish", "sync", "llm", "embedding", "network"])
def test_a_write_cannot_take_over_another_accounts_row(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    enforced: None,
    log_type: str,
) -> None:
    """The write was in scope and the ticket's checkboxes did not say so.

    Every `upsert_*_log` merges into whatever row its id names *and reassigns
    `user_id` on the way past*, so scoping the read over a writable row leaves
    the family one guessed id away: post another account's log id, overwrite the
    row, become its owner, and every read guard still passes. Ticket 17 found
    the identical shape in the four artifact families.
    """
    victim = _new_user_id()
    log_id = f"takeover-{log_type}"
    _seed_log(log_type, log_id, victim)

    response = client.post(
        f"{PREFIX}/data/logs/{log_type}",
        json=[{"id": log_id, "timestamp": 2, "status": "pwned"}],
        headers=normal_user_token_headers,
    )
    assert response.status_code == 404, (
        f"a plain user overwrote another account's {log_type} log: "
        f"{response.status_code} {response.text[:200]}"
    )
    # The harm is the overwrite, so that is what every type asserts. A 404 that
    # arrives *after* the row was merged would satisfy the status check alone.
    assert _row_field(log_type, log_id, "status") != "pwned", (
        f"the {log_type} row was overwritten before the refusal"
    )

    if scope_of(LOG_MODELS[log_type][0]) is Scope.USER_OWNED:
        assert _owner_of(log_type, log_id) == victim, "the row changed hands"
    else:
        # Ticket 19: a sync log has no owner to change hands. What has to hold
        # instead is that the refusal came from the Follow rather than from
        # nothing at all — asserted against the Channel in
        # `tests/services/test_sync_log_channel_telemetry.py`, which can build
        # real follows. Here the row simply has to survive.
        assert _owner_of(log_type, log_id) is None, (
            f"{log_type} logs are follow-scoped and must carry no owner"
        )


@pytest.mark.security
def test_a_write_to_a_new_id_still_creates(
    client: TestClient, normal_user_token_headers: dict[str, str], enforced: None
) -> None:
    """An absent id creates, which is what keeps an upsert an upsert."""
    response = client.post(
        f"{PREFIX}/data/logs/publish",
        json=[{"id": "brand-new-log-id", "summary_id": "s", "timestamp": 1}],
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200, response.text[:200]


# ------------------------------------------------- deployment policy settings


#: Global settings keys a plain user must not be able to write. `retention` is
#: the one that matters most: `postRetentionDays: 1` deletes every account's
#: Posts on the next sweep, which is table clearing on a timer — and "cannot
#: reach table clearing" is this ticket's stated goal.
GLOBAL_SETTING_WRITES: list[tuple[str, dict[str, Any]]] = [
    ("retention", {"postRetentionDays": 1}),
    ("jobs", {"auto_sync": False}),
    ("sync_runtime", {"autoSyncPauseUntil": 99999999999999}),
    ("translation", {"enabled": False}),
    ("media", {"maxCacheMb": 1}),
]


@pytest.mark.security
@pytest.mark.parametrize("key,body", GLOBAL_SETTING_WRITES, ids=lambda v: str(v)[:24])
def test_a_plain_user_cannot_write_deployment_policy(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    key: str,
    body: dict[str, Any],
) -> None:
    response = client.put(
        f"{PREFIX}/data/settings/{key}", json=body, headers=normal_user_token_headers
    )
    assert response.status_code == 403, (
        f"a plain user wrote the deployment's {key} settings: "
        f"{response.status_code} {response.text[:200]}"
    )


@pytest.mark.security
def test_an_admin_can_write_deployment_policy(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The other direction — the settings page still works for the operator."""
    response = client.put(
        f"{PREFIX}/data/settings/retention",
        json={"postRetentionDays": 30},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200, response.text[:200]


@pytest.mark.security
def test_the_sync_facade_keeps_a_persons_own_preferences(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """`sync` is one body with two audiences, so it is narrowed, not refused.

    A plain user saving the sync section keeps the half the registry declares
    personal and loses the deployment half. Refusing outright would mean a
    person cannot choose where their own follows start scraping from.
    """
    response = client.put(
        f"{PREFIX}/data/settings/sync",
        json={"globalStartTimeMode": "days", "syncConcurrency": 99},
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200, response.text[:200]
    value = response.json()["value"]
    assert value["globalStartTimeMode"] == "days"
    assert value["syncConcurrency"] != 99, (
        "a plain user set the deployment's sync concurrency through the facade"
    )


# -------------------------------------------------------- the log purge split


@pytest.mark.security
def test_deleting_one_of_your_own_log_rows_is_not_administrative(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """The delete button on all five Logs tabs calls this, for everybody.

    Gating the whole `DELETE /data/logs` route turned that into an error toast
    for any non-Admin. Only the two sweep branches are deployment-wide.
    """
    me = client.get(f"{PREFIX}/users/me", headers=normal_user_token_headers).json()
    _seed_log("publish", "my-own-row", uuid.UUID(me["id"]))

    response = client.delete(
        f"{PREFIX}/data/logs?type=publish&logId=my-own-row",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200, response.text[:200]
    assert response.json()["deleted"] == 1


@pytest.mark.security
def test_deleting_another_accounts_log_row_is_not_found(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    enforced: None,
) -> None:
    """Owner-checked before the delete, so it cannot remove then deny."""
    _seed_log("publish", "not-my-row", _new_user_id())

    response = client.delete(
        f"{PREFIX}/data/logs?type=publish&logId=not-my-row",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 404, response.text[:200]
    assert _row_exists("publish", "not-my-row"), (
        "the row was deleted before the ownership check ran"
    )


@pytest.mark.security
@pytest.mark.parametrize("log_type", sorted(SHARED_LOG_TYPES))
def test_deleting_a_row_nobody_owns_is_administrative(
    client: TestClient, normal_user_token_headers: dict[str, str], log_type: str
) -> None:
    """Ticket 19: for a shared type there is no owner for the check to consult.

    A sync log is telemetry every Follower of the Channel can read, so a
    Follower deleting one destroys the record for all of them — ticket 20's own
    checkbox says one person can never delete another's evidence. Network logs
    reach the same gate from the other side: their *reads* went Admin-only in
    ticket 18 while this branch stayed open, so any authenticated account could
    delete a proxy log one row at a time without ever being able to read one.

    Parametrised over `SHARED_LOG_TYPES` rather than a literal pair, so a type
    reclassified in the seam arrives here on its own instead of being remembered.
    """
    log_id = f"shared-delete-{log_type}"
    _seed_log(log_type, log_id, _new_user_id())

    response = client.delete(
        f"{PREFIX}/data/logs?type={log_type}&logId={log_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403, (
        f"a plain user deleted a {log_type} log row nobody owns: "
        f"{response.status_code} {response.text[:200]}"
    )
    assert response.json()["detail"] == NO_PRIVILEGES
    assert _row_exists(log_type, log_id), "the row went before the gate ran"


@pytest.mark.security
@pytest.mark.parametrize("log_type", sorted(SHARED_LOG_TYPES))
def test_an_admin_still_deletes_a_row_nobody_owns(
    client: TestClient, superuser_token_headers: dict[str, str], log_type: str
) -> None:
    """Refusing everybody would satisfy the test above and be an outage."""
    log_id = f"shared-delete-admin-{log_type}"
    _seed_log(log_type, log_id, _new_user_id())

    response = client.delete(
        f"{PREFIX}/data/logs?type={log_type}&logId={log_id}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200, response.text[:200]
    assert response.json()["deleted"] == 1
    assert not _row_exists(log_type, log_id)


@pytest.mark.security
def test_the_owned_types_did_not_join_the_admin_gate(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """The gate is per type, and moving it to the route would pass the pair above.

    `publish` is the canary: it is still one row of your own, and ticket 18's
    argument that deleting one is not an administrative act is untouched here.
    """
    assert "publish" not in SHARED_LOG_TYPES

    me = client.get(f"{PREFIX}/users/me", headers=normal_user_token_headers).json()
    _seed_log("publish", "still-mine-to-delete", uuid.UUID(me["id"]))

    response = client.delete(
        f"{PREFIX}/data/logs?type=publish&logId=still-mine-to-delete",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200, response.text[:200]


# ------------------------------------------------- the job nobody owns (23)


def _seed_log(log_type: str, log_id: str, owner: uuid.UUID) -> None:
    """Write one log row and close the session before the request goes out.

    Deliberately not the `db` fixture. A session that has read since its last
    commit sits `idle in transaction`, and the autouse TRUNCATE that cleans
    `tg_*` between tests then blocks on it forever — the suite hangs with no
    traceback and no failing assertion. Opening and closing around each touch
    is the only version of this that cannot do that.
    """
    with Session(engine) as session:
        _UPSERTS[log_type](session, {"id": log_id, "timestamp": 1}, owner)
        session.commit()


def _owner_of(log_type: str, log_id: str) -> uuid.UUID | None:
    with Session(engine) as session:
        row = session.get(LOG_MODELS[log_type][0], log_id)
        return None if row is None else row.user_id


def _row_field(log_type: str, log_id: str, field: str) -> Any:
    with Session(engine) as session:
        row = session.get(LOG_MODELS[log_type][0], log_id)
        return None if row is None else getattr(row, field, None)


def _row_exists(log_type: str, log_id: str) -> bool:
    with Session(engine) as session:
        return session.get(LOG_MODELS[log_type][0], log_id) is not None


def _new_user_id() -> uuid.UUID:
    with Session(engine) as session:
        created = create_random_user(session)
        session.commit()
        return created.id


def _insert_job(db: Session, job_id: str, owner: uuid.UUID | None) -> str:
    """A sync job row, straight into the table.

    `get_job` falls back to the row when no process is running the job, which is
    exactly the state a scheduled job is in as far as the API is concerned.
    Going through `POST /jobs/sync` instead would need channels, a queue and a
    worker to say anything about who may *read* the result.
    """
    db.add(SyncJob(id=job_id, user_id=owner, status="pending", source="test"))
    db.commit()
    return job_id


#: The sync-job routes exercised through the client. `/events` is deliberately
#: absent: it is an SSE stream, and if the gate on it ever *fails* the test
#: client has no way to bound the read, so this test would hang instead of
#: failing. A guard whose failure mode is a hung suite teaches nobody anything.
#: `test_every_sync_job_route_checks_visibility` covers that route structurally
#: instead, which fails in milliseconds and names the handler.
JOB_ROUTE_SUFFIXES = [("", "GET"), ("/cancel", "POST")]


@pytest.mark.security
@pytest.mark.parametrize("suffix,method", JOB_ROUTE_SUFFIXES)
def test_a_sync_job_nobody_owns_is_admin_only(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    suffix: str,
    method: str,
) -> None:
    """Decision 23: a scheduled job keeps a null owner and leaks only to an Admin.

    The null owner is what makes this an authorisation question rather than a
    row-visibility one — there is no account it could belong to, so there is
    nothing for a 404 to protect and 403 is the honest answer.
    """
    job_id = _insert_job(db, f"gate-scheduled{suffix.replace('/', '-')}", None)
    response = _call(
        client,
        method,
        f"{PREFIX}/jobs/sync/{job_id}{suffix}",
        None,
        normal_user_token_headers,
    )
    assert response.status_code == 403, (
        f"a plain user reached a scheduled job at {suffix or '/'}: "
        f"{response.status_code} {response.text[:200]}"
    )


@pytest.mark.security
def test_your_own_sync_job_is_still_yours(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    """The other direction, and the one that would break the app if it were wrong.

    Every sync a person starts is watched through these three routes. Refusing
    them their own job would satisfy "a non-Admin is rejected" and make the
    product unusable, which is why this sits next to the test above.
    """
    me = client.get(f"{PREFIX}/users/me", headers=normal_user_token_headers).json()
    job_id = _insert_job(db, "gate-my-own-job", uuid.UUID(me["id"]))

    response = client.get(
        f"{PREFIX}/jobs/sync/{job_id}", headers=normal_user_token_headers
    )
    assert response.status_code == 200, response.text[:200]
    assert response.json()["jobId"] == job_id


@pytest.mark.security
def test_every_sync_job_route_checks_visibility() -> None:
    """All three routes under `/sync/{job_id}`, including the stream.

    Reads the module rather than calling it, because the SSE route cannot be
    refused-and-bounded through the test client. The check is "this handler
    calls `_visible_job`", which is coarse — but the alternative is a fourth
    route on this path appearing with no check at all, and nothing noticing
    until a person can watch somebody else's sync.
    """
    import ast
    import pathlib

    module = pathlib.Path(__file__).resolve().parents[2] / "app/api/routes/jobs.py"
    tree = ast.parse(module.read_text())

    handlers = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
        and any(
            isinstance(deco, ast.Call)
            and deco.args
            and isinstance(deco.args[0], ast.Constant)
            and str(deco.args[0].value).startswith("/sync/{job_id}")
            for deco in node.decorator_list
        )
    ]
    assert len(handlers) == 3, (
        f"expected the three /sync/{{job_id}} routes, found {len(handlers)} — "
        "this guard is looking at the wrong thing"
    )

    unchecked = [
        handler.name
        for handler in handlers
        if not any(
            isinstance(node, ast.Name) and node.id == "_visible_job"
            for node in ast.walk(handler)
        )
    ]
    assert not unchecked, (
        f"these sync-job handlers never ask whether the caller may see the "
        f"job: {unchecked}"
    )


@pytest.mark.security
def test_an_admin_reaches_the_scheduled_job(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    job_id = _insert_job(db, "gate-scheduled-for-admin", None)
    response = client.get(
        f"{PREFIX}/jobs/sync/{job_id}", headers=superuser_token_headers
    )
    assert response.status_code == 200, response.text[:200]


# ------------------------------------------------------------- the structural


def _effective_routes() -> list[Any]:
    """Every route the app actually serves, with its dependencies merged in.

    This FastAPI version keeps included routers nested as `_IncludedRouter`
    rather than flattening them into `APIRoute`s, so walking `app.routes` finds
    nothing at all — `test_route_inventory.py` hit the same wall and went to
    `app.openapi()` instead. That is no use here, because the generated document
    says nothing about dependencies. The effective-route view is the one place
    the *merged* picture exists: a gate mounted on the router and a gate on the
    route look the same from here, which is exactly right, because they are the
    same promise to a caller.

    The `APIRoute` branch is the fallback for a FastAPI that flattens again. It
    is not dead code so much as the thing that stops this guard from silently
    finding nothing on an upgrade — and the callers assert non-emptiness, so a
    third representation fails loudly rather than passing vacuously.
    """
    nested = [
        context
        for route in app.routes
        if isinstance(route, _IncludedRouter)
        for context in route.effective_route_contexts()
    ]
    return nested or [route for route in app.routes if isinstance(route, APIRoute)]


def _required_permissions(route: Any) -> set[Permission]:
    """Every permission the route demands, however deeply it is nested.

    Walks the whole dependency tree rather than `route.dependencies`, because a
    gate mounted on the router, on the route, or inside another dependency are
    all the same promise to a caller and only one of them shows up in the
    shallow list.
    """
    found: set[Permission] = set()
    stack = list(route.dependant.dependencies)
    while stack:
        dependency = stack.pop()
        call = dependency.call
        if isinstance(call, require_permission):
            found.add(call.required_permission)
        stack.extend(dependency.dependencies)
    return found


#: Routes in `routes/data/admin.py` that are deliberately not Admin-only, and
#: why. An exemption nothing explains becomes a leftover nobody dares touch.
UNGATED_ADMIN_MODULE_ROUTES: dict[tuple[str, str], str] = {
    ("GET", f"{PREFIX}/data/settings/{{key}}"): (
        "A facade over both settings tables. `sync` reassembles deployment "
        "policy, scheduler runtime and the caller's own preferences into one "
        "blob, so an Admin-only read would take a person's own sync "
        "preferences away from them. Authorising it properly means deciding "
        "per field, through `settings_registry`, which is settings work rather "
        "than ticket 18's."
    ),
    ("PUT", f"{PREFIX}/data/settings/{{key}}"): (
        "Gated per *key* inside the handler rather than on the route, which is "
        "why no dependency is visible here. A global key demands DATA_ADMIN; "
        "the `sync` facade cannot, because one body carries deployment policy, "
        "scheduler runtime and the caller's own preferences, so it is narrowed "
        "to the registry's per-User fields instead. "
        "`test_a_plain_user_cannot_write_deployment_policy` and "
        "`test_the_sync_facade_keeps_a_persons_own_preferences` are the checks "
        "this structural guard cannot make."
    ),
}


def _admin_module_routes() -> list[Any]:
    return [
        route
        for route in _effective_routes()
        if route.endpoint.__module__ == "app.api.routes.data.admin"
    ]


@pytest.mark.security
def test_every_admin_module_route_is_gated() -> None:
    """`routes/data/admin.py` is administrative by definition.

    Walks what is mounted rather than a hand-kept list, so the route somebody
    adds next month is covered by this without anyone remembering to add it.
    """
    routes = _admin_module_routes()
    assert routes, "found no routes from routes/data/admin.py — guard is blind"

    ungated = sorted(
        f"{method} {route.path}"
        for route in routes
        for method in sorted(route.methods or set())
        if not _required_permissions(route)
        and (method, route.path) not in UNGATED_ADMIN_MODULE_ROUTES
    )
    assert not ungated, (
        "these routes in routes/data/admin.py are reachable by any approved "
        "account. Gate them with `require_permission`, or add them to "
        "UNGATED_ADMIN_MODULE_ROUTES with a reason:\n  " + "\n  ".join(ungated)
    )


@pytest.mark.security
def test_the_exemptions_still_name_real_routes() -> None:
    """The other direction: an exemption for a route that no longer exists.

    Left alone it reads as a considered decision forever, and quietly excuses
    whatever takes that path next.
    """
    mounted = {
        (method, route.path)
        for route in _admin_module_routes()
        for method in (route.methods or set())
    }
    stale = sorted(
        f"{method} {path}"
        for (method, path) in UNGATED_ADMIN_MODULE_ROUTES
        if (method, path) not in mounted
    )
    assert not stale, f"exemptions naming routes that are not mounted: {stale}"
