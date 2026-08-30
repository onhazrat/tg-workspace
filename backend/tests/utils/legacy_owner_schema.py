"""Reproduce the pre-ticket-21 schema, so the backfill guards can still run.

Ticket 21's `d2e3f4a5b6c7` makes `user_id` `NOT NULL` on the fourteen
`USER_OWNED` tables and adds a cascading key to `"user"(id)`. That is the point
of the revision — an unowned row stops being representable.

It also makes ticket 34's guard impossible to write as it stands. That guard
tests a *backfill*, whose entire subject is rows with no owner, and it seeds
them directly. After PR 3 the database refuses the seed, so the guard errors on
setup rather than failing on a claim — and a guard that cannot construct its
fixture is a guard nobody can trust either way.

Deleting those tests would be the easy answer and the wrong one. The migration
they cover still runs on every database that upgrades from before it, and its
setting-group reconciliation is the piece `/code-review` caught ticket 34
getting wrong. So the schema is put back for the duration of the test instead.

## Why this is a fixture and not a plain context manager

Because it has to end somebody else's transaction first.

`ALTER TABLE ... DROP NOT NULL` needs `ACCESS EXCLUSIVE`, and `conftest.py`'s
session-scoped `db` fixture holds **one Session open for the entire run** — it
calls `init_db(session)`, which writes the built-in setting groups, and then
yields without committing. That transaction holds locks on these exact tables
until the last test finishes, so the `ALTER TABLE` waits for something that
cannot happen until after it. The first version of this helper hung the whole
suite that way; `pg_stat_activity` showed the `ALTER` blocked on `relation` with
an `idle in transaction` peer holding it.

Depending on `db` is what lets this commit that transaction before touching the
schema, which is why it takes the fixture rather than reaching for
`engine.dispose()` — disposing the pool cannot close a connection a live Session
still has checked out.

**Restored explicitly rather than rolled back.** These tests commit, so a
transaction-scoped rollback would not reach the DDL. The `finally` restores both
constraints even when the test fails, because leaving the suite's database
without them would make every later assertion about `NOT NULL` pass for the
wrong reason.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlmodel import Session

from app.core.db import engine
from app.services.tenancy import owner_backfill_inventory


def _tables() -> list[str]:
    return [entry.table for entry in owner_backfill_inventory()]


def _ddl(statements: list[str]) -> None:
    """Run `ACCESS EXCLUSIVE` DDL with a timeout instead of an open-ended wait.

    `lock_timeout` is the backstop for the case the fixture's `db.commit()` does
    not cover — another module-scoped fixture holding a connection, say. It
    raises in ten seconds naming the statement rather than stalling a run for as
    long as anyone is prepared to wait. A guard that can hang is worse than one
    that fails, because the failure gets read.
    """
    with Session(engine) as session, session.begin():
        session.execute(sa.text("SET LOCAL lock_timeout = '10s'"))
        for statement in statements:
            session.execute(sa.text(statement))


def _drop() -> list[str]:
    return [
        stmt
        for table in _tables()
        for stmt in (
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS fk_{table}_user_id_user",
            f"ALTER TABLE {table} ALTER COLUMN user_id DROP NOT NULL",
        )
    ]


def _restore() -> list[str]:
    return [
        stmt
        for table in _tables()
        for stmt in (
            f"ALTER TABLE {table} ALTER COLUMN user_id SET NOT NULL",
            f"ALTER TABLE {table} ADD CONSTRAINT fk_{table}_user_id_user "
            f'FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE',
        )
    ]


def _clear_unowned() -> None:
    """Drop rows no live account owns, so the constraints can go back on.

    Both shapes, because the guards seed both on purpose: NULL blocks the
    `NOT NULL`, and an id naming a deleted account blocks the foreign key. They
    are the two states `_UNOWNED` names in the migration, and a row owned by a
    deleted account is what proves the backfill treats an orphan like a NULL.
    """
    with Session(engine) as session:
        for table in _tables():
            session.execute(
                sa.text(  # noqa: S608
                    f"DELETE FROM {table} WHERE user_id IS NULL "
                    'OR user_id NOT IN (SELECT id FROM "user")'
                )
            )
        session.commit()


@pytest.fixture
def legacy_owner_schema(db: Session | None) -> Iterator[None]:
    """Let `user_id` be NULL and unconstrained again, for one test.

    **Request it first in the parameter list.** Pytest sets fixtures up in
    declaration order, and this one takes `ACCESS EXCLUSIVE` on fourteen tables
    — so a `session` or `client` fixture named before it will already be
    holding a connection, and the DDL waits out its `lock_timeout` and fails.
    `def test_x(legacy_owner_schema, session, user)` works;
    `def test_x(session, user, legacy_owner_schema)` raises `LockNotAvailable`.
    """
    if db is not None:
        # End the session-scoped transaction holding locks on these tables.
        # See the module docstring: without this the DDL below waits for a
        # transaction that outlives the whole run.
        db.commit()
    _ddl(_drop())
    try:
        yield
    finally:
        _clear_unowned()
        _ddl(_restore())
