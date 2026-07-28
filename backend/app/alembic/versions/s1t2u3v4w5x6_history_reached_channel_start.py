"""add history_reached_channel_start to tg_channels

Revision ID: s1t2u3v4w5x6
Revises: r0s1t2u3v4w5
Create Date: 2026-07-28

"""
from alembic import op
import sqlalchemy as sa

revision = "s1t2u3v4w5x6"
down_revision = "r0s1t2u3v4w5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_channels",
        sa.Column(
            "history_reached_channel_start",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Channels already marked complete crossed the cutoff the normal way, so
    # they need no start marker. Everything else is left False and re-earns the
    # flag on its next backward walk.


def downgrade() -> None:
    op.drop_column("tg_channels", "history_reached_channel_start")
