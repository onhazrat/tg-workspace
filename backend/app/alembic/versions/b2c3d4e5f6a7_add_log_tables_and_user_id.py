"""add log tables and user_id columns

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-08

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

MUTABLE_TABLES = [
    "tg_channels",
    "tg_posts",
    "tg_summaries",
    "tg_bot_credentials",
    "tg_chat_destinations",
    "tg_post_embeddings",
    "tg_post_translations",
    "tg_app_settings",
]


def upgrade() -> None:
    for table in MUTABLE_TABLES:
        op.add_column(table, sa.Column("user_id", sa.Uuid(), nullable=True))
        op.create_index(op.f(f"ix_{table}_user_id"), table, ["user_id"], unique=False)

    op.create_table(
        "tg_publish_logs",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("summary_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("bot_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("bot_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("chat_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("chat_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("full_request", sa.JSON(), nullable=True),
        sa.Column("full_response", sa.JSON(), nullable=True),
        sa.Column("text_sent", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tg_publish_logs_user_id"), "tg_publish_logs", ["user_id"], unique=False)

    op.create_table(
        "tg_sync_logs",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("channel_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("posts_count", sa.Integer(), nullable=False),
        sa.Column("new_latest_id", sa.Integer(), nullable=True),
        sa.Column("error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("source", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("full_request", sa.JSON(), nullable=True),
        sa.Column("full_response", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tg_sync_logs_user_id"), "tg_sync_logs", ["user_id"], unique=False)

    op.create_table(
        "tg_llm_logs",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("response", sa.Text(), nullable=True),
        sa.Column("system_instruction", sa.Text(), nullable=True),
        sa.Column("model_config_json", sa.JSON(), nullable=True),
        sa.Column("full_request", sa.JSON(), nullable=True),
        sa.Column("full_response", sa.JSON(), nullable=True),
        sa.Column("tokens", sa.Integer(), nullable=True),
        sa.Column("duration", sa.Float(), nullable=True),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("log_type", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tg_llm_logs_user_id"), "tg_llm_logs", ["user_id"], unique=False)

    op.create_table(
        "tg_embedding_logs",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("text_count", sa.Integer(), nullable=False),
        sa.Column("tokens_estimated", sa.Integer(), nullable=True),
        sa.Column("duration", sa.Float(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tg_embedding_logs_user_id"), "tg_embedding_logs", ["user_id"], unique=False)

    op.create_table(
        "tg_network_logs",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("method", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("duration", sa.Float(), nullable=False),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("source", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("proxy_used", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=True),
        sa.Column("telemetry", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tg_network_logs_user_id"), "tg_network_logs", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tg_network_logs_user_id"), table_name="tg_network_logs")
    op.drop_table("tg_network_logs")
    op.drop_index(op.f("ix_tg_embedding_logs_user_id"), table_name="tg_embedding_logs")
    op.drop_table("tg_embedding_logs")
    op.drop_index(op.f("ix_tg_llm_logs_user_id"), table_name="tg_llm_logs")
    op.drop_table("tg_llm_logs")
    op.drop_index(op.f("ix_tg_sync_logs_user_id"), table_name="tg_sync_logs")
    op.drop_table("tg_sync_logs")
    op.drop_index(op.f("ix_tg_publish_logs_user_id"), table_name="tg_publish_logs")
    op.drop_table("tg_publish_logs")

    for table in reversed(MUTABLE_TABLES):
        op.drop_index(op.f(f"ix_{table}_user_id"), table_name=table)
        op.drop_column(table, "user_id")
