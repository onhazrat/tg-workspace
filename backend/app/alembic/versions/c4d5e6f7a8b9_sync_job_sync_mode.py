"""Persist sync_mode on tg_sync_jobs (ticket 10)

`SyncJobState.sync_mode` existed only in memory, which was sound while the
process that created a job was also the one that ran it. Ticket 10 splits those
apart: the worker rehydrates the job from this row, and `_row_to_state` had no
column to read, so **every job the worker ran came back as `auto`** — the
dataclass default.

That is silent in both places it matters:

* `quota.budget_for_sync_mode` bills the Requests, so a manual single sync was
  charged against `auto_sync`. Tickets 23 and 24 make decisions from those
  numbers.
* `channel_allows_sync_operation` decides whether a Channel's setting group
  permits the operation at all, so a Channel that forbids bulk syncs but allows
  automatic ones would have been synced by a bulk request, and vice versa.

Backfilled to `auto` for existing rows, which is what the code was effectively
assuming for all of them anyway. `tg_sync_jobs` is a write-only audit trail
pruned by `SYNC_JOB_RETENTION_DAYS`, so a wrong historical value on rows nobody
reads is not worth reconstructing from `source`.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-08-25

"""

import sqlalchemy as sa
from alembic import op

revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_sync_jobs",
        sa.Column("sync_mode", sa.String(), nullable=False, server_default="auto"),
    )


def downgrade() -> None:
    op.drop_column("tg_sync_jobs", "sync_mode")
