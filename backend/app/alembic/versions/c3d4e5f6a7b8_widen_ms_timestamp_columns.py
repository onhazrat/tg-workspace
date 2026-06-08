"""widen millisecond timestamp columns to bigint

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-08

JS Date.now() values exceed PostgreSQL INTEGER (max 2_147_483_647).
"""
from alembic import op
import sqlalchemy as sa

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None

BIGINT_COLUMNS: list[tuple[str, str]] = [
    ("tg_channels", "start_time"),
    ("tg_channels", "last_updated"),
    ("tg_channels", "followed_at"),
    ("tg_posts", "timestamp"),
    ("tg_summaries", "start_date"),
    ("tg_summaries", "end_date"),
    ("tg_summaries", "timestamp"),
    ("tg_bot_credentials", "last_validated"),
    ("tg_post_translations", "timestamp"),
    ("tg_publish_logs", "timestamp"),
    ("tg_sync_logs", "timestamp"),
    ("tg_llm_logs", "timestamp"),
    ("tg_embedding_logs", "timestamp"),
    ("tg_network_logs", "timestamp"),
]


def upgrade() -> None:
    for table, column in BIGINT_COLUMNS:
        op.execute(
            sa.text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE BIGINT")
        )


def downgrade() -> None:
    for table, column in reversed(BIGINT_COLUMNS):
        op.execute(
            sa.text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE INTEGER")
        )
