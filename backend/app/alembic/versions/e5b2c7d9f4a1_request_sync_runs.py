"""Sync runs on the Requests and their totals (RQS-04)

Revision ID: e5b2c7d9f4a1
Revises: d8f3b6a2c1e7
Create Date: 2026-10-23 12:00:00

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e5b2c7d9f4a1"
down_revision = "d8f3b6a2c1e7"
branch_labels = None
depends_on = None

_TOTALS = ("tg_request_hourly", "tg_request_daily")


def upgrade() -> None:
    op.add_column(
        "tg_request_records", sa.Column("sync_failed", sa.Boolean(), nullable=True)
    )
    for table in _TOTALS:
        for name in ("syncs", "failed_syncs"):
            op.add_column(
                table,
                sa.Column(name, sa.Integer(), nullable=False, server_default="0"),
            )


def downgrade() -> None:
    for table in _TOTALS:
        op.drop_column(table, "failed_syncs")
        op.drop_column(table, "syncs")
    op.drop_column("tg_request_records", "sync_failed")
