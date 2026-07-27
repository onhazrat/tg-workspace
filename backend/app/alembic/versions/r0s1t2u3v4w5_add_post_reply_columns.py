"""add reply columns to tg_posts

Revision ID: r0s1t2u3v4w5
Revises: q9r0s1t2u3v4
Create Date: 2026-07-27
"""

import sqlalchemy as sa
from alembic import op

revision = "r0s1t2u3v4w5"
down_revision = "q9r0s1t2u3v4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tg_posts", sa.Column("reply_to_post_id", sa.Integer(), nullable=True))
    op.add_column("tg_posts", sa.Column("reply_to", sa.JSON(), nullable=True))
    op.create_index(
        "ix_tg_posts_reply_to_post_id", "tg_posts", ["reply_to_post_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_tg_posts_reply_to_post_id", table_name="tg_posts")
    op.drop_column("tg_posts", "reply_to")
    op.drop_column("tg_posts", "reply_to_post_id")
