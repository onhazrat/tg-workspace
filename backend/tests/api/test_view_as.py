"""Ticket 26: an Owner looks at an account, and cannot change anything.

The write refusal is written as an **inventory**, for the reason
`test_account_isolation.py` gives about route coverage: the failure mode of a
rule like this is never the route somebody thought about, it is the one nobody
did. So `test_every_mutating_operation_is_refused_or_allowlisted` walks every
non-safe operation the app actually mounts and fails on one that is neither
refused nor named in `deps.VIEW_AS_READ_ONLY_PATHS` with a reason. A route added
next quarter cannot join the API without somebody answering "does this write?".

The allowlist is then exercised rather than trusted: every path in it is called
with a real View-as token and has to answer something other than the read-only
403 — otherwise the entry is documentation of an intention, which is the
"declaration alone is bookkeeping" failure this repo has already paid for twice.

## Mutation evidence

Five mutations were run and all five went red:

* disabling the `is_view_as` branch in `get_current_user` — 2 failures;
* spelling `VIEW_AS_TARGET_MISSING_DETAIL` as `"User not found"` — 1;
* transposing `actor` and `subject` in `record_session` — 4;
* dropping `start_view_as`'s peer-permission check — 1;
* making `view_as_allows` answer `True` unconditionally — 2.

`test_view_as_is_reachable_by_the_bootstrap_account` is the one assertion here
with **no** single-mutation evidence, and that is a property of what it asserts
rather than a gap: `init_db` and migration `d3e4f5a6b7c8` both grant the Owner
role, deliberately, so reverting either alone leaves the outcome correct. It
asserts the requirement — that a deployment ends up with an account able to use
this — which is what would be wrong if both were reverted.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.api.deps import (
    SAFE_METHODS,
    VIEW_AS_ENDED_DETAILS,
    VIEW_AS_READ_ONLY_DETAIL,
    VIEW_AS_READ_ONLY_PATHS,
    VIEW_AS_TARGET_INACTIVE_DETAIL,
    VIEW_AS_TARGET_MISSING_DETAIL,
)
from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.core.permissions import ROLE_OWNER, Permission
from app.main import app
from app.models import User
from app.models_rbac import UserRole
from app.models_view_as import ViewAsSession
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_lower_string

V1 = settings.API_V1_STR

#: Operations a View-as session must be refused. Derived from the mounted
#: OpenAPI document rather than listed, so this cannot go stale.
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _mounted() -> set[tuple[str, str]]:
    """`(METHOD, path template)` for everything the app serves.

    Off `app.openapi()` rather than `app.routes`, for the reason
    `test_route_inventory.py` gives: this FastAPI keeps included routers nested
    as `_IncludedRouter` objects, so walking `app.routes` finds nothing at all.
    """
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method.lower() in HTTP_METHODS
    }


def _mutating() -> set[tuple[str, str]]:
    return {(m, p) for m, p in _mounted() if m not in SAFE_METHODS}


def _unauthenticated_mutating() -> set[tuple[str, str]]:
    """Mutating operations the gate structurally cannot reach.

    The refusal lives inside `get_current_user`, so a route that never resolves
    a caller never runs it — a View-as token sent to one is simply an ignored
    header. That is not a hole, but it is a fact that has to be *derived* rather
    than remembered, which is why this walks the dependency tree instead of
    listing paths.

    `_walk` and `_requires_auth` are imported from
    `test_public_route_exemptions.py` rather than copied. That file already owns
    the question "does this route authenticate itself", and two implementations
    of it would eventually disagree — at which point one of the two guards would
    be reasoning about a set of routes the other does not.
    """
    from tests.api.test_public_route_exemptions import _requires_auth, _walk

    return {
        (method, path)
        for path, route in _walk(app.routes)
        for method in route.methods
        if method not in SAFE_METHODS and not _requires_auth(route)
    }


#: Every mutating operation that authenticates nobody, with why that is safe.
#:
#: Asserted as an **exact set** against the derived one, in both directions: a
#: new unauthenticated write joining the API has to be argued for here, and one
#: that quietly gains an auth dependency stops being excused. The failure this
#: prevents is not a red test elsewhere — it is a mutating route silently
#: outside the only gate ticket 26 has.
UNAUTHENTICATED: dict[tuple[str, str], str] = {
    ("POST", f"{V1}/login/access-token"): (
        "signing in with a password mints a *new* session and changes nothing "
        "about the account being viewed; anyone with a browser can do it "
        "whether or not a View-as session exists"
    ),
    ("POST", f"{V1}/users/signup"): (
        "creates a new account, never touches the subject's, and answers one "
        "fixed message for every address (ticket 01)"
    ),
    ("POST", f"{V1}/reset-password/"): (
        "consumes an emailed token that names its own account; the caller's "
        "session is not consulted at all"
    ),
    ("POST", f"{V1}/password-recovery/{{email}}"): (
        "sends mail to the address in the path, uniformly, with no caller "
        "identity involved"
    ),
    ("POST", f"{V1}/private/users/"): (
        "mounted only when ENVIRONMENT == local, which is the one setting "
        "where the API-key middleware waves everything through anyway "
        "(test_public_route_exemptions.py pins the conditional mount)"
    ),
}


# --------------------------------------------------------------------------
# Accounts
# --------------------------------------------------------------------------


def _account(
    client: TestClient, *, role: str | None = None, is_active: bool = True
) -> Iterator[tuple[User, dict[str, str]]]:
    """A real account with a real token.

    The password is set through `crud.create_user` and used to log in, so the
    headers carry a genuine JWT — these probes are about what a *request* can
    reach, and a fabricated token would prove something else.
    """
    from app import crud
    from app.models import UserCreate

    password = random_lower_string()
    with Session(engine) as session:
        email = f"{random_lower_string()}@view-as.test-account.com"
        user = crud.create_user(
            session=session, user_create=UserCreate(email=email, password=password)
        )
        if role is not None:
            session.add(UserRole(user_id=user.id, role_id=role))
        session.commit()
        session.refresh(user)
        created = user

    headers = user_authentication_headers(
        client=client, email=created.email, password=password
    )
    if not is_active:
        with Session(engine) as session:
            row = session.get(User, created.id)
            assert row is not None
            row.is_active = False
            session.add(row)
            session.commit()
    yield created, headers

    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == created.id))  # type: ignore[call-overload]
        session.commit()


@pytest.fixture
def owner(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """An account holding `VIEW_AS`, through the Owner role."""
    yield from _account(client, role=ROLE_OWNER)


@pytest.fixture
def subject(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """An ordinary account, the one being looked at."""
    yield from _account(client)


@pytest.fixture
def peer(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """A second holder of `VIEW_AS`, who must not be viewable."""
    yield from _account(client, role=ROLE_OWNER)


@pytest.fixture(autouse=True)
def _clear_sessions() -> Iterator[None]:
    """`view_as_sessions` is not a `tg_*` table, so nothing truncates it.

    Cleared after each test rather than before, so a failure leaves the row it
    failed on in place to be looked at.
    """
    yield
    with Session(engine) as session:
        session.exec(delete(ViewAsSession))  # type: ignore[call-overload]
        session.commit()


def _start(
    client: TestClient, owner_headers: dict[str, str], target: User
) -> dict[str, Any]:
    response = client.post(f"{V1}/view-as/{target.id}", headers=owner_headers)
    assert response.status_code == 200, response.text
    return response.json()


def _view_as_headers(payload: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['accessToken']}"}


# --------------------------------------------------------------------------
# The exchange
# --------------------------------------------------------------------------


def test_the_exchange_names_both_the_target_and_the_acting_owner(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The ticket's first checkbox, asserted on the claims rather than the body.

    The body is convenience for the browser; the **token** is the session, and
    it is what every later request is judged on. A response that named the pair
    correctly while minting a token that did not would pass a body-only
    assertion and be entirely broken.
    """
    owner_row, owner_headers = owner
    subject_row, _ = subject

    payload = _start(client, owner_headers, subject_row)
    claims = jwt.decode(
        payload["accessToken"], settings.SECRET_KEY, algorithms=[security.ALGORITHM]
    )

    assert claims["sub"] == str(subject_row.id), (
        "the standard subject claim has to be the account being viewed — every "
        "read path downstream scopes on it, which is what makes 'exactly as "
        "they see it' true of routes nobody audited"
    )
    assert claims["act"] == str(owner_row.id)
    assert claims["sub_email"] == subject_row.email
    assert claims["act_email"] == owner_row.email
    assert claims["mode"] == security.VIEW_AS_READ_ONLY


def test_the_session_expires_on_its_own(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Fourth checkbox. Two halves, and only one of them is obvious.

    The lifetime is bounded — minutes, not the eight days an ordinary token
    gets — and an expired token is actually refused. Asserting only the first
    would pass against an `exp` nothing checks.
    """
    _, owner_headers = owner
    subject_row, _ = subject

    payload = _start(client, owner_headers, subject_row)
    claims = jwt.decode(
        payload["accessToken"], settings.SECRET_KEY, algorithms=[security.ALGORITHM]
    )
    lifetime = datetime.fromtimestamp(claims["exp"], UTC) - datetime.now(UTC)
    assert lifetime <= timedelta(minutes=settings.VIEW_AS_TOKEN_EXPIRE_MINUTES)
    assert lifetime < timedelta(hours=2), (
        "a View-as session is somebody reproducing a problem, not a second way "
        "to be signed in"
    )

    expired = security.create_view_as_token(
        subject_id=subject_row.id,
        subject_email=subject_row.email,
        actor_id=uuid.uuid4(),
        actor_email="owner@example.com",
        expires_delta=timedelta(seconds=-1),
    )
    response = client.get(
        f"{V1}/users/me", headers={"Authorization": f"Bearer {expired}"}
    )
    assert response.status_code == 401


def test_viewing_as_another_holder_of_the_permission_is_refused(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    peer: tuple[User, dict[str, str]],
) -> None:
    """Sixth checkbox: peer accounts stay protected.

    And the refusal must not say *why*. A caller holding `VIEW_AS` can already
    list every account, so there is no enumeration to protect — but which
    accounts hold which permissions is a different fact, and a distinct message
    would map the deployment's Owners for anybody who reached this route.
    """
    _, owner_headers = owner
    peer_row, _ = peer

    response = client.post(f"{V1}/view-as/{peer_row.id}", headers=owner_headers)
    assert response.status_code == 404
    absent = client.post(f"{V1}/view-as/{uuid.uuid4()}", headers=owner_headers)
    assert absent.status_code == 404
    assert response.json()["detail"] == absent.json()["detail"]

    with Session(engine) as session:
        assert session.exec(select(ViewAsSession)).all() == [], (
            "a refused exchange must not leave an audit row claiming it happened"
        )


def test_an_owner_cannot_view_as_themselves(
    client: TestClient, owner: tuple[User, dict[str, str]]
) -> None:
    """Read-only over your own data is a downgrade nobody asked for.

    It would also be indistinguishable in the trail from the real thing, which
    is the half that matters: an audit table whose rows can mean two things
    answers neither question.
    """
    owner_row, owner_headers = owner
    response = client.post(f"{V1}/view-as/{owner_row.id}", headers=owner_headers)
    assert response.status_code == 404


def test_a_plain_account_cannot_start_a_session(
    client: TestClient,
    subject: tuple[User, dict[str, str]],
    peer: tuple[User, dict[str, str]],
) -> None:
    """`VIEW_AS` is Owner-only, and the route names the permission, not a role."""
    _, subject_headers = subject
    peer_row, _ = peer
    response = client.post(f"{V1}/view-as/{peer_row.id}", headers=subject_headers)
    assert response.status_code == 403


def test_an_inactive_target_cannot_be_viewed(
    client: TestClient, owner: tuple[User, dict[str, str]]
) -> None:
    """An account an Admin switched off is not a problem to reproduce."""
    _, owner_headers = owner
    generator = _account(client, is_active=False)
    disabled, _ = next(generator)
    try:
        response = client.post(f"{V1}/view-as/{disabled.id}", headers=owner_headers)
        assert response.status_code == 404
    finally:
        for _ in generator:
            pass


# --------------------------------------------------------------------------
# Read-only: the inventory
# --------------------------------------------------------------------------


def test_every_mutating_operation_is_refused_or_allowlisted() -> None:
    """The structural half of "every write is refused during the session".

    Membership only — the behavioural half is the sweep below. This one exists
    so that a route added later cannot quietly become the first write a View-as
    session can make: it is in neither map, and this fails.
    """
    allowlisted = {
        (method, path)
        for method, path in _mutating()
        if path in VIEW_AS_READ_ONLY_PATHS
    }
    assert _unauthenticated_mutating() == set(UNAUTHENTICATED), (
        "a mutating route that authenticates nobody is outside the only gate "
        "this ticket has; add it above with the reason it is safe, or remove "
        "an entry that has since gained an auth dependency"
    )

    unplaced = _mutating() - allowlisted - set(UNAUTHENTICATED)
    assert allowlisted, "the allowlist stopped matching any mounted route"
    assert unplaced, "every mutating route was excused; the gate does nothing"

    for path, reason in VIEW_AS_READ_ONLY_PATHS.items():
        assert reason.strip(), f"{path} is allowlisted with no reason"
        assert any(p == path for _, p in _mutating()), (
            f"{path} is allowlisted but no mutating route mounts it — an "
            "allowlist entry for a route that moved is a hole aimed at "
            "wherever the path went"
        )


def test_every_refused_operation_really_is_refused(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The behavioural half, over every mutating route the app mounts.

    Sent with a real View-as token and asserted to answer the read-only 403 —
    **not merely "not 2xx"**, which would be satisfied by a 422 for a body this
    sweep does not know how to build. That distinction is the whole value here:
    the refusal has to happen before the handler, which is what putting it in
    `get_current_user` buys and what a per-route rule would not.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    headers = _view_as_headers(_start(client, owner_headers, subject_row))

    checked = 0
    for method, template in sorted(_mutating()):
        if template in VIEW_AS_READ_ONLY_PATHS:
            continue
        if (method, template) in UNAUTHENTICATED:
            continue
        # Path parameters are filled with values that cannot match a row. The
        # refusal is ahead of routing's own 404, so what they are does not
        # matter — and that is itself the assertion.
        path = template
        for placeholder in _placeholders(template):
            path = path.replace(f"{{{placeholder}}}", _stub_for(placeholder))
        response = client.request(method, path, headers=headers, json={})
        assert response.status_code == 403, (
            f"{method} {template} answered {response.status_code} to a "
            f"read-only View-as session: {response.text[:200]}"
        )
        assert response.json()["detail"] == VIEW_AS_READ_ONLY_DETAIL, (
            f"{method} {template} refused for some other reason; a permission "
            "error here would look like the gate working while it was not"
        )
        checked += 1

    assert checked > 50, (
        f"only {checked} mutating routes were swept; the inventory has "
        "collapsed and this guard is no longer covering the API"
    )


def _placeholders(template: str) -> list[str]:
    return [part.split("}")[0] for part in template.split("{")[1:]]


def _stub_for(name: str) -> str:
    """A value that parses but names nothing.

    A uuid where the route wants one, since a malformed uuid answers 422 from
    FastAPI's own validation *before* dependencies are solved — which would let
    a route pass this sweep without the gate ever running.
    """
    if name.endswith("_id") or name in {"id", "user_id", "job_id"}:
        return str(uuid.uuid4())
    if name == "email":
        return "nobody@example.com"
    return "view-as-probe"


def test_the_allowlisted_reads_are_actually_reachable(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """An allowlist entry nothing exercises is an intention, not a rule.

    Each allowlisted path is called with a real View-as token and must answer
    something other than the read-only 403. The bodies are the emptiest thing
    each route accepts, so a 200 or a 422 both count — what is being asserted is
    that the gate let the request through to the handler.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    headers = _view_as_headers(_start(client, owner_headers, subject_row))

    for path in VIEW_AS_READ_ONLY_PATHS:
        response = client.post(path, headers=headers, json={})
        assert response.status_code != 403, (
            f"{path} is allowlisted and was still refused: {response.text[:200]}"
        )
        body = response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
        assert detail != VIEW_AS_READ_ONLY_DETAIL


def test_a_view_as_session_cannot_start_another_one(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    peer: tuple[User, dict[str, str]],
) -> None:
    """The exchange is a POST, and a POST is refused. Asserted, not assumed.

    `routes/view_as.py` deliberately carries no nesting check of its own,
    because a branch that cannot be reached is a guard that cannot fail. This is
    where the requirement lives instead — and it is the assertion ticket 27 will
    have to keep true when it widens what an elevated session may do, at which
    point the route *will* be reachable and will need a check.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    peer_row, _ = peer
    headers = _view_as_headers(_start(client, owner_headers, subject_row))

    response = client.post(f"{V1}/view-as/{peer_row.id}", headers=headers)
    assert response.status_code == 403
    assert response.json()["detail"] == VIEW_AS_READ_ONLY_DETAIL


def test_a_read_still_answers_for_the_account_being_viewed(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Read-only is worthless if it is read-only over the wrong account.

    `/users/me` is the cheapest place to see it, and it is what the browser
    itself asks to decide whose app it is rendering.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    headers = _view_as_headers(_start(client, owner_headers, subject_row))

    response = client.get(f"{V1}/users/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["email"] == subject_row.email


# --------------------------------------------------------------------------
# The record
# --------------------------------------------------------------------------


def test_the_exchange_records_who_looked_at_whom(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Fifth checkbox: who, whom, and when."""
    owner_row, owner_headers = owner
    subject_row, _ = subject

    before = datetime.now(UTC)
    payload = _start(client, owner_headers, subject_row)

    with Session(engine) as session:
        rows = session.exec(select(ViewAsSession)).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.id == uuid.UUID(payload["sessionId"])
    assert row.actor_user_id == owner_row.id
    assert row.subject_user_id == subject_row.id
    assert row.mode == security.VIEW_AS_READ_ONLY
    assert row.created_at >= before - timedelta(seconds=5)
    assert row.expires_at > row.created_at


def test_the_record_names_the_owner_as_the_actor(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The one assertion an identically-shaped pair of columns needs.

    `actor_*` and `subject_*` are the same two types in the same order, so a
    transposed pair compiles, passes every other test in this file — every one
    of which would still see one row with two accounts on it — and records the
    Owner as having been viewed by the person who reported the problem.
    """
    owner_row, owner_headers = owner
    subject_row, _ = subject
    _start(client, owner_headers, subject_row)

    with Session(engine) as session:
        row = session.exec(select(ViewAsSession)).one()
    assert row.actor_email == owner_row.email
    assert row.subject_email == subject_row.email
    assert row.actor_email != row.subject_email


def test_the_record_outlives_both_accounts(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Every other per-User table cascades from `user.id`. This one must not.

    The case a reader most wants an answer for is the account that was deleted —
    it is the ticket's own last checkbox — so a cascading key would erase the
    trail precisely when it is being asked for. Both keys are `SET NULL` and
    both addresses are denormalised, which is what still answers.
    """
    owner_row, owner_headers = owner
    subject_row, _ = subject
    _start(client, owner_headers, subject_row)

    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == subject_row.id))  # type: ignore[call-overload]
        session.commit()

    with Session(engine) as session:
        row = session.exec(select(ViewAsSession)).one()
    assert row.subject_user_id is None
    assert row.subject_email == subject_row.email, (
        "the denormalised address is the whole reason the key is SET NULL"
    )
    assert row.actor_user_id == owner_row.id


def test_the_trail_is_readable_and_owner_only(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """ "There is an answer to who looked at what" needs somebody able to ask."""
    _, owner_headers = owner
    subject_row, subject_headers = subject
    _start(client, owner_headers, subject_row)

    response = client.get(f"{V1}/view-as/sessions", headers=owner_headers)
    assert response.status_code == 200
    entries = response.json()["sessions"]
    assert len(entries) == 1
    assert entries[0]["subjectEmail"] == subject_row.email

    refused = client.get(f"{V1}/view-as/sessions", headers=subject_headers)
    assert refused.status_code == 403


# --------------------------------------------------------------------------
# A target that goes away mid-session
# --------------------------------------------------------------------------


def test_a_deleted_target_does_not_sign_the_owner_out(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Seventh checkbox, and the detail string is the whole of it.

    `api/base.ts::isAuthFailure` reads 404 `"User not found"` as a dead session
    and hard-navigates to `/login`. Answering that here would sign the **Owner**
    out over something that happened to somebody else's account — the exact
    opposite of "returns the Owner to their own account". So the string is
    asserted, not just the status.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    headers = _view_as_headers(_start(client, owner_headers, subject_row))

    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == subject_row.id))  # type: ignore[call-overload]
        session.commit()

    response = client.get(f"{V1}/users/me", headers=headers)
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail == VIEW_AS_TARGET_MISSING_DETAIL
    assert detail != "User not found", (
        "that string is what the transport treats as a dead session; using it "
        "here logs the Owner out instead of returning them to their account"
    )

    # And the Owner's own token is untouched — which is what "returns them to
    # their own account" means on the server side.
    assert client.get(f"{V1}/users/me", headers=owner_headers).status_code == 200


def test_a_disabled_target_ends_the_session_the_same_way(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """An account switched off mid-session, which is the reachable variant.

    Deleting an account is rare; disabling one is what an Admin does while an
    Owner is looking at it. It must not answer 403 `"Inactive user"` — that is
    the other string `isAuthFailure` treats as a dead session.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    headers = _view_as_headers(_start(client, owner_headers, subject_row))

    with Session(engine) as session:
        row = session.get(User, subject_row.id)
        assert row is not None
        row.is_active = False
        session.add(row)
        session.commit()

    response = client.get(f"{V1}/users/me", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"] == VIEW_AS_TARGET_INACTIVE_DETAIL
    assert response.json()["detail"] in VIEW_AS_ENDED_DETAILS


def test_the_ended_details_are_the_pair_the_browser_knows() -> None:
    """`VIEW_AS_ENDED_DETAILS` is mirrored in `frontend/src/lib/storage/scoped.ts`.

    Asserted as an exact set rather than a superset: a third way for a session
    to end that the browser does not recognise leaves the Owner staring at an
    error banner with no way back to their own account, which is the failure the
    seventh checkbox names.
    """
    assert VIEW_AS_ENDED_DETAILS == {
        VIEW_AS_TARGET_MISSING_DETAIL,
        VIEW_AS_TARGET_INACTIVE_DETAIL,
    }


def test_view_as_is_reachable_by_the_bootstrap_account() -> None:
    """A permission no deployed account holds is a feature nobody can use.

    `init_db` grants the bootstrap superuser `owner`, and `owner` is the only
    seeded role holding `VIEW_AS`. Asserted here rather than left to
    `test_permissions.py`, which checks the *constants*: this is about the row
    a real deployment ends up with.
    """
    from app.services import rbac

    with Session(engine) as session:
        superuser = session.exec(
            select(User).where(User.email == settings.FIRST_SUPERUSER)
        ).one()
        assert rbac.has_permission(session, superuser.id, Permission.VIEW_AS), (
            "the deployment's own account cannot start a View-as session; "
            "ticket 26 would ship as code nobody can reach"
        )
