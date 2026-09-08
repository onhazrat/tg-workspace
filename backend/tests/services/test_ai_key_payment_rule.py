"""BYOK-01: an Artifact is paid for by the Account that asked for it.

One seam, one test module. `resolve_ai_key` is the single place the payment rule
lives, and this file asserts the whole rule against it rather than spot-checking
the call sites: each Artifact purpose resolves the requesting Account's Key, each
shared purpose resolves the Operator Key, a Key belonging to somebody else is
refused **before** the secret is decrypted, and a module that reaches a Provider
without going through the seam fails.

The prior art is `test_lane_selection.py`, which asserts that the real enqueue
picks the lane rather than testing the pure function in isolation, and which
holds the declared-caller list for the two paths that sync outside the ladder.
The same two halves are here: a behavioural half over the real function, and a
structural half walked from the AST.

**Why the caller list is not optional.** The failure it catches is invisible in
production: a twelfth AI call site that keeps calling `get_provider` with the
environment key still works, still returns a Summary, and quietly charges the
Operator for it. Nothing goes red, nothing gets logged, and the bill arrives a
month later. That is precisely the shape `RUN_SYNC_JOB_CALLERS` exists for.
"""

from __future__ import annotations

import ast
import pathlib
import uuid

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete

from app.core import config
from app.core.db import engine
from app.core.secrets import encrypt_token
from app.models import User
from app.models_tg import AICredential, utc_now
from app.services.ai_keys import (
    ACCOUNT_PAID,
    AI_CREDENTIAL_NOT_FOUND,
    AI_KEY_CALLERS,
    AI_KEY_MISSING_DETAIL,
    AI_KEY_REJECTED_DETAIL,
    OPERATOR_KEY_MISSING_DETAIL,
    Purpose,
    resolve_ai_key,
)
from tests.utils.user import create_random_user

APP_ROOT = pathlib.Path(__file__).resolve().parents[2] / "app"

#: The one module allowed to build a Provider without first resolving a Key,
#: because it *is* the thing that builds Providers.
PROVIDER_FACTORY = "app/ai/registry.py"


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def operator_key(monkeypatch: pytest.MonkeyPatch) -> str:
    """A deployment that has an Operator Key, stated rather than assumed.

    The shared-purpose tests assert *which* key comes back, so a run whose
    environment happens to have `GEMINI_API_KEY` empty would fail them for a
    reason that has nothing to do with the rule.
    """
    monkeypatch.setattr(config.settings, "GEMINI_API_KEY", "operator-env-key")
    return "operator-env-key"


def _seed_key(
    session: Session,
    row_id: str,
    owner: uuid.UUID,
    *,
    secret: str = "account-secret",
    validated: bool = True,
) -> AICredential:
    row = AICredential(
        id=row_id,
        user_id=owner,
        label=row_id,
        provider="gemini",
        key_encrypted=encrypt_token(secret),
        last_validated=int(utc_now().timestamp() * 1000) if validated else None,
    )
    session.add(row)
    session.commit()
    return row


# --------------------------------------------------------------------------
# The rule itself
# --------------------------------------------------------------------------


#: The classification, written out. **Deliberately literals and not derived
#: from `ACCOUNT_PAID`**, which is the mutation that caught this file: a test
#: parametrised over the set it is checking collects *zero cases* the moment
#: somebody widens that set, and pytest reports zero cases as a pass. The
#: derived half is `test_the_two_sides_are_the_classification_written_above`,
#: which fails when these lists and the set stop agreeing.
ARTIFACT_PURPOSES = (Purpose.SUMMARY, Purpose.CHAT, Purpose.TAG)
SHARED_PURPOSES = (Purpose.EMBED, Purpose.TRANSLATE, Purpose.RAG_QUERY)


@pytest.mark.parametrize("purpose", ARTIFACT_PURPOSES, ids=lambda p: p.value)
def test_an_artifact_is_paid_for_by_the_account_that_asked(
    session: Session, user: User, operator_key: str, purpose: Purpose
) -> None:
    """Summary, Chat and Tag run spend the caller's Key and never the Operator's."""
    _seed_key(session, f"byok-{purpose.value}", user.id, secret="mine")

    resolved = resolve_ai_key(session, user_id=user.id, purpose=purpose)

    assert resolved.api_key == "mine"
    assert resolved.credential_id == f"byok-{purpose.value}"
    assert resolved.api_key != operator_key, (
        "an Artifact resolved the Operator Key, which is the exact bill BYOK "
        "exists to stop"
    )


@pytest.mark.parametrize("purpose", SHARED_PURPOSES, ids=lambda p: p.value)
def test_shared_work_is_paid_for_by_the_deployment(
    session: Session, user: User, operator_key: str, purpose: Purpose
) -> None:
    """Embeddings, Translation and the RAG query embedding stay on the Operator.

    Seeded with an Account Key that is *available* and must not be chosen. A
    version of this test with no Account Key would pass against an
    implementation that simply fell back, which is the fallback ADR-016 forbids.
    """
    _seed_key(session, "byok-shared", user.id, secret="mine")

    resolved = resolve_ai_key(session, user_id=user.id, purpose=purpose)

    assert resolved.api_key == operator_key
    assert resolved.credential_id is None, (
        "the Operator Key came back naming a row, so a rejection would clear "
        "some Account's validation stamp for a call it did not make"
    )


def test_an_account_with_no_key_is_told_to_add_one(
    session: Session, user: User, operator_key: str
) -> None:
    """No fallback, and a message that names the fix.

    The status matters as much as the string: this is the Account's own
    configuration, so it is a 4xx, distinct from the 502 a rejected Key answers
    and from the 503 a missing *Operator* Key answers.
    """
    with pytest.raises(HTTPException) as raised:
        resolve_ai_key(session, user_id=user.id, purpose=Purpose.SUMMARY)

    assert raised.value.status_code == 400
    assert raised.value.detail == AI_KEY_MISSING_DETAIL


def test_a_rejected_key_says_something_different_from_no_key(
    session: Session, user: User, operator_key: str
) -> None:
    """The two failures the environment-key check used to answer as one.

    "Add a key" and "the key you added stopped working" send somebody to
    different places. Today's single 503 sends the second person hunting for a
    Key they can see in their own settings.
    """
    _seed_key(session, "byok-dead", user.id, validated=False)

    with pytest.raises(HTTPException) as raised:
        resolve_ai_key(session, user_id=user.id, purpose=Purpose.SUMMARY)

    assert raised.value.status_code == 502
    assert raised.value.detail == AI_KEY_REJECTED_DETAIL
    assert raised.value.detail != AI_KEY_MISSING_DETAIL


def test_a_working_key_wins_over_a_rejected_one(
    session: Session, user: User, operator_key: str
) -> None:
    """Holding two Keys and naming neither picks one that still works.

    Otherwise an Account whose old Key was revoked has to delete it before the
    new one is usable, which is a support ticket rather than a feature.
    """
    _seed_key(session, "byok-dead", user.id, secret="dead", validated=False)
    _seed_key(session, "byok-live", user.id, secret="live", validated=True)

    assert (
        resolve_ai_key(session, user_id=user.id, purpose=Purpose.SUMMARY).api_key
        == "live"
    )


def test_a_foreign_key_is_refused_before_it_is_decrypted(
    session: Session, user: User, other_user: User, operator_key: str
) -> None:
    """Multi-user-tenancy ticket 33, arriving early enough to be prevented.

    That defect resolved `publishBotId` by primary key alone, so a Summary could
    name another Account's credential and the scheduler decrypted and sent with
    it. `aiKeyId` is the same client-supplied primary key on the same shape of
    row. The refusal is a 404 with this family's own string, so "not yours" and
    "not there" are the same answer — the enumeration oracle `assert_owner`
    argues about at length.

    **Mutation:** drop the `row.user_id != user_id` leg of the check in
    `resolve_ai_key` and this fails, returning the other Account's secret.
    """
    _seed_key(session, "byok-theirs", other_user.id, secret="not-yours")

    with pytest.raises(HTTPException) as raised:
        resolve_ai_key(
            session,
            user_id=user.id,
            purpose=Purpose.SUMMARY,
            key_id="byok-theirs",
        )

    assert raised.value.status_code == 404
    assert raised.value.detail == AI_CREDENTIAL_NOT_FOUND


def test_a_key_that_is_not_there_answers_exactly_as_a_foreign_one(
    session: Session, user: User, other_user: User, operator_key: str
) -> None:
    """The other half of the same property, and the half that is easy to lose.

    A distinguishable refusal moves the oracle from the status line into the
    body: answering 403 for "somebody else's" and 404 for "absent" tells a
    caller which Key ids exist.
    """
    _seed_key(session, "byok-theirs", other_user.id)

    with pytest.raises(HTTPException) as raised:
        resolve_ai_key(
            session, user_id=user.id, purpose=Purpose.SUMMARY, key_id="no-such-key"
        )
    absent = (raised.value.status_code, raised.value.detail)

    with pytest.raises(HTTPException) as raised:
        resolve_ai_key(
            session, user_id=user.id, purpose=Purpose.SUMMARY, key_id="byok-theirs"
        )
    foreign = (raised.value.status_code, raised.value.detail)

    assert absent == foreign


def test_naming_your_own_key_selects_it(
    session: Session, user: User, operator_key: str
) -> None:
    """The failure mode of an ownership check is one that refuses everything."""
    _seed_key(session, "byok-a", user.id, secret="first")
    _seed_key(session, "byok-b", user.id, secret="second")

    resolved = resolve_ai_key(
        session, user_id=user.id, purpose=Purpose.SUMMARY, key_id="byok-a"
    )

    assert resolved.api_key == "first"


def test_a_deployment_with_no_operator_key_says_so(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A third message, because it is a third person's problem.

    An Account cannot fix a missing `GEMINI_API_KEY`, so telling them to add a
    Key would send them to a form that changes nothing.
    """
    monkeypatch.setattr(config.settings, "GEMINI_API_KEY", "")

    with pytest.raises(HTTPException) as raised:
        resolve_ai_key(session, user_id=user.id, purpose=Purpose.EMBED)

    assert raised.value.status_code == 503
    assert raised.value.detail == OPERATOR_KEY_MISSING_DETAIL


def test_an_unattributed_artifact_is_refused_rather_than_charged_to_the_operator(
    session: Session, operator_key: str
) -> None:
    """`run_auto_summary` still picks up Summaries whose owner is NULL.

    Nobody's Key can pay for those, and the only "helpful" answer available is
    the Operator paying — which is the default this feature exists to remove.
    """
    with pytest.raises(HTTPException) as raised:
        resolve_ai_key(session, user_id=None, purpose=Purpose.SUMMARY)

    assert raised.value.status_code == 400
    assert raised.value.detail == AI_KEY_MISSING_DETAIL


def test_the_two_sides_are_the_classification_written_above() -> None:
    """The derived half, and the reason the two lists above are literals.

    `ACCOUNT_PAID` is written in the module as the smaller set with the
    Operator's side derived, so a seventh purpose lands on the deployment's bill
    rather than on somebody's card. That default is safe and it is still a
    decision somebody has to make — so this fails when the set stops matching
    the two lists this file asserts against, which is the notification that a
    new purpose needs a case rather than only a classification.

    **Mutation:** widen `ACCOUNT_PAID` to `frozenset(Purpose)` and this goes
    red. That mutation is the reason this test exists: it left the shared-purpose
    battery collecting zero cases, and pytest calls zero cases a pass.
    """
    assert set(ARTIFACT_PURPOSES) == ACCOUNT_PAID
    assert set(SHARED_PURPOSES) == set(Purpose) - ACCOUNT_PAID
    assert set(ARTIFACT_PURPOSES) | set(SHARED_PURPOSES) == set(Purpose)
    assert not set(ARTIFACT_PURPOSES) & set(SHARED_PURPOSES)


# --------------------------------------------------------------------------
# The declared caller list
# --------------------------------------------------------------------------


def _modules_calling(function_name: str) -> set[str]:
    """Modules with a call to `function_name`, from the AST rather than a grep.

    A grep counts the docstrings in this repo that discuss these functions by
    name — this file included — which is the noise that makes a grep-based guard
    get loosened until it stops failing.
    """
    found: set[str] = set()
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "alembic" in path.parts:
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else None
            )
            if name == function_name:
                found.add(str(path.relative_to(APP_ROOT.parent)))
    return found


def test_every_provider_call_site_goes_through_the_seam() -> None:
    """No twelfth door onto an AI Provider.

    The one this catches does not fail in production. It returns a Summary, it
    charges the Operator, and nothing anywhere says so.

    **Mutation:** add a bare `get_provider(...)` to any module not listed and
    this goes red; delete an entry from `AI_KEY_CALLERS` and it goes red the
    other way.
    """
    callers = _modules_calling("get_provider") - {PROVIDER_FACTORY}

    undeclared = callers - set(AI_KEY_CALLERS)
    assert not undeclared, (
        f"{sorted(undeclared)} builds an AI Provider without being declared in "
        "AI_KEY_CALLERS, so nothing checks that it resolved a Key first — an "
        "Artifact on that path is charged to the Operator silently. Route it "
        "through resolve_ai_key and declare it, or state why it cannot be."
    )

    stale = set(AI_KEY_CALLERS) - callers
    assert not stale, (
        f"{sorted(stale)} is declared as an AI call site and no longer builds a "
        "Provider — an exemption nothing explains is the shape CLAUDE.md's "
        "guard-table preamble warns about"
    )

    for module, reason in AI_KEY_CALLERS.items():
        assert len(reason.strip()) >= 40, f"{module}'s reason does not explain itself"


def test_every_declared_caller_resolves_a_key() -> None:
    """Declaring a module is not the same as routing it through the seam.

    Membership alone would be satisfied by adding a name to the dict, which is a
    one-line way to turn the guard above off. Every module that builds a
    Provider must also call `resolve_ai_key`, and both facts come from the same
    walk.
    """
    resolvers = _modules_calling("resolve_ai_key")
    missing = set(AI_KEY_CALLERS) - resolvers
    assert not missing, (
        f"{sorted(missing)} is declared as an AI call site but never calls "
        "resolve_ai_key, so it is on the list and outside the rule"
    )


def test_the_guard_can_actually_see_the_call_sites() -> None:
    """A walk that finds nothing passes for the wrong reason.

    Six false passes were caught this way during the simplification programme,
    one of them a guard that could not fail at all. If `get_provider` is renamed
    or the AST walk breaks, the two tests above go green while enforcing
    nothing — so pin the fact that the walk sees something.
    """
    assert _modules_calling("get_provider") >= set(AI_KEY_CALLERS) | {
        PROVIDER_FACTORY
    }, "the AST walk stopped finding the call sites it is supposed to police"
    assert _modules_calling("resolve_ai_key"), (
        "the walk found no caller of resolve_ai_key at all"
    )
