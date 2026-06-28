"""add posts channel_name timestamp index

Revision ID: g9h0i1j2k3l4
Revises: f8a9b0c1d2e3
Create Date: 2026-06-28

"""
from alembic import op

revision = "g9h0i1j2k3l4"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_tg_posts_channel_name_timestamp",
        "tg_posts",
        ["channel_name", "timestamp"],
        postgresql_ops={"timestamp": "DESC"},
    )


def downgrade() -> None:
    op.drop_index("ix_tg_posts_channel_name_timestamp", table_name="tg_posts")
