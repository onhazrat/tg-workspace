"""No user-owned row survives the backfill without an owner (ticket 34).

Ticket 21 flips `TENANCY_ENFORCED`. From that moment a `USER_OWNED` row with a
NULL `user_id` is invisible to every account (`scoped_select` filters it),
refused to every reader by id (`assert_owner` answers 404) and unwritable
(`assert_owner_on_write`, which is not gated and so refuses it whichever way the
flag points). An import is one transaction, so the first such row aborts a whole
restore. This file guards the migration that stamps them all first.

## What is actually easy to get wrong here

Not the `UPDATE`. Three other things:

* **The inventory.** A hand-written table list is what the ticket exists to
  prevent — a `USER_OWNED` table added next month and forgotten stamps nothing,
  and the symptom is rows that vanish on the flip, which is indistinguishable
  from the seam working. So the migration freezes its list, `tenancy.py` derives
  the same list from `SCOPES`, and the first test here asserts they agree. A
  table added later fails this file rather than the deployment.
* **The payload tables.** `tg_summary_payloads` and `tg_chat_session_payloads`
  take *their parent's* owner, not the operator's. Every test of the naive
  version passes on a single-account database, because there the parent's owner
  and the operator are the same id. It takes a second account to tell them
  apart, so `test_a_payload_row_takes_its_parents_owner` seeds one.
* **The rows that already have an owner.** A backfill that stamps everything is
  a backfill that quietly reassigns another account's summaries to the operator,
  and nothing about the resulting database looks wrong.
* **The constraints the `UPDATE` has to satisfy**, which this file originally
  missed entirely. `tg_channel_setting_groups` has a unique index on
  `(COALESCE(user_id::text, 'global'), lower(name))`; stamping the global-scope
  presets with the operator, who holds identically-named copies, raises
  `UniqueViolation` and fails the whole revision. Review found it, not this
  file — because `_value_for` invents a unique `name` for every seeded row, so
  the index was structurally unreachable. `test_a_duplicate_setting_group_is_
  merged_rather_than_stamped` names both rows explicitly, and
  `test_the_scope_name_index_is_the_only_constraint_of_its_kind` fails if
  another such index appears.

## Watched to fail

Per `CLAUDE.md`, every assertion here was mutation-tested:

* drop a table from the migration's `BACKFILL_TABLES` → the frozen-inventory
  test fails, and so does the no-unowned-row sweep
* stamp payload rows with the operator instead of the parent's owner (or run
  the operator pass first) → `test_a_payload_row_takes_its_parents_owner` fails,
  **and only that one** — every other test in this file still passes, which is
  the point of seeding a second account
* widen the `UPDATE` to every row rather than the unowned ones → the
  live-owner test fails
* treat an orphan id as owned → the orphan test fails
* return quietly instead of raising when no account exists → the refusal test
  fails
* delete the rows in that branch instead of raising → the same test fails on
  its surviving-rows assertion
* add `tg_posts` or `tg_channels` to the inventory → the shared-table test fails
* skip the reconciliation and let the blanket `UPDATE` reach
  `tg_channel_setting_groups` → the duplicate-group test fails with the real
  `UniqueViolation`, **and only that one**
* resolve the collision by deleting every unowned group instead of merging →
  the adopt-a-group-with-no-counterpart test fails

Every test here also passes **on its own**, which two of them originally did
not: a freshly migrated database holds the seeded global presets, and they were
relying on an earlier test's truncation to clear them. The autouse fixture
empties the fourteen tables before each test rather than only after.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import pathlib
import types
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
import sqlalchemy as sa
from sqlmodel import Session, SQLModel, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import Channel, Post
from app.services.follows import get_operator_user_id
from app.services.tenancy import (
    OWNER_COLUMN,
    SCOPES,
    Scope,
    mapped_table,
    owner_backfill_inventory,
)
from tests.utils.user import create_random_user

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[2]
MIGRATION_PATH = (
    BACKEND_DIR
    / "app"
    / "alembic"
    / "versions"
    / "c0d1e2f3a4b5_backfill_owners_ticket_34.py"
)

#: Every model the seam classifies, by table name, so the seeding helpers can
#: work from the derived inventory instead of a second list of their own.
MODELS_BY_TABLE: dict[str, type[SQLModel]] = {
    mapped_table(model).name: model for model in SCOPES
}

UNOWNED_SQL = 'user_id IS NULL OR user_id NOT IN (SELECT id FROM "user")'


def load_migration() -> types.ModuleType:
    """Import the revision file directly.

    Alembic's `versions/` is not a package, so this is the only way to reach
    the migration's own code. Reaching it matters: the alternative is asserting
    against a copy of the logic living in `app/`, which is a test that passes
    while the thing that actually runs on deploy does something else.
    """
    spec = importlib.util.spec_from_file_location("ticket_34_backfill", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def other_user(session: Session) -> Iterator[User]:
    """A second account, which is what makes the payload tests able to fail."""
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def migration() -> types.ModuleType:
    return load_migration()


@pytest.fixture(autouse=True)
def _clean_backfill_tables() -> Iterator[None]:
    """Empty the fourteen tables *before* each test, not only after.

    `conftest.py` truncates after every test, which is enough for a suite run
    and not enough here: a freshly migrated database already holds the
    global-scope setting-group presets the earlier migrations seed when they
    find no user, so a test that counts unowned rows passes in a full-file run
    only because something before it happened to truncate them. Review caught
    two tests relying on exactly that. Order-dependence in a guard is worse
    than a plain failure, because the guard still looks green.
    """
    _truncate_backfill_tables()
    yield


def _truncate_backfill_tables() -> None:
    tables = ", ".join(entry.table for entry in owner_backfill_inventory())
    with Session(engine) as s:
        s.execute(sa.text(f"TRUNCATE {tables} CASCADE"))  # noqa: S608
        s.commit()


# --------------------------------------------------------------------------
# Seeding
# --------------------------------------------------------------------------


def _python_type(kind: sa.types.TypeEngine[Any]) -> type:
    """The Python type behind a column type, through any decorator.

    SQLModel's `AutoString` is a `TypeDecorator` and raises
    `NotImplementedError` from `python_type`, which is most of the string
    columns in this schema — so asking the type directly covers almost nothing.
    """
    try:
        return kind.python_type
    except NotImplementedError:
        impl = getattr(kind, "impl", None)
        if impl is None:
            raise
        return _python_type(impl if isinstance(impl, sa.types.TypeEngine) else impl())


def _value_for(column: sa.Column[Any]) -> Any:
    """A throwaway value of the right type for a required column.

    Type-driven rather than a per-table literal, so a new `USER_OWNED` table is
    seeded by this file the moment it enters the inventory. A table this cannot
    fill raises here instead of being skipped — a seeding helper that silently
    covers thirteen of fourteen tables is the false pass this file is guarding
    against in the first place.
    """
    if isinstance(column.type, sa.JSON):
        return {}
    python_type = _python_type(column.type)
    if python_type is str:
        return f"t34-{uuid.uuid4().hex}"
    if python_type is bool:
        return False
    if python_type is int:
        return 0
    if python_type is float:
        return 0.0
    if python_type is uuid.UUID:
        return uuid.uuid4()
    if issubclass(python_type, dt.datetime):
        return dt.datetime.now(dt.UTC)
    raise AssertionError(
        f"no seed value for {column.table.name}.{column.name} of {python_type}"
    )


def insert_row(
    session: Session,
    table: str,
    *,
    owner: uuid.UUID | None,
    **overrides: Any,
) -> dict[str, Any]:
    """Insert one row into `table` owned by `owner`, filling what it must."""
    model = MODELS_BY_TABLE[table]
    values: dict[str, Any] = {OWNER_COLUMN: owner}
    for column in mapped_table(model).columns:
        if column.name in values or column.name in overrides:
            continue
        if column.nullable or column.default is not None:
            continue
        if column.server_default is not None:
            continue
        values[column.name] = _value_for(column)
    values.update(overrides)
    session.execute(sa.insert(mapped_table(model)).values(**values))
    return values


def owner_of(session: Session, table: str, key_column: str, key: Any) -> Any:
    return session.execute(
        sa.text(
            f"SELECT user_id FROM {table} WHERE {key_column} = :key"  # noqa: S608
        ).bindparams(key=key)
    ).scalar_one()


def owner_of_column(
    session: Session, table: str, column: str, key_column: str, key: Any
) -> Any:
    """Read one column of one row — for the referrers a merge has to repoint."""
    return session.execute(
        sa.text(
            f"SELECT {column} FROM {table} WHERE {key_column} = :key"  # noqa: S608
        ).bindparams(key=key)
    ).scalar_one()


def unowned_count(session: Session, table: str) -> int:
    return int(
        session.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE {UNOWNED_SQL}")  # noqa: S608
        ).scalar_one()
    )


def run_backfill(session: Session, migration: types.ModuleType) -> None:
    session.commit()
    migration.backfill_owners(session.connection())
    session.commit()


# --------------------------------------------------------------------------
# The inventory
# --------------------------------------------------------------------------


def test_the_frozen_inventory_is_the_one_derived_from_scopes(
    migration: types.ModuleType,
) -> None:
    """The migration's literal list and `SCOPES` agree, today.

    This is the whole mechanism for "a table added later that nobody remembers
    to add here". The migration cannot derive its list at runtime — an applied
    revision must keep meaning what it meant, and a table added afterwards is
    not reached by re-deriving anyway; it needs a revision of its own. So the
    derivation lives here, and adding a `USER_OWNED` table with a nullable
    owner turns into a failing test that asks for that revision.
    """
    derived = tuple(tuple(entry) for entry in owner_backfill_inventory())
    assert migration.BACKFILL_TABLES == derived


def test_the_inventory_covers_every_table_that_can_hold_an_unowned_row() -> None:
    """Nullable owner means it is in; a `NOT NULL` owner excuses itself.

    The four excused tables carry `user_id` inside a `NOT NULL` primary key, so
    an unowned row cannot be expressed at all. Asserting that property rather
    than listing their names is the difference between an excuse and a claim —
    if one of them ever loses that key, this fails instead of quietly dropping
    the table from the backfill's reach.
    """
    covered = {entry.table for entry in owner_backfill_inventory()}

    expected: set[str] = set()
    excused: set[str] = set()
    for model, scope in SCOPES.items():
        if scope is not Scope.USER_OWNED:
            continue
        column = mapped_table(model).columns[OWNER_COLUMN]
        (expected if column.nullable else excused).add(mapped_table(model).name)

    assert covered == expected

    assert excused, "no table is excused — this assertion has stopped meaning anything"
    for table in excused:
        primary_key = {c.name for c in mapped_table(MODELS_BY_TABLE[table]).primary_key}
        assert OWNER_COLUMN in primary_key, (
            f"{table} has a NOT NULL owner that is not part of its primary key, "
            "so nothing stops a future migration making it nullable again"
        )


def test_the_backfill_never_reaches_a_shared_table(
    session: Session, migration: types.ModuleType
) -> None:
    """A follow-scoped or corpus row keeps its NULL owner.

    `Channel.user_id` and `Post.user_id` are "who scraped this first" stamps.
    The seam never filters on them and ticket 22 drops them, so stamping them
    would be work ticket 22 deletes — and it would suggest to the next reader
    that those columns mean something.
    """
    assert {entry.table for entry in owner_backfill_inventory()}.isdisjoint(
        {mapped_table(Channel).name, mapped_table(Post).name}
    )

    channel = insert_row(session, mapped_table(Channel).name, owner=None)
    post = insert_row(session, mapped_table(Post).name, owner=None)

    run_backfill(session, migration)

    assert owner_of(session, mapped_table(Channel).name, "id", channel["id"]) is None
    assert (
        owner_of(session, mapped_table(Post).name, "post_id", post["post_id"]) is None
    )


# --------------------------------------------------------------------------
# The backfill
# --------------------------------------------------------------------------


def test_no_unowned_row_survives_the_backfill(
    session: Session, migration: types.ModuleType
) -> None:
    """The ticket's headline, over every table in the inventory at once."""
    operator = get_operator_user_id(session)
    assert operator is not None

    for entry in owner_backfill_inventory():
        insert_row(session, entry.table, owner=None)

    run_backfill(session, migration)

    for entry in owner_backfill_inventory():
        assert unowned_count(session, entry.table) == 0, (
            f"{entry.table} still holds a row nobody owns"
        )


def test_it_completes_in_one_pass(
    session: Session, migration: types.ModuleType
) -> None:
    """One run finishes the job, and a second changes nothing.

    Alembic stamps a revision and never re-runs it, so "the next deploy
    finishes the move" — ticket 06's migration's claim — means the move never
    finishes. The second run is here for the other half: the revision is also
    reachable a second time on a database restored mid-chain, and it must not
    reassign anything it already settled.
    """
    for entry in owner_backfill_inventory():
        insert_row(session, entry.table, owner=None)

    run_backfill(session, migration)
    after_first = {
        entry.table: session.execute(
            sa.text(f"SELECT user_id FROM {entry.table}")  # noqa: S608
        )
        .scalars()
        .all()
        for entry in owner_backfill_inventory()
    }

    run_backfill(session, migration)
    after_second = {
        entry.table: session.execute(
            sa.text(f"SELECT user_id FROM {entry.table}")  # noqa: S608
        )
        .scalars()
        .all()
        for entry in owner_backfill_inventory()
    }

    assert after_first == after_second


def test_a_payload_row_takes_its_parents_owner(
    session: Session, migration: types.ModuleType, other_user: User
) -> None:
    """A payload belongs to whoever owns the row it hangs off.

    The mutation this exists for: stamp payloads with the operator like every
    other table, or simply run the operator pass first. Both leave a body that
    the only account able to reach its parent cannot read — a detail view whose
    content is gone while the list still shows the row. On a single-account
    database both versions look identical, which is why `other_user` is here.
    """
    operator = get_operator_user_id(session)
    assert operator is not None and operator != other_user.id

    seeded: list[tuple[str, str, str]] = []
    for entry in owner_backfill_inventory():
        if entry.parent_table is None:
            continue
        assert entry.child_key is not None and entry.parent_key is not None
        parent_key = f"t34-parent-{uuid.uuid4().hex}"
        insert_row(
            session,
            entry.parent_table,
            owner=other_user.id,
            **{entry.parent_key: parent_key},
        )
        insert_row(session, entry.table, owner=None, **{entry.child_key: parent_key})
        seeded.append((entry.table, entry.child_key, parent_key))

    assert seeded, "no payload table in the inventory — this test is vacuous"

    run_backfill(session, migration)

    for table, child_key, parent_key in seeded:
        assert owner_of(session, table, child_key, parent_key) == other_user.id


def test_an_orphan_owner_is_adopted_like_a_null_one(
    session: Session, migration: types.ModuleType
) -> None:
    """An id naming no account hides a row exactly as thoroughly as NULL.

    The TG tables have no foreign key to `user.id`, so a deleted account leaves
    its rows behind pointing at nothing. `resolve_follow_owner` treats orphan
    and NULL as one situation — nobody who exists owns this — and so does this.
    """
    operator = get_operator_user_id(session)
    ghost = uuid.uuid4()

    keys: list[tuple[str, str, Any]] = []
    for entry in owner_backfill_inventory():
        model = MODELS_BY_TABLE[entry.table]
        key_column = next(iter(mapped_table(model).primary_key)).name
        values = insert_row(session, entry.table, owner=ghost)
        keys.append((entry.table, key_column, values[key_column]))

    run_backfill(session, migration)

    for table, key_column, key in keys:
        assert owner_of(session, table, key_column, key) == operator


def test_a_row_that_already_has_a_live_owner_is_left_alone(
    session: Session, migration: types.ModuleType, other_user: User
) -> None:
    """A backfill that stamps everything silently reassigns real data.

    Nothing about the resulting database looks wrong afterwards, which is why
    this is asserted rather than assumed: the operator would simply own every
    other account's summaries, credentials and chats.
    """
    keys: list[tuple[str, str, Any]] = []
    for entry in owner_backfill_inventory():
        model = MODELS_BY_TABLE[entry.table]
        key_column = next(iter(mapped_table(model).primary_key)).name
        values = insert_row(session, entry.table, owner=other_user.id)
        keys.append((entry.table, key_column, values[key_column]))

    run_backfill(session, migration)

    for table, key_column, key in keys:
        assert owner_of(session, table, key_column, key) == other_user.id


# --------------------------------------------------------------------------
# The database with no account
# --------------------------------------------------------------------------


def test_accounts_but_no_operator_refuses_and_names_what_it_found(
    session: Session, migration: types.ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Somebody has used this deployment, so stopping is the only honest answer.

    Ticket 30's dismissal table could reason its way to a safe `DELETE` because
    it is provably empty before the first superuser exists. These tables hold
    summaries, chats and bot credentials — the deployment's actual content — so
    the only two answers are "adopt" and "stop", and with no resolvable operator
    the first is unavailable. The resolver is stubbed rather than the superuser
    deleted: `_bootstrap_owner` is byte-for-byte ticket 30's and is trusted
    here; the branch under test is what happens when it returns nothing.
    """
    monkeypatch.setattr(migration, "_bootstrap_owner", lambda bind: None)

    insert_row(session, "tg_summaries", owner=None)
    insert_row(session, "tg_llm_logs", owner=None)
    session.commit()

    with pytest.raises(RuntimeError) as excinfo:
        migration.backfill_owners(session.connection())

    message = str(excinfo.value)
    assert "tg_summaries=1" in message
    assert "tg_llm_logs=1" in message
    assert "FIRST_SUPERUSER" in message

    session.rollback()
    assert unowned_count(session, "tg_summaries") == 1
    assert unowned_count(session, "tg_llm_logs") == 1


def test_a_fresh_install_completes_instead_of_blocking_the_deploy(
    session: Session, migration: types.ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No accounts at all means nobody to adopt to and nobody to hide from.

    `prestart.sh` runs `alembic upgrade head` *before* `init_db` creates the
    first superuser, and the setting-group migrations seed three global presets
    when they find no user to attach them to. The first cut of this migration
    refused that, which broke `alembic upgrade head` on every empty database —
    the whole suite errored on its first run, because `tests/conftest.py`
    migrates a fresh test database the same way a deployment does. That is this
    branch's real guard; what is asserted here is that it does not raise and
    does not delete, with the account count stubbed so the case is reachable on
    a test database that necessarily has users.
    """
    monkeypatch.setattr(migration, "_bootstrap_owner", lambda bind: None)
    monkeypatch.setattr(migration, "_account_count", lambda bind: 0)

    insert_row(session, "tg_channel_setting_groups", owner=None)
    session.commit()

    migration.backfill_owners(session.connection())

    assert unowned_count(session, "tg_channel_setting_groups") == 1


def test_no_account_and_nothing_to_adopt_is_silent(
    session: Session, migration: types.ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The truly empty database asks no follow-up question at all."""
    monkeypatch.setattr(migration, "_bootstrap_owner", lambda bind: None)

    migration.backfill_owners(session.connection())


def test_a_duplicate_setting_group_is_merged_rather_than_stamped(
    session: Session, migration: types.ModuleType
) -> None:
    """The collision that would abort `alembic upgrade head`.

    `n6o7p8q9r0s1` put a unique index on `(COALESCE(user_id::text, 'global'),
    lower(name))`. Every database ever migrated from empty carries global-scope
    presets, and the operator gets identically-named copies from
    `ensure_builtin_groups` — so the plain `UPDATE ... SET user_id = operator`
    the first cut shipped raises `UniqueViolation`, and because all fourteen
    updates share one transaction the whole revision fails and `prestart.sh`
    stops the deploy.

    Found by review, not by this file, which is why the seeding helper's habit
    of inventing a unique `name` for every row is called out here: it made the
    constraint unreachable, so the guard covered the `UPDATE`'s predicate and
    nothing about what the `UPDATE` had to satisfy. This test names both rows.

    Referrers move with the merged row. `tg_channel_follows` did not exist when
    `m5n6o7p8q9r0` did the same merge, so copying that migration verbatim would
    strand every follow on a deleted group.
    """
    operator = get_operator_user_id(session)
    assert operator is not None

    insert_row(
        session,
        "tg_channel_setting_groups",
        owner=None,
        id="default-global",
        name="default",
    )
    insert_row(
        session,
        "tg_channel_setting_groups",
        owner=operator,
        id=f"default-{operator}",
        name="Default",  # the index folds case; the merge must too
    )
    channel = insert_row(
        session,
        mapped_table(Channel).name,
        owner=None,
        setting_group_id="default-global",
    )
    session.commit()

    run_backfill(session, migration)

    survivors = [
        tuple(row)
        for row in session.execute(
            sa.text(
                "SELECT id, user_id FROM tg_channel_setting_groups "
                "WHERE lower(name) = 'default'"
            )
        ).all()
    ]
    assert survivors == [(f"default-{operator}", operator)]

    assert (
        owner_of_column(
            session, mapped_table(Channel).name, "setting_group_id", "id", channel["id"]
        )
        == f"default-{operator}"
    )


def test_an_unowned_setting_group_the_operator_lacks_is_simply_adopted(
    session: Session, migration: types.ModuleType
) -> None:
    """Merging is for duplicates. A group with no counterpart keeps its rows.

    Without this the safe fix for the collision — drop every unowned group —
    would pass the test above while deleting a group somebody made.
    """
    operator = get_operator_user_id(session)

    insert_row(
        session,
        "tg_channel_setting_groups",
        owner=None,
        id="only-copy",
        name="Weekly digest",
    )
    session.commit()

    run_backfill(session, migration)

    assert owner_of(session, "tg_channel_setting_groups", "id", "only-copy") == operator


def test_the_scope_name_index_is_the_only_constraint_of_its_kind(
    session: Session,
) -> None:
    """A second such index would need reconciling too, and nothing would say so.

    The reconciliation is written for one table because one table needs it.
    That is a fact about today's schema, not a principle — so it is checked
    rather than asserted in prose, and a new unique index on any of the
    fourteen fails here instead of on a deploy.
    """
    scoped: list[str] = []
    for entry in owner_backfill_inventory():
        rows = session.execute(
            sa.text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename = :table AND indexdef LIKE '%UNIQUE%' "
                "AND indexname NOT LIKE '%_pkey'"
            ).bindparams(table=entry.table)
        ).all()
        scoped.extend(f"{entry.table}.{name}" for (name,) in rows)

    assert scoped == [
        "tg_channel_setting_groups.uq_tg_channel_setting_groups_scope_name"
    ], (
        f"unique indexes on the backfill tables are now {scoped}. Stamping an "
        "owner can violate any index whose uniqueness is scoped by user_id; "
        "each new one needs a branch in _reconcile_setting_groups or an "
        "argument for why it cannot collide."
    )


def test_a_payload_with_an_unowned_parent_still_gets_an_owner(
    session: Session, migration: types.ModuleType
) -> None:
    """Inheritance is the first pass, not the only one.

    A payload whose parent is itself unowned has nothing to inherit, and the
    operator pass has to catch it — otherwise the one table the migration treats
    specially is the one table that keeps unowned rows.
    """
    operator = get_operator_user_id(session)

    seeded: list[tuple[str, str, str]] = []
    for entry in owner_backfill_inventory():
        if entry.parent_table is None:
            continue
        assert entry.child_key is not None and entry.parent_key is not None
        parent_key = f"t34-parent-{uuid.uuid4().hex}"
        insert_row(
            session, entry.parent_table, owner=None, **{entry.parent_key: parent_key}
        )
        insert_row(session, entry.table, owner=None, **{entry.child_key: parent_key})
        seeded.append((entry.table, entry.child_key, parent_key))

    run_backfill(session, migration)

    for table, child_key, parent_key in seeded:
        assert owner_of(session, table, child_key, parent_key) == operator
