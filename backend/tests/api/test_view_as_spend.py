"""BYOK-04: an Owner spends a target's money, and the row says who did.

The third View-as tier. Elevation authorises writes, and every write it
authorises is reversible and attributed; spending is neither, which is why
ADR-017 made this a tier of its own rather than a widening of the second and why
this file exists rather than three more cases in
`test_view_as_elevation.py`.

Three things are asserted here, and only the first is obvious:

* the ladder — read-only refuses a spend, **elevation refuses it too**, and only
  a spend session does not. The middle one is the whole ticket: before BYOK-04
  an elevated session could already regenerate somebody's Summary on their Key,
  and nothing said so anywhere;
* the inventory, in **both** directions. `SPENDABLE_RESOURCES` and the resources
  `VIEW_AS_SPEND_PATHS` names are asserted as the same set, so a fourth
  spendable resource fails here until somebody classifies the operations that
  reach it. And `test_every_mutating_route_that_could_spend_is_classified` walks
  the other way: every mutating route in a module that reaches a paid resource
  must be classified as spending or excused. The forward direction alone shipped
  two open doors — `POST /telegram/bot-info` proxying a free-form Bot API
  `method` on the target's decrypted token, and `POST
  /data/channels/bulk-reset-sync` enqueueing a job billed to the target. The
  default for an unlisted mutating route is *permitted once elevated*, which is
  why the reverse direction matters more on this inventory than on
  `VIEW_AS_READ_ONLY_PATHS`, where an unlisted route is merely refused;
* the attribution — an AI call made during the session names the acting Owner on
  the `tg_llm_logs` row, and an ordinary write by the Account clears it. That
  row is the *only* compensating control here, because nobody asked the target
  for consent and a spend that fails leaves no Artifact to stamp.

## Mutation evidence

**One false pass, recorded because it is the lesson.** The reverse-direction
guard was first written as a one-level loop over `app.routes`, run green, and
only caught when removing `/telegram/bot-info` from the inventory *did not* turn
it red: this FastAPI keeps included routers nested as `_IncludedRouter` objects,
so that loop reached zero routes and the guard could not fail at all.
`test_view_as.py` says exactly this about `app.routes`, and the shared `_walk`
helper exists for it. The `walked > 10` sentinel is what makes a future collapse
loud rather than green.

Eight mutations were run and all eight went red:

* dropping the `view_as_spends` branch from `view_as_allows` — 3 failures;
* moving that branch *below* the `SAFE_METHODS` shortcut — 1, and only
  `test_a_safe_method_on_a_spend_path_is_still_a_spend` catches it, because
  every other spend path is a POST that the shortcut lets past anyway;
* answering `mode == security.VIEW_AS_ELEVATED` instead of `VIEW_AS_SPEND` in
  that branch — 4;
* dropping `acting_owner.stamp` from `upsert_llm_log` — 1;
* raising `VIEW_AS_SPEND_MAX_MINUTES` to 15 (equal to the elevated ceiling) —
  the whole file, at `Settings` construction, which is where it should be;
* dropping `/telegram/bot-info` from `VIEW_AS_SPEND_PATHS` — 1;
* dropping `/data/channels/bulk-reset-sync` from it — 1;
* reverting the route walk to the one-level `app.routes` loop — 1, on the
  `walked > 10` sentinel rather than on any classification, which is the point
  of having it.
"""

from __future__ import annotations

import ast
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.api.deps import (
    SPENDABLE_RESOURCES,
    VIEW_AS_ELEVATED_DETAIL,
    VIEW_AS_NON_SPENDING_PATHS,
    VIEW_AS_READ_ONLY_DETAIL,
    VIEW_AS_READ_ONLY_PATHS,
    VIEW_AS_SPEND_PATHS,
    VIEW_AS_SPEND_REQUIRED_DETAIL,
    acting_owner_for,
    view_as_allows,
    view_as_elevation_refuses,
    view_as_refusal_detail,
)
from app.core import security
from app.core.config import Settings, settings
from app.core.db import engine
from app.core.permissions import ROLE_ADMIN, ROLE_OWNER, Permission
from app.models import TokenPayload, User
from app.models_rbac import UserRole
from app.models_tg import LLMLog
from app.models_view_as import ViewAsSession
from app.services import rbac
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
        email = f"{random_lower_string()}@spend.test-account.com"
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
    """An ordinary account — the only kind a spend session may be taken over."""
    yield from _account(client)


@pytest.fixture
def admin(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    yield from _account(client, role=ROLE_ADMIN)


@pytest.fixture(autouse=True)
def _clear_sessions() -> Iterator[None]:
    """`view_as_sessions` is not a `tg_*` table, so nothing truncates it."""
    yield
    with Session(engine) as session:
        session.exec(delete(ViewAsSession))  # type: ignore[call-overload]
        session.commit()


def _spend(
    client: TestClient,
    owner_headers: dict[str, str],
    target: User,
    *,
    minutes: int | None = None,
) -> dict[str, Any]:
    params = {} if minutes is None else {"minutes": minutes}
    response = client.post(
        f"{V1}/view-as/{target.id}/spend", headers=owner_headers, params=params
    )
    assert response.status_code == 200, response.text
    return response.json()


def _elevate(
    client: TestClient, owner_headers: dict[str, str], target: User
) -> dict[str, Any]:
    response = client.post(f"{V1}/view-as/{target.id}/elevate", headers=owner_headers)
    assert response.status_code == 200, response.text
    return response.json()


def _start(
    client: TestClient, owner_headers: dict[str, str], target: User
) -> dict[str, Any]:
    response = client.post(f"{V1}/view-as/{target.id}", headers=owner_headers)
    assert response.status_code == 200, response.text
    return response.json()


def _headers(payload: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['accessToken']}"}


# --------------------------------------------------------------------------
# The exchange
# --------------------------------------------------------------------------


def test_spending_is_a_third_exchange_with_its_own_mode(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """It mints a third mode and records a row of its own.

    A row rather than an update to whatever session preceded it, for the reason
    an elevation writes one: "looked", "changed" and "spent" happened at
    different times, and the third is the one an auditor is most likely to be
    looking for.
    """
    owner_row, owner_headers = owner
    subject_row, _ = subject

    payload = _spend(client, owner_headers, subject_row)
    assert payload["mode"] == security.VIEW_AS_SPEND
    assert payload["subjectUserId"] == str(subject_row.id)
    assert payload["actorUserId"] == str(owner_row.id)

    claims = TokenPayload(
        **jwt.decode(
            payload["accessToken"],
            settings.SECRET_KEY,
            algorithms=[security.ALGORITHM],
        )
    )
    assert str(claims.sub) == str(subject_row.id), "sub is still the target"
    assert claims.act == str(owner_row.id)
    assert claims.mode == security.VIEW_AS_SPEND

    with Session(engine) as session:
        rows = list(session.exec(select(ViewAsSession)).all())
    assert [row.mode for row in rows] == [security.VIEW_AS_SPEND]
    assert rows[0].actor_user_id == owner_row.id
    assert rows[0].subject_user_id == subject_row.id


def test_the_spend_session_is_the_shortest_lived_of_the_three() -> None:
    """The ceiling, not the default — a caller chooses `minutes` under it."""
    assert settings.VIEW_AS_SPEND_MAX_MINUTES < settings.VIEW_AS_ELEVATED_MAX_MINUTES, (
        "the widest grant must not also be the longest"
    )
    assert settings.VIEW_AS_SPEND_DEFAULT_MINUTES <= settings.VIEW_AS_SPEND_MAX_MINUTES


def test_a_ceiling_that_outlives_the_elevated_session_refuses_to_boot() -> None:
    """A `ValueError` at construction, not a clamp at the route.

    Clamping is a deployment quietly getting a different number than it
    configured, which is the shape of thing nobody discovers until they are
    reading an audit trail that does not add up.
    """
    with pytest.raises(ValueError, match="VIEW_AS_SPEND_MAX_MINUTES"):
        Settings(
            VIEW_AS_TOKEN_EXPIRE_MINUTES=30,
            VIEW_AS_ELEVATED_MAX_MINUTES=15,
            VIEW_AS_SPEND_MAX_MINUTES=15,
        )


def test_the_lifetime_is_chosen_per_exchange(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    _, owner_headers = owner
    subject_row, _ = subject

    short = _spend(client, owner_headers, subject_row, minutes=1)
    ceiling = _spend(
        client, owner_headers, subject_row, minutes=settings.VIEW_AS_SPEND_MAX_MINUTES
    )
    assert short["expiresAt"] < ceiling["expiresAt"]

    over = client.post(
        f"{V1}/view-as/{subject_row.id}/spend",
        headers=owner_headers,
        params={"minutes": settings.VIEW_AS_SPEND_MAX_MINUTES + 1},
    )
    assert over.status_code == 422, "the ceiling is enforced by the route, not clamped"


def test_the_permission_is_its_own(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """A role that views and writes but never spends is expressible as data.

    Asserted through `rbac` rather than by naming the Owner role, because that
    is the claim: the route gates on a Permission, and the seeded role that
    holds it is a row somebody could replace.
    """
    owner_row, owner_headers = owner
    subject_row, subject_headers = subject

    with Session(engine) as session:
        assert rbac.has_permission(session, owner_row.id, Permission.VIEW_AS_SPEND)
        assert not rbac.has_permission(
            session, subject_row.id, Permission.VIEW_AS_SPEND
        )

    refused = client.post(f"{V1}/view-as/{owner_row.id}/spend", headers=subject_headers)
    assert refused.status_code == 403
    assert _spend(client, owner_headers, subject_row)["mode"] == security.VIEW_AS_SPEND


def test_a_target_holding_any_permission_cannot_be_spent_for(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    admin: tuple[User, dict[str, str]],
) -> None:
    """Derived as "holds no permission", never spelled `role == "admin"`.

    The seeded `user` role holds nothing, so a fourth privileged role added as a
    row is refused by this without an edit here — which is the whole reason
    authorisation names a Permission.
    """
    _, owner_headers = owner
    admin_row, _ = admin

    refused = client.post(f"{V1}/view-as/{admin_row.id}/spend", headers=owner_headers)
    assert refused.status_code == 404
    assert refused.json()["detail"] == "No account to spend for"

    looked = client.post(f"{V1}/view-as/{admin_row.id}", headers=owner_headers)
    assert looked.status_code == 200, "an Admin is still viewable read-only"


def test_a_session_cannot_widen_itself_into_spending(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Structural, not a check in the route: `/view-as` is refused at every tier.

    A session that could reach the route which widens it would need no Owner at
    all, so the assertion is made from all three tiers rather than from the one
    somebody thought of.
    """
    _, owner_headers = owner
    subject_row, _ = subject

    for session_payload in (
        _start(client, owner_headers, subject_row),
        _elevate(client, owner_headers, subject_row),
        _spend(client, owner_headers, subject_row),
    ):
        response = client.post(
            f"{V1}/view-as/{subject_row.id}/spend", headers=_headers(session_payload)
        )
        assert response.status_code == 403, response.text
        assert response.json()["detail"] in {
            VIEW_AS_READ_ONLY_DETAIL,
            VIEW_AS_ELEVATED_DETAIL,
        }


# --------------------------------------------------------------------------
# The ladder
# --------------------------------------------------------------------------


def test_the_gate_answers_for_all_three_tiers() -> None:
    """`view_as_allows` is still the one function, now over three modes.

    The unit-level half of the sweeps below. It pins that the spend branch is
    *wider* than elevation on a spend path and *not wider anywhere else*, which
    two behavioural tests on either side could both satisfy while the function
    had collapsed into one of them.
    """
    spend_path = f"{V1}/ai/summary"
    write = f"{V1}/data/summaries/x"

    assert view_as_allows("POST", spend_path, mode=security.VIEW_AS_SPEND)
    assert not view_as_allows("POST", spend_path, mode=security.VIEW_AS_ELEVATED), (
        "elevation authorises writes and this is not one; that is the ticket"
    )
    assert not view_as_allows("POST", spend_path, mode=security.VIEW_AS_READ_ONLY)

    assert view_as_allows("PUT", write, mode=security.VIEW_AS_SPEND), (
        "the tiers widen; a session that may spend may also write"
    )
    assert not view_as_allows("PUT", write, mode="something-new"), (
        "an unrecognised mode still falls through to the narrowest behaviour"
    )
    assert not view_as_allows(
        "PUT", f"{V1}/data/ai-keys/{uuid.uuid4()}", mode=security.VIEW_AS_SPEND
    ), "use without sight: the Key routes are refused in all three tiers"
    assert not view_as_allows(
        "PATCH", f"{V1}/users/me/password", mode=security.VIEW_AS_SPEND
    )
    assert not view_as_allows(
        "POST", f"{V1}/view-as/{uuid.uuid4()}", mode=security.VIEW_AS_SPEND
    )


def test_a_safe_method_on_a_spend_path_is_still_a_spend() -> None:
    """The classification is consulted ahead of the `SAFE_METHODS` shortcut.

    `POST /ai/models` is a POST because BYOK-02 made it one for exactly this
    reason. Asserting the *ordering* rather than trusting the verb is what keeps
    the rule true if it ever goes back to being a GET — and what would have
    caught it while it still was one.
    """
    models = f"{V1}/ai/models"
    assert not view_as_allows("GET", models, mode=security.VIEW_AS_ELEVATED)
    assert not view_as_allows("GET", models, mode=security.VIEW_AS_READ_ONLY)
    assert view_as_allows("GET", models, mode=security.VIEW_AS_SPEND)
    assert view_as_allows("GET", f"{V1}/data/summaries", mode=None), (
        "an ordinary safe method is still free at every tier"
    )


def test_every_spend_path_is_refused_to_an_elevated_session(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The behavioural half, over the whole inventory rather than one example.

    Asserted on the **detail** and not merely on 403: the refusal has to happen
    in `get_current_user` ahead of the handler, and a permission error here
    would look exactly like the gate working while it was not.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    elevated = _headers(_elevate(client, owner_headers, subject_row))

    for path in VIEW_AS_SPEND_PATHS:
        response = client.post(path, headers=elevated, json={})
        assert response.status_code == 403, f"{path}: {response.text[:200]}"
        assert response.json()["detail"] == VIEW_AS_SPEND_REQUIRED_DETAIL, (
            f"{path} was refused for some other reason; the Owner is told to "
            "elevate again rather than to take a spend session"
        )


def test_a_spend_session_reaches_the_paths_an_elevated_one_cannot(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """An inventory nothing exercises is an intention, not a rule.

    Each entry is called with a real spend token and must answer something other
    than a View-as refusal. The bodies are the emptiest thing each route
    accepts, so a 422 or a 400 both count — what is asserted is that the gate
    let the request through to the handler.
    """
    _, owner_headers = owner
    subject_row, _ = subject
    spending = _headers(_spend(client, owner_headers, subject_row))

    refusals = {
        VIEW_AS_SPEND_REQUIRED_DETAIL,
        VIEW_AS_ELEVATED_DETAIL,
        VIEW_AS_READ_ONLY_DETAIL,
    }
    for path in VIEW_AS_SPEND_PATHS:
        response = client.post(path, headers=spending, json={})
        body = response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
        # A 422's `detail` is a list of field errors, which is a pass: the gate
        # let the request reach the handler and the empty body failed there.
        assert not (isinstance(detail, str) and detail in refusals), (
            f"{path} was refused a spend session: {detail}"
        )


def test_a_read_only_session_hears_the_read_only_advice() -> None:
    """From read-only the next step is elevation whatever the path was.

    Two instructions for one click is worse than one, so the spend string is
    reserved for the tier that can act on it.
    """
    spend_path = f"{V1}/ai/summary"
    assert (
        view_as_refusal_detail(spend_path, mode=security.VIEW_AS_READ_ONLY)
        == VIEW_AS_READ_ONLY_DETAIL
    )
    assert (
        view_as_refusal_detail(spend_path, mode=security.VIEW_AS_ELEVATED)
        == VIEW_AS_SPEND_REQUIRED_DETAIL
    )
    assert (
        view_as_refusal_detail(f"{V1}/users/me", mode=security.VIEW_AS_ELEVATED)
        == VIEW_AS_ELEVATED_DETAIL
    )
    assert (
        view_as_refusal_detail(f"{V1}/data/ai-keys/x", mode=security.VIEW_AS_SPEND)
        == VIEW_AS_ELEVATED_DETAIL
    ), "a spend session refused the Key routes is not told to take one"
    assert (
        view_as_refusal_detail(spend_path, mode="something-new")
        == VIEW_AS_READ_ONLY_DETAIL
    ), "an unrecognised mode gets the narrowest tier's advice"


# --------------------------------------------------------------------------
# The inventory
# --------------------------------------------------------------------------


def test_the_spendable_resources_are_a_classified_category() -> None:
    """The exact pair, in both directions (ADR-017's "category, not a list").

    A fourth spendable resource added to `SPENDABLE_RESOURCES` fails here until
    somebody names the operations that reach it, and an operation naming a
    resource that is not in the set fails here rather than widening the tier
    over a typo. Either half alone would let one of those through.
    """
    named = {op.resource for op in VIEW_AS_SPEND_PATHS.values()}
    assert named == SPENDABLE_RESOURCES, (
        "a spendable resource nobody classified operations for, or an operation "
        "naming a resource nobody declared"
    )


def test_every_spend_entry_names_a_route_that_exists() -> None:
    """An entry for a route that moved is a hole aimed at wherever it went."""
    from tests.api.test_view_as import _mounted

    mounted = {path for _, path in _mounted()}
    for path, op in VIEW_AS_SPEND_PATHS.items():
        assert op.reason.strip(), f"{path} is classified with no reason"
        assert path in mounted, (
            f"{path} is classified as spending but no route mounts it"
        )


#: The functions that reach a paid resource. A route module naming one of these
#: is a module where "does this spend?" has to be answered per route.
#:
#: Named rather than call-graphed: a transitive walk over every handler is a
#: bigger machine than this needs, and the *module* is already the unit the
#: payment rule uses (`ai_keys.AI_KEY_CALLERS`). It is also the unit that failed
#: — `telegram.py` and `data/channels.py` each had one route classified and one
#: not, and both misses were in a module the reviewer could see reached a seam.
SPEND_SEAMS = frozenset(
    {
        "resolve_ai_key",
        "_resolve_bot_token",
        "enqueue_sync_job",
        "create_follow_job",
        "metered",
    }
)


def _modules_reaching_a_seam() -> set[str]:
    """Route modules whose source names a spend seam, off the AST."""
    routes_dir = Path(__file__).resolve().parents[2] / "app" / "api" / "routes"
    found: set[str] = set()
    for path in routes_dir.rglob("*.py"):
        tree = ast.parse(path.read_text("utf-8"))
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)} | {
            node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)
        }
        if names & SPEND_SEAMS:
            found.add(str(path.relative_to(routes_dir.parents[2])).replace("\\", "/"))
    return found


def test_every_mutating_route_that_could_spend_is_classified() -> None:
    """The **reverse** direction, and the one that was missing.

    `test_every_spend_entry_names_a_route_that_exists` checks that everything
    listed is mounted. That catches a rename and nothing else. It did not catch
    what actually shipped: `POST /telegram/bot-info` proxies a free-form Bot API
    `method` on the target's decrypted token, and `POST
    /data/channels/bulk-reset-sync` enqueues a job the target is billed for —
    neither was listed, and the default for an unlisted mutating route is
    **permitted once elevated**.

    That default is why this direction matters more here than on
    `VIEW_AS_READ_ONLY_PATHS`, where an unlisted route is merely refused.

    Scoped to modules that reach a seam rather than to the whole API, because
    every other mutating route is a database write and the tier below already
    authorises those. A route added to one of these modules has to be placed.
    """
    from app.main import app
    from tests.api.test_public_route_exemptions import _walk
    from tests.api.test_view_as import SAFE_METHODS

    seam_modules = _modules_reaching_a_seam()
    assert seam_modules, "the seam scan matched nothing; SPEND_SEAMS went stale"

    # `_walk`, not `app.routes`: this FastAPI keeps included routers nested as
    # `_IncludedRouter` objects, so a one-level loop over `app.routes` finds
    # **nothing at all** and this guard passes unconditionally. It did exactly
    # that on the first cut — written, run green, and mutation-tested straight
    # into a false pass, which is why `test_view_as.py` says so in as many words
    # and why that helper is shared rather than re-implemented here.
    walked = 0
    unclassified: list[str] = []
    for path, route in _walk(app.routes):
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        module = endpoint.__module__.replace(".", "/") + ".py"
        if module not in seam_modules:
            continue
        methods = {m.upper() for m in (getattr(route, "methods", set()) or set())}
        if not methods - SAFE_METHODS:
            continue
        walked += 1
        if path in VIEW_AS_SPEND_PATHS or path in VIEW_AS_NON_SPENDING_PATHS:
            continue
        unclassified.append(f"{sorted(methods - SAFE_METHODS)} {path} ({module})")

    assert walked > 10, (
        f"only {walked} mutating routes were reached in the seam modules; the "
        "walk has collapsed and this guard is covering nothing"
    )
    assert not unclassified, (
        "these mutating routes sit in a module that reaches a paid resource and "
        "are classified neither as spending nor as not-spending, so an elevated "
        "session may already be reaching the target's money through them:\n  "
        + "\n  ".join(sorted(unclassified))
    )


def test_the_not_spending_inventory_is_not_a_dumping_ground() -> None:
    """Every excuse names a mounted route and states a reason.

    The mirror of the entry above. An excuse for a route that has since moved is
    an excuse pointed at wherever the path went.
    """
    from tests.api.test_view_as import _mounted

    mounted = {path for _, path in _mounted()}
    for path, reason in VIEW_AS_NON_SPENDING_PATHS.items():
        assert reason.strip(), f"{path} is excused with no reason"
        assert path in mounted, (
            f"{path} is excused from the spend inventory but nothing mounts it"
        )
    assert not set(VIEW_AS_NON_SPENDING_PATHS) & set(VIEW_AS_SPEND_PATHS), (
        "a path cannot both spend and not spend"
    )


def test_the_spend_inventory_does_not_overlap_the_refusals() -> None:
    """A path in both inventories would be classified and then unreachable.

    Not hypothetical: `/data/ai-keys` is refused at every tier *and* is the
    resource this one grants the use of, so the two are one edit apart.
    """
    for path in VIEW_AS_SPEND_PATHS:
        assert not view_as_elevation_refuses(path), (
            f"{path} is classified as spending and also refused outright"
        )
    assert not set(VIEW_AS_SPEND_PATHS) & set(VIEW_AS_READ_ONLY_PATHS), (
        "a path cannot be both a free read and a spend"
    )


# --------------------------------------------------------------------------
# Attribution
# --------------------------------------------------------------------------


def test_a_spend_token_attributes_a_write() -> None:
    """The mode check lives where a unit test can reach it (ticket 27's reason).

    A read-only session cannot write, so binding one would move no test at all —
    which is why this is asserted on the function rather than through a route.
    """
    actor = uuid.uuid4()

    def payload(mode: str) -> TokenPayload:
        return TokenPayload(
            sub=str(uuid.uuid4()),
            act=str(actor),
            act_email="owner@example.com",
            mode=mode,
        )

    assert acting_owner_for(payload(security.VIEW_AS_SPEND)) is not None
    assert acting_owner_for(payload(security.VIEW_AS_ELEVATED)) is not None
    assert acting_owner_for(payload(security.VIEW_AS_READ_ONLY)) is None
    assert acting_owner_for(payload("something-new")) is None


def test_an_ai_call_during_a_spend_session_names_the_owner(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The log row is the whole compensating control, so it is asserted end to end.

    Written through the log route the client uses after an AI call rather than
    by calling a Provider, because what is being pinned is the *attribution* —
    the same seam a real call's log takes, without a network dependency in a
    test that would then be about the network.
    """
    owner_row, owner_headers = owner
    subject_row, subject_headers = subject
    spending = _headers(_spend(client, owner_headers, subject_row))

    log_id = str(uuid.uuid4())
    response = client.post(
        f"{V1}/data/logs/llm",
        headers=spending,
        json=[
            {
                "id": log_id,
                "model": "m",
                "prompt": "p",
                "response": "r",
                "status": "error",
                "error": "provider refused",
                "timestamp": 1,
            }
        ],
    )
    assert response.status_code in {200, 201}, response.text

    with Session(engine) as session:
        row = session.get(LLMLog, log_id)
        assert row is not None
        assert row.user_id == subject_row.id, "the Key that paid is the target's"
        assert row.acted_by_user_id == owner_row.id
        assert row.acted_by_email == owner_row.email

    # The failed call left no Artifact at all, which is exactly why the stamp
    # had to reach this table: without it the money is gone and nothing is
    # attributed anywhere.
    listed = client.get(f"{V1}/data/logs/llm", headers=subject_headers)
    assert listed.status_code == 200, listed.text
    entry = next(item for item in listed.json() if item["id"] == log_id)
    assert entry["actedByEmail"] == owner_row.email, (
        "the target reads who spent on their behalf from the list, not by "
        "opening every row"
    )

    # An ordinary write by the Account takes the attribution back off.
    again = client.post(
        f"{V1}/data/logs/llm",
        headers=subject_headers,
        json=[
            {
                "id": log_id,
                "model": "m",
                "prompt": "p",
                "response": "r",
                "status": "error",
                "timestamp": 1,
            }
        ],
    )
    assert again.status_code in {200, 201}, again.text
    with Session(engine) as session:
        cleared = session.get(LLMLog, log_id)
        assert cleared is not None
        assert cleared.acted_by_user_id is None
        assert cleared.acted_by_email is None
