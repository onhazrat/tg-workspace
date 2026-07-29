"""add tg_discover_ignored

Dismissed Discover candidates (IDEA-011 D8). Keyed by the normalized handle so
a dismissal survives the candidate reappearing with different casing.

Revision ID: v4w5x6y7z8a9
Revises: u3v4w5x6y7z8
Create Date: 2026-07-29
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "v4w5x6y7z8a9"
down_revision = "u3v4w5x6y7z8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_discover_ignored",
        sa.Column("handle", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("handle"),
    )
    op.create_index(
        "ix_tg_discover_ignored_user_id",
        "tg_discover_ignored",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_tg_discover_ignored_user_id", table_name="tg_discover_ignored")
    op.drop_table("tg_discover_ignored")
