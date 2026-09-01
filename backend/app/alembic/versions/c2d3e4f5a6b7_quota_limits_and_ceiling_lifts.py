"""Per-account Budget overrides, and the day-scoped ceiling lift (ticket 24).

Two changes, and they are two because a limit and a lift have different
lifetimes.

`tg_quota_limits` holds what an Admin decided an account may spend: one row per
`(user_id, budget)`, both numbers nullable because an absent number means
"inherit the deployment default" and an absent *row* means "inherit both". A
`NOT NULL` copy of the resolved defaults would freeze an account's other two
Budgets at whatever the default happened to be on the afternoon somebody capped
its bulk syncs.

`tg_quota_usage.ceiling_lifted_at` is the lift. It goes on the ledger row rather
than into a table of its own because that row is already keyed
`(user_id, day, budget)`, which is exactly "this account, this Budget, today" —
so decision 18's "auto-lifts at the daily reset" costs no code at all: tomorrow
is a different row.

Nothing is backfilled. There is nothing to backfill: an absent override *is* the
correct state for every existing account, and an absent lift is the correct
state for every existing ledger row.

Both timestamp columns are `TIMESTAMP WITHOUT TIME ZONE`, matching every other
`tg_*` table and `models_tg.utc_now`, which drops `tzinfo` on purpose. A
`timestamptz` here would be the odd one out *and* wrong: a naive value written
into one is interpreted in the session's timezone, so the same row would mean a
different instant on a server that is not set to UTC.

Revision ID: c2d3e4f5a6b7
Revises: f7f6948f2c5d
"""

import sqlalchemy as sa
from alembic import op

revision = "c2d3e4f5a6b7"
down_revision = "f7f6948f2c5d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_quota_limits",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        # Matches `tg_quota_usage.budget`: the Budget's string value, which is
        # a persisted format rather than an enum type. Renaming a Budget needs
        # a migration in both tables, and a Postgres enum would need a third
        # change on top of that for nothing gained.
        sa.Column("budget", sa.String(), nullable=False),
        sa.Column("allowance", sa.Integer(), nullable=True),
        sa.Column("ceiling", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "budget"),
    )
    op.add_column(
        "tg_quota_usage",
        sa.Column("ceiling_lifted_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tg_quota_usage", "ceiling_lifted_at")
    op.drop_table("tg_quota_limits")
