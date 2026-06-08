"""add tg summarizer tables

Revision ID: a1b2c3d4e5f6
Revises: fe56fa70289e
Create Date: 2026-06-08

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

revision = "a1b2c3d4e5f6"
down_revision = "fe56fa70289e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_channels",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("display_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("photo_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("bio", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("subscribers", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("photos", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("videos", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("files", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("links", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("start_id", sa.Integer(), nullable=True),
        sa.Column("start_time", sa.Integer(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("last_updated", sa.Integer(), nullable=True),
        sa.Column("is_frozen", sa.Boolean(), nullable=False),
        sa.Column("is_unavailable_on_web_view", sa.Boolean(), nullable=False),
        sa.Column("language", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("followed_at", sa.Integer(), nullable=True),
        sa.Column("discovered_via", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tg_posts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("date", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("timestamp", sa.Integer(), nullable=False),
        sa.Column("forwarded_from", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("forwarded_from_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_name", "post_id"),
    )
    op.create_index(op.f("ix_tg_posts_channel_name"), "tg_posts", ["channel_name"], unique=False)
    op.create_table(
        "tg_summaries",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("channels", sa.JSON(), nullable=True),
        sa.Column("start_date", sa.Integer(), nullable=False),
        sa.Column("end_date", sa.Integer(), nullable=False),
        sa.Column("language", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("post_count", sa.Integer(), nullable=True),
        sa.Column("timestamp", sa.Integer(), nullable=False),
        sa.Column("extra", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tg_bot_credentials",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("token_encrypted", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("username", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("photo_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("last_validated", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tg_chat_destinations",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("chat_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tg_post_embeddings",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("channel_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("vector", sa.JSON(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("provider", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tg_post_translations",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("channel_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("language", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("translated_text", sa.Text(), nullable=True),
        sa.Column("timestamp", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tg_app_settings",
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "tg_sync_meta",
        sa.Column("resource", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("etag", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("resource"),
    )


def downgrade() -> None:
    op.drop_table("tg_sync_meta")
    op.drop_table("tg_app_settings")
    op.drop_table("tg_post_translations")
    op.drop_table("tg_post_embeddings")
    op.drop_table("tg_chat_destinations")
    op.drop_table("tg_bot_credentials")
    op.drop_table("tg_summaries")
    op.drop_index(op.f("ix_tg_posts_channel_name"), table_name="tg_posts")
    op.drop_table("tg_posts")
    op.drop_table("tg_channels")
