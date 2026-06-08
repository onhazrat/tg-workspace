"""add tg_sync_jobs table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-08

Durable sync job state for Phase 4.5 (DECISION #9).
"""
from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_sync_jobs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("source", sa.String(), nullable=False, server_default=""),
        sa.Column("channels", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("finished_at", sa.BigInteger(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_tg_sync_jobs_user_id"),
        "tg_sync_jobs",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tg_sync_jobs_user_id"), table_name="tg_sync_jobs")
    op.drop_table("tg_sync_jobs")
