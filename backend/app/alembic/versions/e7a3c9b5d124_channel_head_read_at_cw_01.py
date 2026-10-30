"""When a sync last read each Channel's newest page (CW-01, ADR-043)

Revision ID: e7a3c9b5d124
Revises: d6f2b8a4c013
Create Date: 2026-10-30 12:20:00

No backfill: Last sync is when a sync finished, after its head read, so
copying it would claim more than any sync saw. Each Channel gains the moment
on its next sync.

"""

import sqlalchemy as sa
from alembic import op

revision = "e7a3c9b5d124"
down_revision = "d6f2b8a4c013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tg_channels", sa.Column("head_read_at", sa.BigInteger()))


def downgrade() -> None:
    op.drop_column("tg_channels", "head_read_at")
