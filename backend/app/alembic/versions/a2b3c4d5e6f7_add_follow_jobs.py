"""`tg_follow_jobs`: a bulk follow the worker can run (ticket 36, ADR-012 D7)

A Discover bulk follow was a dataclass in a module-global dict, created and run
by `asyncio.create_task` from the API route. That put its probe phase in the web
tier, outside the scraping Partition: four concurrent fetches on a semaphore of
their own, bound to no proxy, which is the second budget and the walk-hopping
the whole ticket exists to remove.

Moving the runner to the worker means the API can no longer see the job in
memory, so it needs a row. The status route reads it, the SSE stream re-reads
it on each notification, and cancel writes to it — the shape tickets 10 and 11
built for `tg_sync_jobs`.

**Written by hand.** Autogenerate wanted to drop six hand-written indexes it
cannot see in the models and re-nullify five JSON columns; only the table below
is this revision's business.

Revision ID: a2b3c4d5e6f7
Revises: e8f9a0b1c2d3
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision: str = "a2b3c4d5e6f7"
down_revision: str | None = "e8f9a0b1c2d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tg_follow_jobs",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("source", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("options", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("sync_job_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column(
            "cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("finished_at", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        # `CASCADE`, following `tg_sync_jobs`: a follow job is one account's
        # own work and cannot outlive the account. `view_as_sessions` is the
        # one per-User table that takes `SET NULL`, and it is an audit row.
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_tg_follow_jobs_user_id"), "tg_follow_jobs", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tg_follow_jobs_user_id"), table_name="tg_follow_jobs")
    op.drop_table("tg_follow_jobs")
