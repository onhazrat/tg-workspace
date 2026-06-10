"""backward sync fields and post_sync_state table

Revision ID: e7f8a9b0c1d2
Revises: d4e5f6a7b8c9
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa

revision = "e7f8a9b0c1d2"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_posts",
        sa.Column("is_anchor", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "tg_posts",
        sa.Column("retrieved_at", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "tg_posts",
        sa.Column("retrieval_job_id", sa.String(), nullable=True),
    )
    op.add_column(
        "tg_posts",
        sa.Column("retrieval_pass", sa.String(), nullable=True),
    )
    op.add_column(
        "tg_posts",
        sa.Column("retrieval_source", sa.String(), nullable=True),
    )
    op.create_index("ix_tg_posts_is_anchor", "tg_posts", ["is_anchor"])

    op.add_column(
        "tg_channels",
        sa.Column(
            "history_complete_to_cutoff",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column("anchor_post_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "tg_channels",
        sa.Column("oldest_stored_post_timestamp", sa.BigInteger(), nullable=True),
    )

    op.create_table(
        "tg_post_sync_state",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("channel_name", sa.String(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("confirmed_at", sa.BigInteger(), nullable=False),
        sa.Column("confirmed_job_id", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_name", "post_id"),
    )
    op.create_index(
        "ix_tg_post_sync_state_channel_name", "tg_post_sync_state", ["channel_name"]
    )
    op.create_index(
        "ix_tg_post_sync_state_user_id", "tg_post_sync_state", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_tg_post_sync_state_user_id", table_name="tg_post_sync_state")
    op.drop_index("ix_tg_post_sync_state_channel_name", table_name="tg_post_sync_state")
    op.drop_table("tg_post_sync_state")

    op.drop_column("tg_channels", "oldest_stored_post_timestamp")
    op.drop_column("tg_channels", "anchor_post_id")
    op.drop_column("tg_channels", "history_complete_to_cutoff")

    op.drop_index("ix_tg_posts_is_anchor", table_name="tg_posts")
    op.drop_column("tg_posts", "retrieval_source")
    op.drop_column("tg_posts", "retrieval_pass")
    op.drop_column("tg_posts", "retrieval_job_id")
    op.drop_column("tg_posts", "retrieved_at")
    op.drop_column("tg_posts", "is_anchor")
