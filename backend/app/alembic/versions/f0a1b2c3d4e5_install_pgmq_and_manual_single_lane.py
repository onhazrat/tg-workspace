"""Install PGMQ and create the manual_single_normal lane (ticket 09)

Runs PGMQ's pure-SQL install script (vendored, unmodified, at
`app/alembic/vendor/pgmq_v1.12.0.sql` — see that file's header) rather than
`CREATE EXTENSION pgmq`. Decision 25 of `docs/multi-user-tenancy-plan.md`: the
extension form needs superuser and a `postgres:18` image carrying the compiled
`.so`; the plain-SQL form is DDL the app's own role can run and needs neither.
PGMQ supports PG 14-18.

`pgmq.create('manual_single_normal')` creates the first of the eventual six
lanes (`{auto_sync, manual_bulk, manual_single} x {normal, best_effort}`,
decision 27) — the only one this ticket needs. `manual_single` matches
`Budget.MANUAL_SINGLE` in `app/services/quota.py`; `_normal` is the tier
suffix so ticket 12 can add the other five without renaming this one.

Nothing SQLModel-mapped lives in `pgmq.*` — same reason autogenerate never
sees `tg_sync_log_payloads`' raw-SQL indexes (see `e9f0a1b2c3d4`'s docstring):
these are plain tables outside `SQLModel.metadata`, so this migration, not
autogenerate, is the only place that knows they exist.

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-08-25

"""

import pathlib

from alembic import op

revision = "f0a1b2c3d4e5"
down_revision = "e9f0a1b2c3d4"
branch_labels = None
depends_on = None

_VENDOR_SQL = (
    pathlib.Path(__file__).resolve().parents[1] / "vendor" / "pgmq_v1.12.0.sql"
)

#: The one lane this ticket needs. See docstring above.
MANUAL_SINGLE_NORMAL_QUEUE = "manual_single_normal"


def upgrade() -> None:
    op.execute(_VENDOR_SQL.read_text())
    op.execute(f"SELECT pgmq.create('{MANUAL_SINGLE_NORMAL_QUEUE}');")


def downgrade() -> None:
    # `drop_queue` removes the queue's own tables and its `pgmq.meta` row.
    # Nothing else has installed a lane yet (ticket 12 is what adds the other
    # five), so it is safe for this migration to also tear down the schema it
    # installed — a later downgrade that runs after ticket 12 would need to
    # stop dropping the schema itself, since other lanes would still depend
    # on it.
    op.execute(f"SELECT pgmq.drop_queue('{MANUAL_SINGLE_NORMAL_QUEUE}');")
    op.execute("DROP SCHEMA IF EXISTS pgmq CASCADE;")
