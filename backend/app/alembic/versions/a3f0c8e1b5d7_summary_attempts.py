"""Summary Attempts: one row per request for a Summary's prose (SFR-01, ADR-030)

A Generate that breaks used to leave nothing but a toast and an AI log row,
and logs are pruned. Each request now leaves an Attempt, kept as long as its
Summary and deleted with it.

Revision ID: a3f0c8e1b5d7
Revises: a7d3e9f1c2b4
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3f0c8e1b5d7"
down_revision: str | None = "a7d3e9f1c2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tg_summary_attempts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("summary_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("key_id", sa.String(), nullable=True),
        sa.Column("partial_text", sa.Text(), nullable=True),
        sa.Column("partial_dismissed_at", sa.BigInteger(), nullable=True),
        sa.Column("automatic", sa.Boolean(), nullable=False),
        sa.Column("scheduled", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.BigInteger(), nullable=False),
        sa.Column("ended_at", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["summary_id"], ["tg_summaries.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_tg_summary_attempts_user_id",
        "tg_summary_attempts",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ux_tg_summary_attempts_number",
        "tg_summary_attempts",
        ["summary_id", "attempt"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_table("tg_summary_attempts")
