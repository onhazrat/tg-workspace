"""make tg_discover_probes drainable as a work queue

Adds the two columns that let the backend answer "which handles still need
probing" without being handed a candidate list (IDEA-011 D9, server-side
orchestration):

* ``priority`` — drain order, set from candidate rank at enqueue time.
* ``retry_after`` — materialized backoff deadline, so the dequeue is one
  indexable WHERE instead of recomputing the backoff per row in Python.

Existing rows get ``priority`` at the sentinel default and ``retry_after`` NULL.
NULL means "due now", so a handle that was mid-backoff when this ran gets one
free immediate retry — cheaper than deriving a deadline from ``attempted_at``,
and harmless because an extra attempt only costs one fetch.

Revision ID: x6y7z8a9b0c1
Revises: w5x6y7z8a9b0
Create Date: 2026-07-30
"""

import sqlalchemy as sa
from alembic import op

revision = "x6y7z8a9b0c1"
down_revision = "w5x6y7z8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_discover_probes",
        sa.Column(
            "priority", sa.Integer(), nullable=False, server_default="1000000"
        ),
    )
    op.add_column(
        "tg_discover_probes",
        sa.Column("retry_after", sa.DateTime(), nullable=True),
    )
    # Serves the dequeue directly: status narrows to the pending rows, priority
    # gives the drain order without a sort. Composite, so declared here rather
    # than on the model — matching ix_tg_posts_channel_name_timestamp and
    # ix_tg_discover_reports_timestamp. No separate index on priority alone:
    # nothing queries it without status.
    op.create_index(
        "ix_tg_discover_probes_queue",
        "tg_discover_probes",
        ["status", "priority"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_tg_discover_probes_queue", table_name="tg_discover_probes")
    op.drop_column("tg_discover_probes", "retry_after")
    op.drop_column("tg_discover_probes", "priority")
