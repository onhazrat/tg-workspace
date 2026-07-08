"""add channel telegram chat id

Revision ID: o7p8q9r0s1t2
Revises: n6o7p8q9r0s1
Create Date: 2026-07-08
"""

import sqlalchemy as sa
from alembic import op

revision = "o7p8q9r0s1t2"
down_revision = "n6o7p8q9r0s1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_channels",
        sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "uq_tg_channels_user_telegram_chat_id_not_null",
        "tg_channels",
        ["user_id", "telegram_chat_id"],
        unique=True,
        postgresql_where=sa.text("telegram_chat_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_tg_channels_user_telegram_chat_id_not_null",
        table_name="tg_channels",
    )
    op.drop_column("tg_channels", "telegram_chat_id")
