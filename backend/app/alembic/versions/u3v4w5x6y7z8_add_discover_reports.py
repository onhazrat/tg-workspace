"""add tg_discover_reports

Saved Discover runs (IDEA-011 W1). A report is an artifact the user keeps,
modelled on tg_summaries: the scope columns are a snapshot of the selections at
generate time, and `candidates` holds the full result including the long
single-reference tail.

Revision ID: u3v4w5x6y7z8
Revises: s1t2u3v4w5x6
Create Date: 2026-07-29
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "u3v4w5x6y7z8"
down_revision = "s1t2u3v4w5x6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_discover_reports",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("channels", sa.JSON(), nullable=True),
        sa.Column("start_date", sa.BigInteger(), nullable=False),
        sa.Column("end_date", sa.BigInteger(), nullable=False),
        sa.Column("signals", sa.JSON(), nullable=True),
        sa.Column("keyword", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("forwarded", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("media", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("max_per_channel", sa.Integer(), nullable=False),
        sa.Column(
            "max_per_channel_mode", sqlmodel.sql.sqltypes.AutoString(), nullable=False
        ),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("scoped_post_count", sa.Integer(), nullable=True),
        sa.Column("candidates", sa.JSON(), nullable=True),
        sa.Column("scope_counts", sa.JSON(), nullable=True),
        sa.Column("posts_in_scope", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_tg_discover_reports_user_id",
        "tg_discover_reports",
        ["user_id"],
        unique=False,
    )
    # The list view is always newest-first.
    op.create_index(
        "ix_tg_discover_reports_timestamp",
        "tg_discover_reports",
        ["timestamp"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_tg_discover_reports_timestamp", table_name="tg_discover_reports")
    op.drop_index("ix_tg_discover_reports_user_id", table_name="tg_discover_reports")
    op.drop_table("tg_discover_reports")
