"""The Discover probe lane (ticket 36, ADR-012 D9)

A seventh queue, and the first that does not carry a Channel sync. Handle
probes ran on an `asyncio.Semaphore(2)` of their own, outside the scraping
Partition — a second budget nothing counted, and fetches that took no Slot and
so bound to no proxy.

On the lane they are drained by the same consumer, strictly after every sync
lane, which is what "lower priority than other requests to Telegram" means
using machinery that already exists. `LaneScheduler` is strict between tiers;
this comes after the last of them.

Its name is not `lane_name(budget, tier)` and it has no Budget on purpose:
ticket 23 left probes uncharged because `DiscoverHandleProbe` is corpus-scoped,
and billing one account for deployment-wide work is what the three Budgets
exist to prevent.

Revision ID: e8f9a0b1c2d3
Revises: c5d6e7f8a9b0
Create Date: 2026-09-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e8f9a0b1c2d3"
down_revision: str | None = "c5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: A literal rather than an import from `app.services.sync_lanes`, following
#: the lane migrations before it: a migration must keep describing what it
#: created even if the constant it was named after is renamed or deleted.
#: `tests/services/test_sync_lanes.py` asserts the two spellings still agree.
_LANE = "discover_probe_background"


def upgrade() -> None:
    # Idempotent, because `pgmq.create` raises on an existing queue and a
    # half-applied migration re-run must not fail on the queue it made.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pgmq.meta WHERE queue_name = '{_LANE}'
            ) THEN
                PERFORM pgmq.create('{_LANE}');
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(f"SELECT pgmq.drop_queue('{_LANE}');")
