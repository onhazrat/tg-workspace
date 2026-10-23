"""The job each Request was charged with (RQS review)

The ledger charges a sync or follow job once, on the day it ends, so the
daily ledger check reads each charged Request's day from its job.

Revision ID: f4c9a2e7b3d6
Revises: e5b2c7d9f4a1
Create Date: 2026-10-24 12:00:00

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f4c9a2e7b3d6"
down_revision = "e5b2c7d9f4a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_request_records", sa.Column("job_id", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tg_request_records", "job_id")
