"""The tenancy seam is inert while the flag is off — and complete either way (ticket 03).

`services/tenancy.py` is the one place that answers "which rows may this User
see". It ships **disabled**: `TENANCY_ENFORCED=False` makes `scoped_select`
return the caller's statement untouched, so it can be adopted by one batch of
call sites at a time without any batch changing a response. That property is
what makes the seam shippable green ahead of the ~40 read paths that will use
it, and it is the first thing this file asserts.

## Why the classification is the load-bearing part

The helper is small. The decision it encodes is not: every table in the schema
is either private to a User, reachable through the Channels they follow, or
deliberately shared by everyone. Get that wrong once and the flip in ticket 21
either leaks a row or hides one, and both look like "the seam works" from a
green suite that never asked which rows there were.

So `test_every_table_model_is_classified` fails on a model nobody has placed.
Being forced to answer "what kind of data is this?" at the moment the table is
created is the entire value; a model added later and quietly left unscoped is
exactly the hole the seam exists to close.

## Watched to fail

Per `CLAUDE.md`, each assertion here was mutation-tested:

* delete an entry from `SCOPES` → the classification test fails
* return the scoped select regardless of the flag → the byte-identical test fails
* read `settings.TENANCY_ENFORCED` in a second module, or in `scripts/` → the
  single-read test fails
* raise 403 instead of 404 from `assert_owner` → the enumeration test fails
* give `assert_owner`'s `detail` a default → the required-detail test fails
* give `scope_of` a `Session` parameter, keyword-only, on an `async def` → the
  no-I/O test fails
* declare a table in a fourth `app/models*.py` → the classification test fails

Three of those were holes found by review rather than by design, and each is
the same shape: a guard that checks one spelling of the thing it forbids. The
`Session` check read only `FunctionDef.args.args`; the model walk named three
modules instead of finding them; the flag scan covered `app/` but not the
`scripts/` directory the audit tooling lands in.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import pathlib
import uuid

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, select

from app.core.config import settings
from app.models_tg import SyncMeta
from app.services import tenancy
from app.services.tenancy import (
    FOLLOW_KEYS,
    OUT_OF_SCOPE,
    OWNER_COLUMN,
    SCOPES,
    Scope,
    assert_owner,
    scope_of,
    scoped_select,
    tenancy_enforced,
    unscoped_select,
)

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
SCRIPTS_DIR = BACKEND_DIR / "scripts"
TENANCY_MODULE = APP_DIR / "services" / "tenancy.py"


def _model_modules() -> list[str]:
    """Every `app/models*.py` on disk, found rather than remembered."""
    return sorted(p.stem for p in APP_DIR.glob("models*.py"))


def _table_models() -> list[type[SQLModel]]:
    """Every mapped table class the app declares, from all three model modules.

    Recursive on purpose: `User` and `Item` descend from `UserBase`/`ItemBase`,
    so a single level of `__subclasses__()` misses exactly the two template
    tables — and a classification guard that cannot see a table is the false
    pass this file exists to avoid.
    """
    # Discovered, not listed. A hardcoded trio is the same false pass one level
    # up: a table in a fourth module nothing else imports would be absent from
    # the walk entirely, and this guard would pass while blind to it. CLAUDE.md
    # anticipates a fourth module by name, and the plan's migration A1a adds
    # `tg_quota_usage`, so that module is coming.
    for module in _model_modules():
        importlib.import_module(f"app.{module}")

    seen: list[type[SQLModel]] = []

    def walk(cls: type[SQLModel]) -> None:
        for sub in cls.__subclasses__():
            if getattr(sub, "__tablename__", None) and sub.model_config.get("table"):
                seen.append(sub)
            walk(sub)

    walk(SQLModel)
    return seen


@pytest.fixture
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam on for one test. Nothing in the app does this yet."""
    monkeypatch.setattr(settings, "TENANCY_ENFORCED", True)


# --------------------------------------------------------------------------
# The classification
# --------------------------------------------------------------------------


def test_every_table_model_is_classified() -> None:
    """A new table must be placed before it can ship.

    This is the check that does the work. `SCOPES` says what a table *is*;
    `OUT_OF_SCOPE` says why a table is not the seam's business, with a reason
    per entry rather than a bare exemption list. An unlisted model fails here,
    which is the only moment where "who owns these rows?" is cheap to answer.
    """
    on_disk = {cls.__name__ for cls in _table_models()}
    declared = {cls.__name__ for cls in SCOPES} | {cls.__name__ for cls in OUT_OF_SCOPE}

    unplaced = sorted(on_disk - declared)
    assert not unplaced, (
        f"Table model(s) with no tenancy classification: {unplaced}. "
        f"Add each to SCOPES as one of {[s.value for s in Scope]}, or to "
        f"OUT_OF_SCOPE with a reason. Leaving a table unplaced is how the flip "
        f"in ticket 21 silently leaks or hides its rows."
    )

    stale = sorted(declared - on_disk)
    assert not stale, f"Classified but no longer a table model: {stale}"


def test_model_modules_match_what_alembic_imports() -> None:
    """The walk and the migration autogenerator must see the same modules.

    `alembic/env.py` importing a model module is what makes it visible to
    autogenerate; this file importing it is what makes it visible to the
    classification. A module in one list and not the other means either a
    silently empty migration or an unclassified table, and both fail quietly.
    """
    env = (APP_DIR / "alembic" / "env.py").read_text()
    missing = [m for m in _model_modules() if m not in env]

    assert not missing, (
        f"`app/{missing}` exists but alembic/env.py does not import it — "
        f"autogenerate cannot see its tables and will produce an empty "
        f"migration rather than an error."
    )


def test_out_of_scope_entries_state_a_reason() -> None:
    """An exemption nothing explains becomes a leftover nobody dares touch."""
    for model, reason in OUT_OF_SCOPE.items():
        assert len(reason.strip()) > 30, (
            f"{model.__name__} is exempt from tenancy scoping with no real "
            f"reason given. Say why the rows are not a User's, or classify it."
        )


def test_corpus_models_are_the_ones_the_plan_names() -> None:
    """The shared corpus is a decision, so it is pinned, not inferred.

    `tg_discover_probes` and `tg_sync_meta` are shared *and* not reachable
    through a follow: a probe is a fact about a handle ("cannot be followed by
    anyone") and an etag is a cache marker. Everything else in the corpus hangs
    off a channel and is therefore follow-scoped. Widening this set is how the
    corpus quietly becomes a place to hide an unscoped read.
    """
    corpus = {cls.__name__ for cls, s in SCOPES.items() if s is Scope.CORPUS}
    assert corpus == {"DiscoverHandleProbe", "SyncMeta"}


def test_every_follow_scoped_model_records_its_channel_key() -> None:
    """Ticket 04 writes the EXISTS; this is the column it joins on.

    Recorded now because it is easy to misremember: `Channel.id` *is* the
    handle, and every other corpus table repeats that handle as `channel_name`
    rather than referencing a surrogate id. A follow-scoped model with no key
    here would leave ticket 04 guessing.
    """
    follow_scoped = {m for m, s in SCOPES.items() if s is Scope.FOLLOW_SCOPED}

    assert set(FOLLOW_KEYS) == follow_scoped

    for model, column in FOLLOW_KEYS.items():
        assert column in model.model_fields, (
            f"{model.__name__}.{column} is the declared follow key but is not "
            f"a column on the model."
        )


def test_user_owned_models_all_have_a_user_id_column() -> None:
    """The branch is `Model.user_id == user_id`, so the column has to exist.

    Without this the mistake surfaces as an `AttributeError` on the day the flag
    flips, in whichever read path happened to run first.
    """
    for model, scope in SCOPES.items():
        if scope is Scope.USER_OWNED:
            assert OWNER_COLUMN in model.model_fields, (
                f"{model.__name__} is classified user-owned but has no "
                f"`user_id` column to scope on."
            )


# --------------------------------------------------------------------------
# Disabled: byte-identical to what shipped
# --------------------------------------------------------------------------


def test_the_flag_ships_off() -> None:
    """Ticket 21 flips it. Until then a fresh checkout must behave as it did."""
    assert settings.TENANCY_ENFORCED is False
    assert tenancy_enforced() is False


@pytest.mark.parametrize("model", sorted(SCOPES, key=lambda m: m.__name__))
def test_disabled_scoping_changes_no_query(model: type[SQLModel]) -> None:
    """Every branch returns the unscoped select while the flag is off.

    Compiled SQL, not object identity: the point is that the database receives
    the same text it received before the seam existed, for every model,
    including the follow-scoped ones whose real branch is not written yet.
    """
    plain = select(model)
    scoped = scoped_select(plain, model, uuid.uuid4())

    assert str(scoped.compile()) == str(plain.compile())


def test_disabled_ownership_assertion_never_raises() -> None:
    """Adopting `assert_owner` early must not start rejecting today's requests.

    Every row in a single-operator database was written by the operator, but
    plenty carry a NULL `user_id` from before the stamp existed. Enforcing on
    those would fail closed against the only account there is.
    """
    assert_owner(uuid.uuid4(), uuid.uuid4(), detail="Summary not found")
    assert_owner(None, uuid.uuid4(), detail="Summary not found")


# --------------------------------------------------------------------------
# Enabled: what the branches actually do
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_enabled_user_owned_filters_on_the_owner() -> None:
    user_id = uuid.uuid4()
    model = next(m for m, s in SCOPES.items() if s is Scope.USER_OWNED)

    compiled = str(scoped_select(select(model), model, user_id).compile())

    assert "WHERE" in compiled
    assert "user_id" in compiled


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize(
    "model", sorted((m for m, s in SCOPES.items() if s is Scope.CORPUS), key=str)
)
def test_enabled_corpus_stays_unscoped(model: type[SQLModel]) -> None:
    """Deliberate, and asserted so it reads as a decision rather than an omission."""
    plain = select(model)

    assert str(scoped_select(plain, model, uuid.uuid4()).compile()) == str(
        plain.compile()
    )


@pytest.mark.usefixtures("enforced")
def test_enabled_follow_scoped_refuses_until_the_table_exists() -> None:
    """The one branch ticket 03 cannot finish, failing loudly rather than open.

    `tg_channel_follows` arrives in ticket 04. A follow-scoped model asked to
    scope before then has no way to answer, and the two wrong answers are
    "return everything" (a leak) and "return nothing" (a silent outage). It
    raises instead, naming the ticket, so flipping the flag early is a crash on
    the first query rather than a data-visibility bug found in production.
    """
    model = next(m for m, s in SCOPES.items() if s is Scope.FOLLOW_SCOPED)

    with pytest.raises(NotImplementedError, match="ticket 04"):
        scoped_select(select(model), model, uuid.uuid4())


@pytest.mark.usefixtures("enforced")
def test_enabled_ownership_mismatch_is_404_not_403() -> None:
    """403 confirms the row exists. That is an enumeration oracle.

    "You may not see this" and "there is nothing here" are the same answer to
    someone who should not know the difference, and the cheaper one to give is
    the one that leaks nothing.
    """
    with pytest.raises(HTTPException) as raised:
        assert_owner(uuid.uuid4(), uuid.uuid4(), detail="Summary not found")

    assert raised.value.status_code == 404


@pytest.mark.usefixtures("enforced")
def test_enabled_ownership_allows_the_owner_and_refuses_an_unstamped_row() -> None:
    user_id = uuid.uuid4()

    # The owner's own row: no exception is the assertion.
    assert_owner(user_id, user_id, detail="Summary not found")

    # A NULL owner belongs to nobody once the seam is live. Before the backfill
    # it means "written before the stamp existed"; after it, it is a bug.
    with pytest.raises(HTTPException) as raised:
        assert_owner(None, user_id, detail="Summary not found")

    assert raised.value.status_code == 404


def test_ownership_detail_is_required_and_has_no_default() -> None:
    """The status code is only half the answer; the body is the other half.

    Every 404 in this codebase names its resource — `"Summary not found"`,
    `"Channel not found"`, `f"{log_type} log not found"`. A generic default
    here would make "someone else owns it" and "it is not there" tell apart by
    reading the payload, moving the enumeration oracle from the status line to
    the body rather than closing it. There must be no default to fall into.
    """
    detail = inspect.signature(assert_owner).parameters["detail"]

    assert detail.default is inspect.Parameter.empty
    assert detail.kind is inspect.Parameter.KEYWORD_ONLY


@pytest.mark.usefixtures("enforced")
def test_a_foreign_row_answers_exactly_what_a_missing_row_answers() -> None:
    """The two cases must be byte-identical, which is the caller's job.

    Simulated here with the string a route would pass: whatever it says when
    the id does not exist is what it must say when the id is not yours.
    """
    route_detail = "Summary not found"

    with pytest.raises(HTTPException) as raised:
        assert_owner(uuid.uuid4(), uuid.uuid4(), detail=route_detail)

    assert (raised.value.status_code, raised.value.detail) == (404, route_detail)


def test_unscoped_select_demands_a_written_reason() -> None:
    """Reading across accounts is allowed; doing it silently is not.

    Admin export and `routes/data/admin.py` genuinely read every account. The
    function is a no-op by construction — its entire value is that the call
    site is greppable and carries a reason, so a deliberate cross-user read is
    never mistaken for a forgotten filter.
    """
    reason = inspect.signature(unscoped_select).parameters["reason"]

    assert reason.default is inspect.Parameter.empty
    assert reason.kind is inspect.Parameter.KEYWORD_ONLY

    plain = select(SyncMeta)
    assert str(unscoped_select(plain, reason="admin export").compile()) == str(
        plain.compile()
    )


def test_unknown_model_is_rejected_rather_than_passed_through() -> None:
    """Failing open on an unclassified model would defeat the whole seam."""

    class Unclassified(SQLModel):
        pass

    with pytest.raises(KeyError):
        scope_of(Unclassified)


# --------------------------------------------------------------------------
# The module's own properties
# --------------------------------------------------------------------------


def test_flag_is_read_in_exactly_one_place() -> None:
    """The failure mode of a flag is always the fourteenth place it got read.

    One reader means the seam can be turned on, profiled, or temporarily forced
    in a test by touching one function. Fourteen readers means the flag is now
    a convention, and conventions drift — this is the same shape as the two auth
    gates that disagreed for months.
    """
    # `app/` and `scripts/` both: the plan puts `audit_tenancy_drift.py` and
    # `backfill_channel_follows.py` in scripts/, and an audit tool reading the
    # flag directly is exactly the fourteenth reader this guard is about.
    searched = [*APP_DIR.rglob("*.py"), *SCRIPTS_DIR.rglob("*.py")]
    readers = sorted(
        path.relative_to(BACKEND_DIR).as_posix()
        for path in searched
        if "TENANCY_ENFORCED" in path.read_text()
    )

    assert readers == ["app/core/config.py", "app/services/tenancy.py"], (
        f"`TENANCY_ENFORCED` is named in {readers}. It is declared in "
        f"app/core/config.py and read in app/services/tenancy.py::"
        f"tenancy_enforced, and nowhere else. Call that function instead."
    )


def test_the_seam_executes_nothing() -> None:
    """A pure transform builds queries and runs none of them.

    `test_service_kinds.py` already fails if this module imports `Session` —
    that check is import-level, which is the cheap half. This is the other half:
    no `.exec(`, no `.execute(`, no `.commit(`. The seam has to stay callable
    from a test with no database, because a scoping rule you need a fixture to
    check is a scoping rule nobody checks.
    """
    tree = ast.parse(TENANCY_MODULE.read_text(), filename=str(TENANCY_MODULE))
    executions = [
        f"{node.func.attr} at line {node.lineno}"
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in {"exec", "execute", "commit", "scalars", "all"}
    ]

    assert not executions, (
        f"tenancy.py runs a query: {executions}. It builds statements and "
        f"returns them; the caller owns the session and the transaction."
    )


def test_the_seam_takes_no_session() -> None:
    """Stated positively so the reason survives, not just the state."""
    tree = ast.parse(TENANCY_MODULE.read_text(), filename=str(TENANCY_MODULE))
    # All three argument kinds, and async defs too. A first draft checked only
    # `FunctionDef.args.args`, which meant `async def f(*, session: Session)`
    # sailed through a guard whose whole subject is that parameter.
    names = {
        ast.unparse(arg.annotation)
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
        for arg in (
            *node.args.posonlyargs,
            *node.args.args,
            *node.args.kwonlyargs,
        )
        if arg.annotation is not None
    }

    assert not {n for n in names if "Session" in n}, (
        "tenancy.py takes a Session. It is classified a pure transform in "
        "test_service_kinds.py; either drop the parameter or reclassify it."
    )


def test_module_is_registered_as_a_pure_transform() -> None:
    """The classification and the guard that enforces it stay in step."""
    from tests.services.test_service_kinds import INVENTORY, PURE_TRANSFORM

    assert INVENTORY.get("tenancy.py") == PURE_TRANSFORM


def test_docstring_names_the_disabled_default() -> None:
    """Whoever opens this module next must learn the flag is off before reading on."""
    assert tenancy.__doc__ is not None
    assert "TENANCY_ENFORCED" in tenancy.__doc__
