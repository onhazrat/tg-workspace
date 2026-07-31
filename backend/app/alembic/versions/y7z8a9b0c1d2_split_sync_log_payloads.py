"""move sync log request/response bodies into tg_sync_log_payloads

``tg_sync_logs`` is the heaviest table in the schema — ``full_response`` is
~17KB/row and up to 3MB — and it has both OOM-killed a staging worker and
filled the operator box's disk.

Retention alone cannot recover from that. A bulk DELETE only marks rows dead:
PostgreSQL returns the space to the table's freelist for reuse, never to the
operating system. Shrinking a table needs VACUUM FULL, which rewrites it into a
new file and so wants free space equal to the table being rewritten — exactly
what is missing once logs have filled the disk. Held in their own table the
bodies can be truncated instead: instant, no headroom needed, and every log row
(status, error, counts) survives.

The bodies are deliberately **not** copied across. They are disposable by
design, the operator's payloads were already lost when the table was dropped to
free space, and copying them would need the very headroom this migration exists
to reclaim. Existing logs keep their metadata and report null bodies.

There is no foreign key to ``tg_sync_logs``: the new table has to stay
droppable and truncatable at any moment, so ``app.services.logs`` cleans up
explicitly rather than relying on a cascade.

Revision ID: y7z8a9b0c1d2
Revises: x6y7z8a9b0c1
Create Date: 2026-07-31
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "y7z8a9b0c1d2"
down_revision = "x6y7z8a9b0c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_sync_log_payloads",
        sa.Column("sync_log_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        # BigInteger, not Integer: these are JS-style ms epochs, which overflow
        # a 32-bit column (see c3d4e5f6a7b8_widen_ms_timestamp_columns).
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("full_request", sa.JSON(), nullable=True),
        sa.Column("full_response", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("sync_log_id"),
    )
    op.create_index(
        op.f("ix_tg_sync_log_payloads_user_id"),
        "tg_sync_log_payloads",
        ["user_id"],
        unique=False,
    )

    op.drop_column("tg_sync_logs", "full_request")
    op.drop_column("tg_sync_logs", "full_response")


def downgrade() -> None:
    # Restores the columns empty. The split is one-way for data: payloads are
    # not copied back, matching the upgrade.
    op.add_column("tg_sync_logs", sa.Column("full_response", sa.JSON(), nullable=True))
    op.add_column("tg_sync_logs", sa.Column("full_request", sa.JSON(), nullable=True))

    op.drop_index(
        op.f("ix_tg_sync_log_payloads_user_id"), table_name="tg_sync_log_payloads"
    )
    op.drop_table("tg_sync_log_payloads")
