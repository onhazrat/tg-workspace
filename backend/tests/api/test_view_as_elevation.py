"""Ticket 27: an Owner makes a change on somebody's behalf, and the row says so.

Two halves, and they fail for different reasons.

**The refusal.** Elevation is refused for a target who holds any permission at
all, which is the ticket's "refused when the target is an Admin" expressed the
way `CLAUDE.md` requires — naming a permission, never a role, so a fourth
privileged role added as a row cannot walk past it. It is asserted against an
**Admin** and not only against an Owner, because read-only viewing already
refuses Owners: a check that merely re-used that one would pass every
Owner-shaped test in `test_view_as.py` and let an Admin's account be written to
under their own name.

**The attribution.** Parametrised over the four artifact families for the reason
`test_artifact_tenancy_scoping.py` gives: these are four near-copies of one
module, and a fix applied to one of a pair is half a fix. A fifth family added
without a stamp fails `test_every_family_is_covered_by_this_battery` rather than
passing quietly because nobody wrote its test. Beside it, an AST guard walks the
four aggregate modules and fails any function that commits a write to its own
table without stamping — so the coverage does not depend on this file having
guessed which functions write.

## Mutation evidence

Watched to fail, one change at a time:

* `elevate_view_as` refusing on `has_permission(..., VIEW_AS)` instead of on
  `permissions_for(...)` — the Admin case goes red, the Owner case stays green,
  which is the pair this file exists to separate;
* `view_as_allows` answering `True` for every elevated request — the
  `/view-as` and credentials refusals go red;
* `acting_owner.stamp` assigning only when an Owner is present (dropping the
  clear) — `test_an_ordinary_write_clears_a_previous_stamp` goes red;
* dropping the `acting_owner.stamp` call from `upsert_summary` — one family of
  the battery and the AST guard both go red, which is the point of having both;
* binding the acting owner for a read-only session as well as an elevated one —
  the read-only session cannot write, so no artifact test moves; only
  `test_only_an_elevated_token_attributes_a_write` catches it, which is why the
  mode check lives in a function a unit test can reach;
* raising `VIEW_AS_ELEVATED_MAX_MINUTES` above the read-only lifetime — the
  settings test goes red at construction, which is where it should;
* resolving the caller from `act` rather than `sub` for an elevated token —
  only `test_an_elevated_session_carries_the_targets_permissions_not_the_owners`
  catches it, and it is the mutation a future ticket is most likely to make on
  purpose.
"""

from __future__ import annotations

import ast
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.api.deps import (
    VIEW_AS_ELEVATED_DETAIL,
    VIEW_AS_ELEVATED_REFUSED_PATHS,
    VIEW_AS_ELEVATED_REFUSED_PREFIXES,
    VIEW_AS_READ_ONLY_DETAIL,
    acting_owner_for,
    view_as_allows,
)
from app.core import acting_owner, security
from app.core.acting_owner import ActingOwner
from app.core.config import Settings, settings
from app.core.db import engine
from app.core.permissions import ROLE_ADMIN, ROLE_OWNER
from app.models import TokenPayload, User
from app.models_rbac import UserRole
from app.models_tg import ChatSession, DiscoverReport, Summary, TagRun
from app.models_view_as import ViewAsSession
from app.services.artifacts import ARTIFACT_KINDS
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_lower_string

V1 = settings.API_V1_STR


# --------------------------------------------------------------------------
# Accounts
# --------------------------------------------------------------------------


def _account(
    client: TestClient, *, role: str | None = None
) -> Iterator[tuple[User, dict[str, str]]]:
    """A real account with a real token, as `test_view_as.py` builds one."""
    from app import crud
    from app.models import UserCreate

    password = random_lower_string()
    with Session(engine) as session:
        email = f"{random_lower_string()}@elevation.test-account.com"
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
    yield created, headers

    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == created.id))  # type: ignore[call-overload]
        session.commit()


@pytest.fixture
def owner(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    yield from _account(client, role=ROLE_OWNER)


@pytest.fixture
def subject(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """An ordinary account — the only kind an elevation may be taken over."""
    yield from _account(client)


@pytest.fixture
def admin(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """An Admin. Viewable read-only, and explicitly **not** elevatable."""
    yield from _account(client, role=ROLE_ADMIN)


@pytest.fixture
def peer(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    yield from _account(client, role=ROLE_OWNER)


@pytest.fixture(autouse=True)
def _clear_sessions() -> Iterator[None]:
    """`view_as_sessions` is not a `tg_*` table, so nothing truncates it."""
    yield
    with Session(engine) as session:
        session.exec(delete(ViewAsSession))  # type: ignore[call-overload]
        session.commit()


def _elevate(
    client: TestClient,
    owner_headers: dict[str, str],
    target: User,
    *,
    minutes: int | None = None,
) -> dict[str, Any]:
    params = {} if minutes is None else {"minutes": minutes}
    response = client.post(
        f"{V1}/view-as/{target.id}/elevate", headers=owner_headers, params=params
    )
    assert response.status_code == 200, response.text
    return response.json()


def _headers(payload: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['accessToken']}"}


# --------------------------------------------------------------------------
# The exchange
# --------------------------------------------------------------------------


def test_elevation_is_explicit_and_separately_recorded(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """First checkbox: a second exchange, a second row, a second mode.

    A *new* row rather than an update to the read-only session it replaces:
    "looked" and "changed" are different acts that happened at different times,
    and an auditor asking when an Owner gained write access to an account needs
    a `created_at` that answers it.
    """
    owner_row, owner_headers = owner
    subject_row, _ = subject

    looked = client.post(f"{V1}/view-as/{subject_row.id}", headers=owner_headers)
    assert looked.status_code == 200, looked.text
    payload = _elevate(client, owner_headers, subject_row)

    claims = jwt.decode(
        payload["accessToken"], settings.SECRET_KEY, algorithms=[security.ALGORITHM]
    )
    assert claims["sub"] == str(subject_row.id)
    assert claims["act"] == str(owner_row.id)
    assert claims["mode"] == security.VIEW_AS_ELEVATED

    with Session(engine) as session:
        rows = session.exec(
            select(ViewAsSession).order_by(col(ViewAsSession.created_at))
        ).all()
    assert [row.mode for row in rows] == [
        security.VIEW_AS_READ_ONLY,
        security.VIEW_AS_ELEVATED,
    ], "elevating must file its own row, not relabel the one that came before"
    assert rows[1].actor_user_id == owner_row.id
    assert rows[1].subject_user_id == subject_row.id


def test_the_elevated_session_is_shorter_lived_than_looking(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The checkbox says "shorter-lived", and the ceiling is what makes it true.

    Asserting the default alone would pass on a deployment whose ceiling had
    been raised past the read-only lifetime — and `minutes` is chosen per
    exchange, so the default is not what a caller necessarily gets.
    """
    _, owner_headers = owner
    subject_row, _ = subject

    payload = _elevate(client, owner_headers, subject_row)
    claims = jwt.decode(
        payload["accessToken"], settings.SECRET_KEY, algorithms=[security.ALGORITHM]
    )
    lifetime = datetime.fromtimestamp(claims["exp"], UTC) - datetime.now(UTC)
    assert lifetime <= timedelta(minutes=settings.VIEW_AS_ELEVATED_DEFAULT_MINUTES)
    assert settings.VIEW_AS_ELEVATED_MAX_MINUTES < settings.VIEW_AS_TOKEN_EXPIRE_MINUTES


def test_a_ceiling_that_outlives_the_read_only_session_refuses_to_boot() -> None:
    """The rule above, enforced where it can be enforced for every value.

    A `ValueError` at construction rather than a clamp in the route: clamping is
    a deployment quietly getting a number it did not configure, discovered while
    reading an audit trail that does not add up.
    """
    with pytest.raises(ValueError, match="strictly shorter"):
        Settings(
            PROJECT_NAME="test",
            VIEW_AS_TOKEN_EXPIRE_MINUTES=10,
            VIEW_AS_ELEVATED_MAX_MINUTES=10,
        )  # type: ignore[call-arg]

    with pytest.raises(ValueError, match="must not exceed"):
        Settings(
            PROJECT_NAME="test",
            VIEW_AS_ELEVATED_DEFAULT_MINUTES=99,
            VIEW_AS_ELEVATED_MAX_MINUTES=10,
        )  # type: ignore[call-arg]


def test_the_lifetime_is_chosen_per_exchange(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """A shorter elevation is honoured; one past the ceiling is refused.

    Both directions, because a `minutes` parameter that were silently ignored
    would pass the first assertion on its own.
    """
    _, owner_headers = owner
    subject_row, _ = subject

    payload = _elevate(client, owner_headers, subject_row, minutes=1)
    claims = jwt.decode(
        payload["accessToken"], settings.SECRET_KEY, algorithms=[security.ALGORITHM]
    )
    lifetime = datetime.fromtimestamp(claims["exp"], UTC) - datetime.now(UTC)
    assert lifetime <= timedelta(minutes=1)

    over = client.post(
        f"{V1}/view-as/{subject_row.id}/elevate",
        headers=owner_headers,
        params={"minutes": settings.VIEW_AS_ELEVATED_MAX_MINUTES + 1},
    )
    assert over.status_code == 422
    with Session(engine) as session:
        assert (
            session.exec(
                select(ViewAsSession).where(
                    col(ViewAsSession.expires_at)
                    > datetime.now(UTC)
                    + timedelta(minutes=settings.VIEW_AS_ELEVATED_MAX_MINUTES)
                )
            ).all()
            == []
        ), "a refused exchange must not leave a row claiming it happened"


def test_elevation_is_refused_when_the_target_holds_any_permission(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    admin: tuple[User, dict[str, str]],
    peer: tuple[User, dict[str, str]],
) -> None:
    """Second checkbox, and the Admin case is the one that matters.

    Read-only viewing already refuses a holder of `VIEW_AS`, so a check that
    re-used that predicate refuses the Owner and passes any test written against
    one — while letting an Admin's account be written to under their own name.
    The plain account has to succeed in the same test, or "refuse everybody"
    would pass too.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    admin_row, _ = admin
    peer_row, _ = peer

    refused_admin = client.post(
        f"{V1}/view-as/{admin_row.id}/elevate", headers=owner_headers
    )
    assert refused_admin.status_code == 404, refused_admin.text

    refused_peer = client.post(
        f"{V1}/view-as/{peer_row.id}/elevate", headers=owner_headers
    )
    assert refused_peer.status_code == 404

    absent = client.post(f"{V1}/view-as/{uuid.uuid4()}/elevate", headers=owner_headers)
    assert absent.status_code == 404
    assert refused_admin.json()["detail"] == absent.json()["detail"], (
        "which accounts hold which permissions is not this route's fact to "
        "publish; one message for all three"
    )

    allowed = client.post(
        f"{V1}/view-as/{subject_row.id}/elevate", headers=owner_headers
    )
    assert allowed.status_code == 200

    with Session(engine) as session:
        rows = session.exec(select(ViewAsSession)).all()
    assert len(rows) == 1, "only the accepted exchange may leave a record"
    assert rows[0].subject_user_id == subject_row.id


def test_an_admin_may_still_be_viewed_read_only(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    admin: tuple[User, dict[str, str]],
) -> None:
    """The two rules are deliberately different, and this is the difference.

    Looking at an Admin's screen to reproduce their problem is legitimate;
    writing to their account under their name is not. A single shared predicate
    would take the first away to get the second.
    """
    _, owner_headers = owner
    admin_row, _ = admin
    response = client.post(f"{V1}/view-as/{admin_row.id}", headers=owner_headers)
    assert response.status_code == 200, response.text


def test_a_plain_account_cannot_elevate(
    client: TestClient,
    subject: tuple[User, dict[str, str]],
) -> None:
    """`VIEW_AS` gates elevation exactly as it gates looking."""
    subject_row, subject_headers = subject
    other = _account(client)
    target, _ = next(other)
    try:
        response = client.post(
            f"{V1}/view-as/{target.id}/elevate", headers=subject_headers
        )
        assert response.status_code == 403
    finally:
        for _ in other:
            pass
    assert subject_row.id is not None


# --------------------------------------------------------------------------
# What an elevated session may and may not do
# --------------------------------------------------------------------------


def test_an_elevated_session_may_write(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The whole point. A read-only session answers 403 to the same request."""
    _, owner_headers = owner
    subject_row, _ = subject

    summary_id = f"elevated-{uuid.uuid4()}"
    elevated = _headers(_elevate(client, owner_headers, subject_row))
    response = client.put(
        f"{V1}/data/summaries/{summary_id}",
        headers=elevated,
        json={"text": "written on their behalf", "channels": []},
    )
    assert response.status_code == 200, response.text

    read_only = client.post(f"{V1}/view-as/{subject_row.id}", headers=owner_headers)
    refused = client.put(
        f"{V1}/data/summaries/{summary_id}",
        headers={"Authorization": f"Bearer {read_only.json()['accessToken']}"},
        json={"text": "no"},
    )
    assert refused.status_code == 403
    assert refused.json()["detail"] == VIEW_AS_READ_ONLY_DETAIL


def test_an_elevated_session_carries_the_targets_permissions_not_the_owners(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Elevation widens what the *session* may do, never who it is.

    `require_permission` resolves roles for `current_user`, and `current_user`
    is the target — so an elevated session holds exactly the target's
    permissions, which for an ordinary account is none. That falls out of ticket
    26's design rather than from any code here, which is precisely why it is
    asserted: resolving permissions from `act` is the obvious-looking "fix" for
    a future ticket where an Owner cannot do something during an elevation, and
    it would silently turn this feature into full impersonation with Owner
    powers and a `sub` that says otherwise.

    `/users/` needs `USERS_READ`. The Owner has it, the target does not, and it
    is a GET — so the read-only gate is not what refuses it.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    elevated = _headers(_elevate(client, owner_headers, subject_row))

    assert client.get(f"{V1}/users/", headers=owner_headers).status_code == 200
    refused = client.get(f"{V1}/users/", headers=elevated)
    assert refused.status_code == 403, (
        "an elevated session reached a route only the acting Owner may use; "
        "permissions must resolve for `sub`, never for `act`"
    )
    assert refused.json()["detail"] == "The user doesn't have enough privileges"


def test_an_elevated_session_cannot_start_or_elevate_another(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    peer: tuple[User, dict[str, str]],
) -> None:
    """Ticket 26 handed this here, and this is where it lands.

    That ticket left `routes/view_as.py` with no nesting check because the
    read-only gate made the branch unreachable, and said the branch stops being
    unreachable here. An elevated session starting another writes an audit row
    naming the **target** as the Owner who looked.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    peer_row, _ = peer
    elevated = _headers(_elevate(client, owner_headers, subject_row))

    started = client.post(f"{V1}/view-as/{peer_row.id}", headers=elevated)
    assert started.status_code == 403
    assert started.json()["detail"] == VIEW_AS_ELEVATED_DETAIL

    again = client.post(f"{V1}/view-as/{peer_row.id}/elevate", headers=elevated)
    assert again.status_code == 403
    assert again.json()["detail"] == VIEW_AS_ELEVATED_DETAIL

    with Session(engine) as session:
        rows = session.exec(select(ViewAsSession)).all()
    assert len(rows) == 1, "a refused nesting attempt must leave no record"


def test_an_elevated_session_cannot_change_the_targets_credentials(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Otherwise the elevation is a way to leave the audit trail entirely.

    Setting the target's password here means signing in as them afterwards with
    no `act` claim, no session row and no stamp on anything done next — while
    every other guard in this ticket still passes. An Owner can already reset
    any password through `/users/{id}`, which is the point: that act is
    attributable and this one would not be.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    elevated = _headers(_elevate(client, owner_headers, subject_row))

    attempts = [
        client.patch(
            f"{V1}/users/me/password",
            headers=elevated,
            json={"current_password": "x", "new_password": random_lower_string()},
        ),
        client.patch(
            f"{V1}/users/me", headers=elevated, json={"email": "taken@example.com"}
        ),
        client.delete(f"{V1}/users/me", headers=elevated),
    ]
    for response in attempts:
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == VIEW_AS_ELEVATED_DETAIL

    with Session(engine) as session:
        assert session.get(User, subject_row.id) is not None


def test_the_refusal_inventories_name_routes_that_exist() -> None:
    """An entry for a route that moved is a hole aimed at wherever it went.

    Both inventories are checked against the mounted OpenAPI document rather
    than against a memory of the API, so a rename fails here instead of silently
    widening what an elevation may do.
    """
    from tests.api.test_view_as import _mutating

    mutating = {path for _, path in _mutating()}

    for path, reason in VIEW_AS_ELEVATED_REFUSED_PATHS.items():
        assert reason.strip(), f"{path} is refused with no reason"
        assert path in mutating, (
            f"{path} is refused for an elevated session but no mutating route mounts it"
        )

    for prefix, reason in VIEW_AS_ELEVATED_REFUSED_PREFIXES.items():
        assert reason.strip(), f"{prefix} is refused with no reason"
        assert any(path.startswith(prefix) for path in mutating), (
            f"nothing mutating is mounted under {prefix}"
        )


def test_the_gate_is_the_one_function_that_answers() -> None:
    """`view_as_allows` decides for both modes, and a safe method is free.

    The unit-level half of the sweeps above: it pins that the elevated branch is
    *narrower* than "anything goes" and *wider* than read-only, which two
    behavioural tests on either side could both satisfy while the function had
    collapsed to one of them.
    """
    write = f"{V1}/data/summaries/x"
    assert view_as_allows("PUT", write, mode=security.VIEW_AS_ELEVATED)
    assert not view_as_allows("PUT", write, mode=security.VIEW_AS_READ_ONLY)
    assert view_as_allows("GET", f"{V1}/view-as/sessions", mode=None), (
        "a safe method is free whatever the mode; the refusals are about writes"
    )
    assert not view_as_allows(
        "POST", f"{V1}/view-as/{uuid.uuid4()}", mode=security.VIEW_AS_ELEVATED
    )
    assert not view_as_allows(
        "PATCH", f"{V1}/users/me/password", mode=security.VIEW_AS_ELEVATED
    ), "the refusals hold however the session was elevated"
    assert not view_as_allows("PUT", write, mode="something-new"), (
        "an unrecognised mode falls through to the narrowest behaviour, not "
        "the widest — an old token after a rename must not gain write access"
    )


# --------------------------------------------------------------------------
# Attribution
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Family:
    """One artifact family, and how to write one of its rows over HTTP."""

    kind: str
    model: type[Any]
    path: str
    body: dict[str, Any]


FAMILIES: tuple[Family, ...] = (
    Family("summary", Summary, "data/summaries/{id}", {"text": "s", "channels": []}),
    Family(
        "chat", ChatSession, "data/chat-sessions/{id}", {"title": "c", "channels": []}
    ),
    Family("tag", TagRun, "data/tag-runs/{id}", {"status": "pending", "channels": []}),
    # A report is created by running Discover rather than by PUTting an id, and
    # its only later write is the flags route. Both are covered: the create by
    # `test_a_report_created_during_an_elevation_is_attributed`, the update
    # here.
    Family("discovery", DiscoverReport, "data/discover/reports/{id}/flags", {}),
)


def test_every_family_is_covered_by_this_battery() -> None:
    """A fifth artifact kind cannot join History without an attribution test.

    Derived from `ARTIFACT_KINDS` rather than compared against a list here, for
    `test_artifact_tenancy_scoping.py`'s reason: four near-copies of one module
    are exactly where a new one gets added and nobody writes its tests.
    """
    assert {family.kind for family in FAMILIES} == set(ARTIFACT_KINDS)


def _write(
    client: TestClient, headers: dict[str, str], family: Family, row_id: str
) -> Any:
    return client.put(
        f"{V1}/{family.path.format(id=row_id)}", headers=headers, json=family.body
    )


@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_a_write_during_an_elevation_names_the_acting_owner(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    family: Family,
) -> None:
    """Third checkbox, per family.

    The row still belongs to the target — that is ticket 26 working — and it now
    also says who actually wrote it. Both are asserted, because a stamp that
    also moved the owner would be a different bug wearing this one's clothes.
    """
    owner_row, owner_headers = owner
    subject_row, subject_headers = subject
    row_id = f"attr-{uuid.uuid4()}"

    # A report has no PUT that creates, so seed the row as the subject first.
    # Every family tolerates this: the elevated write is the one being asserted.
    if family.kind == "discovery":
        with Session(engine) as session:
            session.add(DiscoverReport(id=row_id, user_id=subject_row.id))
            session.commit()
    else:
        seeded = _write(client, subject_headers, family, row_id)
        assert seeded.status_code == 200, seeded.text

    elevated = _headers(_elevate(client, owner_headers, subject_row))
    response = _write(client, elevated, family, row_id)
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        row = session.get(family.model, row_id)
    assert row is not None
    assert row.user_id == subject_row.id, (
        "an elevated write belongs to the account it was made for; the Owner is "
        "an annotation on it, not its owner"
    )
    assert row.acted_by_user_id == owner_row.id
    assert row.acted_by_email == owner_row.email


@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_an_ordinary_write_clears_a_previous_stamp(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    family: Family,
) -> None:
    """The column answers "who made the **last** write".

    A stamp that only ever wrote a value would leave an Owner's name on a row
    the User has since edited themselves — History would then say an Owner wrote
    something they did not touch, which is the same class of lie as saying the
    User did.
    """
    _, owner_headers = owner
    subject_row, subject_headers = subject
    row_id = f"clear-{uuid.uuid4()}"

    if family.kind == "discovery":
        with Session(engine) as session:
            session.add(DiscoverReport(id=row_id, user_id=subject_row.id))
            session.commit()
    else:
        assert _write(client, subject_headers, family, row_id).status_code == 200

    elevated = _headers(_elevate(client, owner_headers, subject_row))
    assert _write(client, elevated, family, row_id).status_code == 200
    assert _write(client, subject_headers, family, row_id).status_code == 200

    with Session(engine) as session:
        row = session.get(family.model, row_id)
    assert row is not None
    assert row.acted_by_user_id is None
    assert row.acted_by_email is None


def test_only_an_elevated_token_attributes_a_write() -> None:
    """A read-only session cannot write, so nothing else here would notice.

    That is the whole reason this is a unit test on `acting_owner_for` rather
    than a request: binding on `act` alone would move no artifact assertion in
    this file, and would mean that the day an allowlisted read-only POST grew a
    write, it was attributed to an Owner who had explicitly declined to elevate.
    """
    actor = uuid.uuid4()

    elevated = TokenPayload(
        sub=str(uuid.uuid4()),
        act=str(actor),
        act_email="owner@example.com",
        mode=security.VIEW_AS_ELEVATED,
    )
    assert acting_owner_for(elevated) == ActingOwner(
        user_id=actor, email="owner@example.com"
    )

    read_only = elevated.model_copy(update={"mode": security.VIEW_AS_READ_ONLY})
    assert acting_owner_for(read_only) is None

    assert acting_owner_for(elevated.model_copy(update={"mode": "something-new"})) is (
        None
    ), "an unrecognised mode falls through to attributing nobody"
    assert acting_owner_for(TokenPayload(sub=str(uuid.uuid4()))) is None, (
        "an ordinary session names no acting Owner"
    )
    assert (
        acting_owner_for(elevated.model_copy(update={"act": "not-a-uuid"})) is None
    ), (
        "an unparsable actor lands the write unattributed rather than 500ing a "
        "read the target is entitled to make"
    )
    assert acting_owner_for(elevated.model_copy(update={"act_email": None})) is None


def test_a_report_created_during_an_elevation_is_attributed(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """`create_report` is a second write door on the same table.

    `update_report_flags` is the one the battery exercises, and stamping only
    that one would leave every report an Owner *generated* claiming the User
    ran it.
    """
    owner_row, owner_headers = owner
    subject_row, _ = subject
    elevated = _headers(_elevate(client, owner_headers, subject_row))

    response = client.post(
        f"{V1}/data/discover/reports",
        headers=elevated,
        json={"channelNames": [], "startDate": 0, "endDate": 0},
    )
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        rows = session.exec(select(DiscoverReport)).all()
    assert len(rows) == 1
    assert rows[0].user_id == subject_row.id
    assert rows[0].acted_by_email == owner_row.email


def test_the_admin_write_doors_are_closed_to_an_elevated_session(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """`/data/import` reaches artifact rows by id and overwrites them.

    It is not in either refusal inventory, and it does not need to be: an
    elevated session carries the **target's** permissions, and `DATA_ADMIN` is
    not one of them. That is worth an assertion of its own rather than a
    comment, because it is the load-bearing half of why the refusal inventories
    can stay as short as they are — every admin-gated write door in the API is
    already closed by the identity the session runs as, not by a list somebody
    maintains.

    `_import_summaries` stamps anyway (`services/data_import_export.py`). The
    stamp belongs to the *write*, not to whoever may currently reach it: a
    per-account import is a plausible next ticket, and `DATA_ADMIN` is an
    authorisation rule an operator can move with an `INSERT`.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    elevated = _headers(_elevate(client, owner_headers, subject_row))

    refused = client.post(f"{V1}/data/import", headers=elevated, json={"summaries": []})
    assert refused.status_code == 403
    assert refused.json()["detail"] == "The user doesn't have enough privileges", (
        "refused for the right reason — a read-only-style refusal here would "
        "mean the inventory was doing this job, and the inventory does not "
        "name this route"
    )
    assert (
        client.post(
            f"{V1}/data/import", headers=owner_headers, json={"summaries": []}
        ).status_code
        == 200
    ), "the Owner may import under their own name, as before"


def test_the_importer_stamps_every_artifact_family_it_writes() -> None:
    """The stamp is asserted where the behavioural test cannot reach.

    `_import_summaries` is unreachable from an elevated session today, so a
    request-level assertion would be a guard that cannot fail. This one is
    structural instead.

    It used to read "the importer writes exactly *one* of the four artifact
    families", with the other three asserted absent and a message telling
    whoever added one to come back here. Ticket 28 added them: the export now
    carries chats, tag runs and reports, so all four have an import door. The
    guard keeps its job by changing shape rather than by being deleted — every
    write door in the module has to be attributed, and there are four of them
    now.

    Summaries are stamped by name and the other three through the shared
    importer, which is why this looks for the *call* rather than for a
    spelling: `_import_artifact_rows` is one `acting_owner.stamp` covering
    three families, and asserting a literal `stamp(session, chat)` would fail a
    module that is right.
    """
    source = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "services"
        / "data_import_export.py"
    ).read_text(encoding="utf-8")
    tree = ast.parse(source)

    assert "acting_owner.stamp(session, summary)" in source, (
        "the importer stopped recording who wrote the summaries it overwrites"
    )

    #: Every function in the module that constructs or merges an artifact row,
    #: and whether it stamps. `_import_artifact_rows` is the door the other
    #: three families go through.
    doors = {"_import_summaries", "_import_artifact_rows"}
    stamping = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, _FUNCTION_NODES) and _stamps(node)
    }
    assert doors <= stamping, (
        f"these artifact write doors do not call `acting_owner.stamp`: "
        f"{sorted(doors - stamping)}"
    )

    for model in ("ChatSession", "TagRun", "DiscoverReport"):
        assert f"model={model}," in source, (
            f"{model} is no longer imported through `_import_artifact_rows`; "
            "if it got its own branch, that branch needs its own stamp and a "
            "line here"
        )


def test_the_stamp_outlives_the_owner(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """`SET NULL` where `user_id` cascades, and the address is what answers.

    Deleting the account that *owns* an artifact deletes the artifact. Deleting
    the Owner who once fixed it must not — and the record of who fixed it is
    exactly what a reader wants once they are gone.
    """
    owner_row, owner_headers = owner
    subject_row, _ = subject
    summary_id = f"outlive-{uuid.uuid4()}"
    elevated = _headers(_elevate(client, owner_headers, subject_row))
    assert (
        client.put(
            f"{V1}/data/summaries/{summary_id}",
            headers=elevated,
            json={"text": "on their behalf", "channels": []},
        ).status_code
        == 200
    )

    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == owner_row.id))  # type: ignore[call-overload]
        session.commit()

    with Session(engine) as session:
        row = session.get(Summary, summary_id)
    assert row is not None, "deleting the Owner must not delete the target's row"
    assert row.acted_by_user_id is None
    assert row.acted_by_email == owner_row.email, (
        "the denormalised address is the whole reason the key is SET NULL"
    )


def test_history_shows_the_acting_owner(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Fourth checkbox. History is the one screen that lists every kind.

    Asserted through the route rather than the service, because the union legs
    and the response schema are two more places the column could be dropped
    between the table and the person who has to see it.
    """
    owner_row, owner_headers = owner
    subject_row, subject_headers = subject

    mine = f"mine-{uuid.uuid4()}"
    theirs = f"theirs-{uuid.uuid4()}"
    assert (
        client.put(
            f"{V1}/data/summaries/{mine}",
            headers=subject_headers,
            json={"text": "my own", "channels": []},
        ).status_code
        == 200
    )
    elevated = _headers(_elevate(client, owner_headers, subject_row))
    assert (
        client.put(
            f"{V1}/data/summaries/{theirs}",
            headers=elevated,
            json={"text": "theirs", "channels": []},
        ).status_code
        == 200
    )

    response = client.get(f"{V1}/data/artifacts", headers=subject_headers)
    assert response.status_code == 200, response.text
    by_id = {row["id"]: row for row in response.json()}
    assert by_id[theirs]["actedByEmail"] == owner_row.email
    assert by_id[mine]["actedByEmail"] is None, (
        "a row the User wrote themselves must not be annotated with anybody"
    )


# --------------------------------------------------------------------------
# The stamp is not a thing four modules have to remember
# --------------------------------------------------------------------------

#: The four aggregates, each the sole writer of one artifact table.
_AGGREGATES = {
    "summaries": "Summary",
    "chat_sessions": "ChatSession",
    "tag_runs": "TagRun",
    "discover_reports": "DiscoverReport",
}

#: Functions in those modules that commit without stamping, and why that is
#: right. An entry here is an argument, not an exemption: a write function that
#: quietly joined this list would be one History could not explain.
_NOT_ATTRIBUTED: dict[str, str] = {
    "delete_summary": "a deleted row has nothing left to annotate",
    "delete_chat_session": "as above",
    "delete_tag_run": "as above",
    "delete_report": "as above",
}


def _service_path(module: str) -> Path:
    return Path(__file__).resolve().parents[2] / "app" / "services" / f"{module}.py"


Function = ast.FunctionDef | ast.AsyncFunctionDef

#: Matched as a pair, never `ast.FunctionDef` alone. All four aggregates are
#: sync today, so the guard passes either way — and its whole job is the door
#: added next quarter, which may perfectly well be an `async def` and would then
#: join the module without failing anything.
_FUNCTION_NODES = (ast.FunctionDef, ast.AsyncFunctionDef)


def _commits(node: Function) -> bool:
    return any(
        isinstance(inner, ast.Call)
        and isinstance(inner.func, ast.Attribute)
        and inner.func.attr == "commit"
        for inner in ast.walk(node)
    )


def _stamps(node: Function) -> bool:
    return any(
        isinstance(inner, ast.Call)
        and isinstance(inner.func, ast.Attribute)
        and inner.func.attr == "stamp"
        for inner in ast.walk(node)
    )


def test_every_committing_write_in_the_four_aggregates_is_attributed() -> None:
    """Derived from the AST, so this does not depend on having guessed right.

    The battery above exercises the write doors somebody thought of. This walks
    the four modules and fails any function that commits without stamping,
    which is what catches the fifth door added next quarter — the shape of
    `test_import_write_scoping.py`, applied to the same class of problem.
    """
    unattributed: list[str] = []
    checked = 0
    for module in _AGGREGATES:
        tree = ast.parse(_service_path(module).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, _FUNCTION_NODES) or not _commits(node):
                continue
            checked += 1
            if _stamps(node) or node.name in _NOT_ATTRIBUTED:
                continue
            unattributed.append(f"{module}.{node.name}")

    assert not unattributed, (
        "these commit a write to an artifact table without recording who made "
        f"it: {sorted(unattributed)}. Call `acting_owner.stamp(session, row)` "
        "before the add, or add the function to _NOT_ATTRIBUTED with a reason."
    )
    assert checked >= 8, (
        f"only {checked} committing functions were found across "
        f"{sorted(_AGGREGATES)}; this guard has stopped covering them"
    )


def test_the_excuses_still_name_functions_that_exist() -> None:
    """An excuse for a function that was renamed excuses its replacement too."""
    names = {
        node.name
        for module in _AGGREGATES
        for node in ast.walk(ast.parse(_service_path(module).read_text("utf-8")))
        if isinstance(node, _FUNCTION_NODES)
    }
    missing = set(_NOT_ATTRIBUTED) - names
    assert not missing, f"excused functions that no longer exist: {sorted(missing)}"


def test_the_binding_travels_with_the_unit_of_work() -> None:
    """Why `session.info` and not a `contextvar`, asserted rather than argued.

    `get_current_user` is a `def`; FastAPI solves sync dependencies through
    `run_in_threadpool` and anyio copies the context into the worker, so a
    context variable set there lands on a copy the endpoint never reads. Binding
    to the `Session` the aggregates already take is what makes the stamp visible
    where it is needed — and makes a second, unbound `Session` (a background
    job) correctly stamp nothing.
    """
    owner_row = ActingOwner(user_id=uuid.uuid4(), email="owner@example.com")
    with Session(engine) as bound, Session(engine) as unbound:
        acting_owner.bind(bound, owner_row)
        assert acting_owner.current(bound) == owner_row
        assert acting_owner.current(unbound) is None, (
            "a background job opens its own Session and must attribute nothing"
        )

        row = Summary(id="x", user_id=uuid.uuid4(), text="")
        acting_owner.stamp(bound, row)
        assert row.acted_by_email == owner_row.email
        acting_owner.stamp(unbound, row)
        assert row.acted_by_email is None

        acting_owner.bind(bound, None)
        assert acting_owner.current(bound) is None, (
            "a reused Session must be able to stop naming an acting Owner, or "
            "one request's Owner leaks into the next"
        )
