"""add tg_tag_runs table

Revision ID: j2k3l4m5n6o7
Revises: h1i2j3k4l5m6
Create Date: 2026-07-02
"""

import sqlalchemy as sa
from alembic import op

revision = "j2k3l4m5n6o7"
down_revision = "h1i2j3k4l5m6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_tag_runs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("source", sa.String(), nullable=False, server_default="generated"),
        sa.Column("mode", sa.String(), nullable=False, server_default="add"),
        sa.Column("channels", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("start_date", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("end_date", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("post_count", sa.Integer(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("prompt_text", sa.Text(), nullable=True),
        sa.Column("response_text", sa.Text(), nullable=True),
        sa.Column(
            "all_tags_snapshot", sa.JSON(), nullable=False, server_default="[]"
        ),
        sa.Column(
            "channel_context_options", sa.JSON(), nullable=False, server_default="{}"
        ),
        sa.Column("suggestions", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("apply_result", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_tg_tag_runs_user_id"),
        "tg_tag_runs",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tg_tag_runs_user_id"), table_name="tg_tag_runs")
    op.drop_table("tg_tag_runs")
