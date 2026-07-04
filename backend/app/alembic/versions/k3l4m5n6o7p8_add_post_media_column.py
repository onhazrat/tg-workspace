"""add media JSONB column to tg_posts

Revision ID: k3l4m5n6o7p8
Revises: j2k3l4m5n6o7
Create Date: 2026-07-04
"""

import sqlalchemy as sa
from alembic import op

revision = "k3l4m5n6o7p8"
down_revision = "j2k3l4m5n6o7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tg_posts", sa.Column("media", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("tg_posts", "media")
