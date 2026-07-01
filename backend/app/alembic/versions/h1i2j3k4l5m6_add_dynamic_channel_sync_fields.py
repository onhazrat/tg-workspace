"""add dynamic channel sync fields

Revision ID: h1i2j3k4l5m6
Revises: g9h0i1j2k3l4
Create Date: 2026-07-01

"""

import time

import sqlalchemy as sa
from alembic import op

revision = "h1i2j3k4l5m6"
down_revision = "g9h0i1j2k3l4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_channels",
        sa.Column(
            "regular_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "dynamic_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "auto_sync_interval_minutes",
            sa.Integer(),
            nullable=False,
            server_default="60",
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "dynamic_sync_expected_posts",
            sa.Integer(),
            nullable=False,
            server_default="15",
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column("next_regular_sync_at", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "tg_channels",
        sa.Column("next_dynamic_sync_at", sa.BigInteger(), nullable=True),
    )

    now_ms = int(time.time() * 1000)
    op.execute(
        sa.text(
            """
            UPDATE tg_channels
            SET next_regular_sync_at =
                COALESCE(last_updated, :now_ms)
                + (COALESCE(auto_sync_interval_minutes, 60) * 60000)
            """
        ).bindparams(now_ms=now_ms)
    )
    op.execute(sa.text("UPDATE tg_channels SET next_dynamic_sync_at = NULL"))


def downgrade() -> None:
    op.drop_column("tg_channels", "next_dynamic_sync_at")
    op.drop_column("tg_channels", "next_regular_sync_at")
    op.drop_column("tg_channels", "dynamic_sync_expected_posts")
    op.drop_column("tg_channels", "auto_sync_interval_minutes")
    op.drop_column("tg_channels", "dynamic_sync_enabled")
    op.drop_column("tg_channels", "regular_sync_enabled")
