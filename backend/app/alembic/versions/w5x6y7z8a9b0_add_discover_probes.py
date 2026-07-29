"""add tg_discover_probes

Per-handle metadata probes for Discover candidates (IDEA-011 D9). Keyed by the
normalized handle, like tg_discover_ignored, so both join onto candidate names
the same way — but kept a separate table because an automated verdict and an
operator's dismissal must stay distinguishable.

Revision ID: w5x6y7z8a9b0
Revises: v4w5x6y7z8a9
Create Date: 2026-07-29
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "w5x6y7z8a9b0"
down_revision = "v4w5x6y7z8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_discover_probes",
        sa.Column("handle", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("kind", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("display_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("bio", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("subscribers", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("photo_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("latest_id", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("checked_at", sa.DateTime(), nullable=True),
        sa.Column("attempted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("handle"),
    )
    op.create_index(
        op.f("ix_tg_discover_probes_status"),
        "tg_discover_probes",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_tg_discover_probes_status"), table_name="tg_discover_probes"
    )
    op.drop_table("tg_discover_probes")
