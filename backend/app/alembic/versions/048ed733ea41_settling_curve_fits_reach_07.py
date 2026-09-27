"""Settling curve fits: one row per daily fit (REACH-07, ADR-024).

Creates `tg_settling_curve_fits`. No seed row: with none, Reach estimates
through the seed curve in `services/reach.py`.

Revision ID: 048ed733ea41
Revises: 5b8d2f6e1a47
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "048ed733ea41"
down_revision: str | None = "5b8d2f6e1a47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tg_settling_curve_fits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fitted_at", sa.DateTime(), nullable=False),
        sa.Column("knots", postgresql.JSONB(), nullable=False),
        sa.Column("settling_age_hours", sa.Integer(), nullable=False),
        sa.Column("observation_stride", sa.Integer(), nullable=False),
        sa.Column("pair_count", sa.Integer(), nullable=False),
        sa.Column("post_count", sa.Integer(), nullable=False),
        sa.Column("channel_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("tg_settling_curve_fits")
