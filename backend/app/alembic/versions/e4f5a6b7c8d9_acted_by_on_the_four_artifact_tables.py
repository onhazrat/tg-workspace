"""Acted-by on the four artifact tables (ticket 27)

An elevated View-as session writes rows owned by the *target* — `sub` is the
target, so every aggregate stamps `user_id` with them exactly as it would for
the person themselves. These two columns are what stops that being a lie.

**Both keys are `ON DELETE SET NULL`, where `user_id` on the same tables
cascades.** Deleting an account deletes what it owns; deleting the *Owner* who
once fixed somebody's summary must leave that summary alone, and the record of
who wrote it is exactly what a reader wants afterwards. The address is
denormalised beside the key for the same reason — the design of
`view_as_sessions`, one ticket over.

Nothing is backfilled. `NULL` means "the account that owns it wrote it", which
is true of every row that existed before elevation did.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-09-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4f5a6b7c8d9"
down_revision: str | None = "d3e4f5a6b7c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: The four artifact tables. Frozen here rather than derived from the models,
#: for `owner_backfill`'s reason: an applied revision has to keep meaning what
#: it meant, and a fifth artifact family added next year must not silently
#: change what this migration did.
_TABLES = (
    "tg_summaries",
    "tg_chat_sessions",
    "tg_tag_runs",
    "tg_discover_reports",
)


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("acted_by_user_id", sa.Uuid(), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("acted_by_email", sa.String(length=255), nullable=True),
        )
        op.create_foreign_key(
            f"{table}_acted_by_user_id_fkey",
            table,
            "user",
            ["acted_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for table in _TABLES:
        op.drop_constraint(
            f"{table}_acted_by_user_id_fkey", table, type_="foreignkey"
        )
        op.drop_column(table, "acted_by_email")
        op.drop_column(table, "acted_by_user_id")
