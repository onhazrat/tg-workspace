"""Per-Channel sync claim (ticket 11)

Two columns on `tg_channels`, and deliberately not a table of their own.

The claim exists to serialise writes to four cursors that already live on this
row -- `last_updated`, `anchor_post_id`, `oldest_stored_post_timestamp` and
`history_complete_to_cutoff` -- so claiming and reading what the claim protects
is one primary-key hit rather than a join. Decision 33 of
`docs/multi-user-tenancy-plan.md` names a field for the same reason.

Neither column is indexed, on purpose. Every access is by `tg_channels.id`,
which is the primary key, so an index here would buy nothing and cost a write
on each claim, heartbeat and release -- and leaving them unindexed is what lets
those three stay HOT updates instead of churning a table every channel list
reads.

Nullable with no backfill: a NULL claim means "not being synced", which is the
true state of every Channel at the moment this runs. There is nothing to adopt.

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-08-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8b9c0d1e2f3"
down_revision: str | None = "f7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tg_channels",
        sa.Column("sync_claimed_at", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "tg_channels",
        sa.Column("sync_claimed_by", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tg_channels", "sync_claimed_by")
    op.drop_column("tg_channels", "sync_claimed_at")
