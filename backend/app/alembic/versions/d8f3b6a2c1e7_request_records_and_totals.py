"""Request records and their hourly and daily totals (RQS-01, ADR-035)

Revision ID: d8f3b6a2c1e7
Revises: c4e8a1f6d2b9
Create Date: 2026-10-22 23:40:00

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d8f3b6a2c1e7"
down_revision = "c4e8a1f6d2b9"
branch_labels = None
depends_on = None


def _totals_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("channel", sa.String(), nullable=True),
        sa.Column("outcome", sa.String(), nullable=False),
        sa.Column("cause", sa.String(), nullable=True),
        sa.Column("page_type", sa.String(), nullable=False),
        sa.Column("charged", sa.Boolean(), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False),
        sa.Column("new_posts", sa.Integer(), nullable=False),
        sa.Column("repeated_posts", sa.Integer(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "tg_request_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(),
            server_default=sa.text("timezone('utc', now())"),
            nullable=False,
        ),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("charged", sa.Boolean(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("budget", sa.String(), nullable=True),
        sa.Column("best_effort", sa.Boolean(), nullable=False),
        sa.Column("channel", sa.String(), nullable=True),
        sa.Column("lane", sa.String(), nullable=False),
        sa.Column("page_type", sa.String(), nullable=False),
        sa.Column("outcome", sa.String(), nullable=False),
        sa.Column("cause", sa.String(), nullable=True),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("chain_id", sa.Uuid(), nullable=False),
        sa.Column("new_posts", sa.Integer(), nullable=True),
        sa.Column("repeated_posts", sa.Integer(), nullable=True),
    )
    op.create_index("ix_tg_request_records_at", "tg_request_records", ["at"])
    op.create_index(
        "ix_tg_request_records_recorded_at", "tg_request_records", ["recorded_at"]
    )

    op.create_table(
        "tg_request_hourly",
        *_totals_columns(),
        sa.Column("hour", sa.DateTime(), nullable=False),
        sa.Column("lane", sa.String(), nullable=False),
        sa.Column("best_effort", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_tg_request_hourly_hour", "tg_request_hourly", ["hour"])

    op.create_table(
        "tg_request_daily",
        *_totals_columns(),
        sa.Column("day", sa.Date(), nullable=False),
    )
    op.create_index("ix_tg_request_daily_day", "tg_request_daily", ["day"])


def downgrade() -> None:
    op.drop_table("tg_request_daily")
    op.drop_table("tg_request_hourly")
    op.drop_table("tg_request_records")
