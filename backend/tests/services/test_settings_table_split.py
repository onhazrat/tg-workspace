"""Deployment settings and personal settings live in two tables (ticket 06).

`tg_app_settings` is global: one row per key, no owner, what an Admin sets for
the deployment. `tg_user_settings` is personal: one row per key *per User*.
Two tables rather than one table with a nullable owner, because the nullable
owner is the ambiguity `operator.py` had — a row with `user_id IS NULL` reads
identically as "belongs to everyone" and "nobody stamped it", and those have
opposite consequences the moment enforcement flips in ticket 21.

## Why a registry, and why it carries reasons

The split is only worth its migration if a key cannot drift across it. So
`services/settings_registry.py` names every key exactly once, with a sentence
saying why it is deployment policy or personal preference. A key nobody
classified fails `test_every_key_is_classified` — which is the one moment when
"whose setting is this?" is cheap to answer, the same argument `tenancy.py`
makes for tables.

## Why the sync key is carved three ways

`sync` was three different things in one JSON blob: scheduler counters the app
writes (`consecutiveFailures`, `autoSyncPauseUntil`, the partial-sweep cursor),
deployment policy an Admin sets (`syncConcurrency`, the tick interval), and
per-channel defaults a person picks (`globalStartTimeMode`, the dynamic-sync
defaults). Every writer did a read-modify-write of the *whole* blob
(`auto_sync._update_sync_state`), so a person saving their start-time
preference rewrote the scheduler's failure counter with whatever their browser
last read. That is the "any User can overwrite scheduler state" the ticket
names, and splitting the blob is what removes it — not a permission check,
which would still let the last writer win.

`GET`/`PUT /data/settings/sync` keep their exact wire shape over the top. The
frontend has three call sites that write runtime fields by name
(`App.tsx`, `commands/actions.ts`, `commands/extended-commands.ts` all pause or
resume auto-sync through this endpoint), so the facade routes each field to its
home rather than dropping it. Dropping would have been the tidier rule and a
silently broken Pause button.

## Watched to fail

Per `CLAUDE.md`, this file was watched to fail. Eight defects were applied one
at a time and each turned it red; the last line confirms it went green again:

1. declare `"jobs"` in `USER_KEYS` as well → the disjoint test fails
2. add a field to `_default_sync()` and to no `SYNC_*_FIELDS` set → the
   partition test fails
3. drop `require_home` from `settings_store` → the refusal test fails
4. drop `require_home` from `user_settings` → the other refusal test fails
5. drop the runtime section from `split_sync_payload` → the Pause-button test
   fails, which is the regression a tidier "runtime has no business in a PUT"
   rule would have shipped
6. have `home_for` return `Home.GLOBAL` for an unknown key instead of raising
   → the unknown-key test fails
7. construct `UserSetting` in a third module → the single-writer walk fails
8. stop merging the runtime row in `load_sync_settings` → the wire-shape test
   fails

Two of the assertions here exist *because* a first draft was wrong rather than
by design, which is the same pattern `test_tenancy_seam.py` records. The
original "one person's preference does not move the scheduler" test claimed a
whole-blob write would be filtered; it cannot be, and the honest guarantee is
narrower — see that test. And the file originally ended with a bare
`db.exec(select(UserSetting))`, which hung the entire suite rather than failing
it: see the `db` fixture.
"""

from __future__ import annotations

import ast
import pathlib
import uuid
from collections.abc import Generator

import pytest
from sqlmodel import Session

from app.core.db import engine
from app.jobs.settings import (
    _default_sync,
    load_sync_settings,
    save_sync_settings,
)
from app.models_tg import AppSetting, UserSetting
from app.services.settings_registry import (
    GLOBAL_KEYS,
    SYNC_KEY,
    SYNC_POLICY_FIELDS,
    SYNC_PREF_FIELDS,
    SYNC_PREFS_KEY,
    SYNC_RUNTIME_FIELDS,
    SYNC_RUNTIME_KEY,
    USER_KEYS,
    Home,
    home_for,
)
from app.services.settings_store import (
    get_global_setting,
    put_global_setting,
)
from app.services.user_settings import get_user_setting, put_user_setting
from tests.utils.user import create_random_user

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"

#: The only modules allowed to construct or write each settings model. One
#: writer per table is what makes the registry's refusal unbypassable: a second
#: writer would be a second opinion about where a key belongs.
GLOBAL_WRITERS = {"app/services/settings_store.py"}
USER_WRITERS = {"app/services/user_settings.py"}


@pytest.fixture
def db() -> Generator[Session]:
    """A session of this test's own, closed before the autouse TRUNCATE runs.

    Not the session-scoped `db` fixture from `conftest`. Every read here is a
    plain `session.get`, which opens a transaction and — on a session-scoped
    session nothing commits — leaves it *idle in transaction* holding a lock on
    the row it read. The `TRUNCATE` in `_clean_tg_tables_after_test` then blocks
    on that lock forever, and the suite hangs rather than fails. Teardown here
    runs before the autouse one, so the transaction is always closed first.

    It deliberately does not chain to the conftest fixture: that one is
    session-scoped, and requesting it is what would keep the long-lived
    transaction alive in the first place. Nothing here needs `init_db` — the
    accounts these tests use are made by `create_random_user`.
    """
    with Session(engine) as session:
        yield session


@pytest.fixture
def user_id(db: Session) -> uuid.UUID:
    """A real account, because `tg_user_settings.user_id` is a real foreign key.

    Following `ChannelFollow` (ticket 04): the column cascades on delete, so a
    settings row cannot outlive the account it belongs to. A bare `uuid4()`
    would fail the constraint, which is the point.
    """
    return create_random_user(db).id


# --------------------------------------------------------------------------
# The registry
# --------------------------------------------------------------------------


def test_the_two_key_sets_are_disjoint() -> None:
    """ "Distinct keys" is the whole point: a key has exactly one home.

    Overlap would mean the same name addressing two rows in two tables, and
    every read would need to know which one the caller meant — which is the
    convention this ticket replaced with a schema fact.
    """
    overlap = sorted(set(GLOBAL_KEYS) & set(USER_KEYS))

    assert not overlap, (
        f"Key(s) declared both global and per-User: {overlap}. A key lives in "
        f"exactly one table; pick one and say why in that dict's reason."
    )


def test_every_classified_key_states_a_reason() -> None:
    """An entry nothing explains becomes a leftover nobody dares move."""
    for key, reason in {**GLOBAL_KEYS, **USER_KEYS}.items():
        assert len(reason.strip()) > 30, (
            f"Settings key {key!r} is classified with no real reason given. "
            f"Say why it is deployment policy or personal preference."
        )


def test_every_key_the_app_uses_is_classified() -> None:
    """A key read or written anywhere must have been placed first.

    Found by walking the source rather than listed here, because a list is the
    thing that goes stale: the failure mode is a new key added to one loader
    and to nobody's classification, which reads fine until it lands in the
    wrong table.
    """
    unplaced = sorted(_string_keys_in_source() - set(GLOBAL_KEYS) - set(USER_KEYS))

    assert not unplaced, (
        f"Settings key(s) used in app/ but not classified: {unplaced}. Add "
        f"each to GLOBAL_KEYS or USER_KEYS in services/settings_registry.py "
        f"with a reason."
    )


def test_home_for_refuses_an_unknown_key() -> None:
    """Defaulting an unknown key to either table is how drift starts.

    The tempting default is "global, like it used to be". That silently files
    a personal setting where every account shares it, and nothing looks wrong
    until two people disagree about a value.
    """
    with pytest.raises(KeyError):
        home_for("a-key-nobody-declared")

    assert home_for("jobs") is Home.GLOBAL
    assert home_for(SYNC_PREFS_KEY) is Home.USER


def test_scheduler_runtime_state_is_global() -> None:
    """The ticket's second checkbox, asserted rather than assumed.

    These four are written by the scheduler itself and read by nothing a person
    edits. In the per-User table they would be per-account counters for a
    single-process scheduler, which is meaningless — and worse, invisible: the
    scheduler would read one account's pause and honour it for everyone.
    """
    assert home_for(SYNC_RUNTIME_KEY) is Home.GLOBAL
    assert SYNC_RUNTIME_FIELDS == frozenset(
        {
            "consecutiveFailures",
            "autoSyncPauseUntil",
            "autoSyncPartialCursor",
            "autoSyncPartialBatchSize",
        }
    )


def test_every_sync_field_has_exactly_one_home() -> None:
    """The carve is a partition of the old blob, not a subset of it.

    A field in none of the three sets vanishes on the first write — the facade
    would have nowhere to route it and would drop it silently. A field in two
    would be written twice and read back from whichever the merge order
    happened to favour.
    """
    homes = [SYNC_POLICY_FIELDS, SYNC_RUNTIME_FIELDS, SYNC_PREF_FIELDS]
    declared = set().union(*homes)
    on_disk = set(_default_sync())

    assert declared == on_disk, (
        f"sync field(s) with no home: {sorted(on_disk - declared)}; "
        f"declared but not a sync field: {sorted(declared - on_disk)}"
    )

    for i, first in enumerate(homes):
        for second in homes[i + 1 :]:
            assert not first & second, (
                f"sync field(s) in two homes: {sorted(first & second)}"
            )


# --------------------------------------------------------------------------
# The two aggregates refuse each other's keys
# --------------------------------------------------------------------------


def test_the_global_store_refuses_a_per_user_key(db: Session) -> None:
    """The guard the plan names: writing `sync_prefs` globally must fail."""
    with pytest.raises(ValueError, match=SYNC_PREFS_KEY):
        put_global_setting(db, SYNC_PREFS_KEY, {"globalStartTimeMode": "relative"})


def test_the_user_store_refuses_a_global_key(db: Session, user_id: uuid.UUID) -> None:
    """And the mutation the plan names: writing `jobs` to the user table."""
    with pytest.raises(ValueError, match="jobs"):
        put_user_setting(db, "jobs", {"auto_sync": {"enabled": False}}, user_id=user_id)


def test_reads_refuse_the_wrong_table_too(db: Session, user_id: uuid.UUID) -> None:
    """A read from the wrong table returns an empty dict, not an error.

    That is the dangerous direction: a misrouted *write* is loud, a misrouted
    *read* quietly serves defaults and looks like "the setting was never set".
    """
    with pytest.raises(ValueError, match="jobs"):
        get_user_setting(db, "jobs", user_id=user_id)

    with pytest.raises(ValueError, match=SYNC_PREFS_KEY):
        get_global_setting(db, SYNC_PREFS_KEY)


def test_per_user_rows_do_not_collide(db: Session) -> None:
    """Two accounts hold the same key at once — the point of the second table.

    In the old single-table shape the second writer overwrote the first, since
    `key` alone was the primary key. This is the assertion that would have
    caught that.
    """
    a, b = create_random_user(db).id, create_random_user(db).id
    put_user_setting(db, SYNC_PREFS_KEY, {"globalStartTimeValue": 7}, user_id=a)
    put_user_setting(db, SYNC_PREFS_KEY, {"globalStartTimeValue": 30}, user_id=b)

    assert get_user_setting(db, SYNC_PREFS_KEY, user_id=a)["globalStartTimeValue"] == 7
    assert get_user_setting(db, SYNC_PREFS_KEY, user_id=b)["globalStartTimeValue"] == 30


# --------------------------------------------------------------------------
# The facade keeps the wire shape
# --------------------------------------------------------------------------


def test_the_facade_returns_the_whole_blob(db: Session, user_id: uuid.UUID) -> None:
    """`GET /data/settings/sync` must look exactly as it did before the split.

    Not "a superset" and not "the fields the caller happens to read" — the
    frontend hydrates its settings store from this payload key by key, so a
    missing key silently reverts that setting to its browser default.
    """
    merged = load_sync_settings(db, user_id=user_id)

    assert set(merged) == set(_default_sync())


def test_a_write_lands_in_the_table_its_field_belongs_to(
    db: Session, user_id: uuid.UUID
) -> None:
    """One PUT of the old blob shape, fanned out to three rows."""
    save_sync_settings(
        db,
        {
            "syncConcurrency": 9,
            "autoSyncPauseUntil": 1234,
            "globalStartTimeMode": "relative",
        },
        user_id=user_id,
    )

    assert get_global_setting(db, SYNC_KEY)["syncConcurrency"] == 9
    assert get_global_setting(db, SYNC_RUNTIME_KEY)["autoSyncPauseUntil"] == 1234
    prefs = get_user_setting(db, SYNC_PREFS_KEY, user_id=user_id)
    assert prefs["globalStartTimeMode"] == "relative"

    # ...and none of it leaked into a neighbour's row.
    assert "autoSyncPauseUntil" not in get_global_setting(db, SYNC_KEY)
    assert "globalStartTimeMode" not in get_global_setting(db, SYNC_RUNTIME_KEY)


def test_pausing_auto_sync_still_works_through_the_facade(
    db: Session, user_id: uuid.UUID
) -> None:
    """The three frontend call sites that write runtime fields by name.

    `Pause Auto-Sync for 10 Minutes` PUTs `{autoSyncPauseUntil: ...}` to the
    `sync` endpoint. Routing rather than dropping is what keeps that button
    working; this is the test that fails if a later tidy-up decides runtime
    fields have no business in a PUT body.
    """
    save_sync_settings(db, {"autoSyncPauseUntil": 999}, user_id=user_id)
    assert load_sync_settings(db, user_id=user_id)["autoSyncPauseUntil"] == 999

    save_sync_settings(
        db, {"autoSyncPauseUntil": None, "consecutiveFailures": 0}, user_id=user_id
    )
    merged = load_sync_settings(db, user_id=user_id)
    assert merged["autoSyncPauseUntil"] is None
    assert merged["consecutiveFailures"] == 0


def test_one_persons_preference_does_not_move_the_scheduler(
    db: Session, user_id: uuid.UUID
) -> None:
    """The defect the split exists to remove, stated as what actually protects.

    A settings save used to read-modify-write the whole blob, so it wrote back
    whatever `consecutiveFailures` that browser last read — and the scheduler's
    own writes did the same to preferences in the other direction. The fix is
    not a filter; it is that the two now live in different rows, so a payload
    naming only one section cannot reach the other.

    **Note what this does not claim.** A caller that passes the whole
    reassembled blob back still writes every field in it, because a merge `PUT`
    cannot tell "I am setting this" from "I echoed it back". What makes that
    safe is that no caller does: `buildSectionPayload("sync", …)` is built from
    the frontend settings schema, which declares no runtime field. So the
    payload below is the real one, and the counter surviving it is the real
    guarantee.
    """
    save_sync_settings(db, {"consecutiveFailures": 4}, user_id=user_id)

    # What the settings page actually sends: policy and preferences, no counters.
    save_sync_settings(
        db,
        {
            "syncConcurrency": 6,
            "regularSyncIntervalMinutes": 45,
            "globalStartTimeMode": "absolute",
            "dynamicSyncEnabledDefault": True,
        },
        user_id=user_id,
    )

    merged = load_sync_settings(db, user_id=user_id)
    assert merged["consecutiveFailures"] == 4
    assert merged["globalStartTimeMode"] == "absolute"
    assert merged["syncConcurrency"] == 6

    # ...and the scheduler bumping its counter leaves the preference alone,
    # which is the same defect facing the other way.
    save_sync_settings(db, {"consecutiveFailures": 9})

    merged = load_sync_settings(db, user_id=user_id)
    assert merged["consecutiveFailures"] == 9
    assert merged["globalStartTimeMode"] == "absolute"
    assert merged["dynamicSyncEnabledDefault"] is True


def test_the_scheduler_reads_runtime_without_an_owner(db: Session) -> None:
    """`run_auto_sync` has no User in hand and must still see the pause.

    It reads only runtime and policy fields, both global. If the pause lived
    per-User this call would need an owner to resolve — which is exactly the
    `get_operator_user_id` fallback the plan's decision 24 dissolves.
    """
    save_sync_settings(db, {"autoSyncPauseUntil": 4242}, user_id=None)

    assert load_sync_settings(db)["autoSyncPauseUntil"] == 4242


# --------------------------------------------------------------------------
# One writer per table
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("model", "allowed"),
    [("AppSetting", GLOBAL_WRITERS), ("UserSetting", USER_WRITERS)],
)
def test_each_settings_table_has_one_writer(model: str, allowed: set[str]) -> None:
    """Construction is the signal, and it is checked by walking the AST.

    A grep for the model name would flag every import and every `session.get`,
    so it would have to be loosened until it stopped catching anything. A
    `Call` whose func is the model name is a row being made, and a row being
    made somewhere new is a second module deciding where a key belongs.
    """
    offenders: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        if "alembic" in path.parts:
            continue
        rel = path.relative_to(BACKEND_DIR).as_posix()
        if rel in allowed:
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == model
            ):
                offenders.append(f"{rel}:{node.lineno}")

    assert not offenders, (
        f"{model} is constructed outside {sorted(allowed)}: {offenders}. "
        f"Route the write through that module so the registry's refusal "
        f"cannot be bypassed."
    )


def test_the_old_blob_is_no_longer_written_whole() -> None:
    """`save_setting(session, "sync", ...)` was the read-modify-write.

    Its absence is the fix. A module reaching for it again would restore the
    lost-update the split removed, so the name is gone rather than deprecated.
    """
    settings_module = (APP_DIR / "jobs" / "settings.py").read_text()

    assert "def save_setting(" not in settings_module, (
        "jobs/settings.py still exposes the whole-blob writer. Callers must "
        "use save_sync_settings (which routes per field) or the aggregate for "
        "the key they mean."
    )


# --------------------------------------------------------------------------


def _string_keys_in_source() -> set[str]:
    """Every literal passed as the `key` argument of a settings accessor.

    Deliberately narrow: it reads the call sites rather than every string in
    `app/`, because "a string that happens to equal a key name" is noise and a
    guard that cries wolf gets loosened.
    """
    accessors = {
        "get_global_setting",
        "put_global_setting",
        "get_user_setting",
        "put_user_setting",
        "load_setting",
        "home_for",
    }
    found: set[str] = set()
    for path in APP_DIR.rglob("*.py"):
        if "alembic" in path.parts:
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            name = (
                node.func.id
                if isinstance(node.func, ast.Name)
                else getattr(node.func, "attr", None)
            )
            if name not in accessors:
                continue
            for arg in node.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    found.add(arg.value)
    return found


def test_the_key_walk_can_actually_find_something() -> None:
    """A guard that cannot fail is worse than no guard (`CLAUDE.md`).

    `_string_keys_in_source` returning an empty set would make
    `test_every_key_the_app_uses_is_classified` pass forever. This is the
    assertion that says the walk still sees the call sites it reads.
    """
    assert len(_string_keys_in_source()) >= 3


def test_the_writer_walk_can_actually_find_something() -> None:
    """Same false-pass check for the single-writer walk."""
    store = (APP_DIR / "services" / "settings_store.py").read_text()

    assert "AppSetting(" in store, (
        "The single-writer walk looks for `AppSetting(` construction; the one "
        "module allowed to do it no longer does, so the walk proves nothing."
    )


def test_the_two_tables_are_actually_two() -> None:
    """Belt and braces: the models map to different tables.

    Cheap, and it is the assertion that fails if someone later gives
    `UserSetting` the same `__tablename__` to "reuse the migration". The
    composite primary key is the half that matters — it is what stops one
    account's row from being another's.

    Takes no `Session` deliberately. An earlier draft ended with a bare
    `db.exec(select(UserSetting))` to prove the table existed, which left the
    session-scoped fixture *idle in transaction* holding a lock — and the
    autouse `TRUNCATE` after the next test blocked on it forever. Same family
    as the `run_auto_sync` transaction `CLAUDE.md` warns about; the table's
    existence is already proven by every test above that writes to it.
    """
    assert AppSetting.__tablename__ != UserSetting.__tablename__
    assert set(UserSetting.__table__.primary_key.columns.keys()) == {"key", "user_id"}
    assert set(AppSetting.__table__.primary_key.columns.keys()) == {"key"}
