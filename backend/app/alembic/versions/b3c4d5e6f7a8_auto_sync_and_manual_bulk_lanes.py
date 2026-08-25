"""Create the auto_sync_normal and manual_bulk_normal lanes (ticket 10)

Ticket 10 moves the scheduler out of the web process, and the thing that
actually makes the web process stop scheduling is that auto-sync and bulk-follow
*enqueue* instead of calling `run_sync_job`. That needs somewhere to enqueue to.

**Two lanes, not the remaining five.** Ticket 12 owns "six lanes exist" and the
weighted draining between them; adding the best-effort tier here would be
building a priority mechanism before anything can choose a priority (ticket 23
is what first selects a tier). These two are the normal-tier homes for the two
Budgets that still ran in-process after ticket 09 — `Budget.AUTO_SYNC` and
`Budget.MANUAL_BULK` in `app/services/quota.py`, paired with `TIER_NORMAL` by
`app/services/sync_lanes.py`, which is the module that decides these names.

Idempotent, because `prestart.sh` runs `alembic upgrade head` on every deploy
and because a lane may already exist on a database where a previous attempt got
part-way: `pgmq.create` raises on an existing queue, so this checks `pgmq.meta`
first rather than relying on the migration having run exactly once.

Revision ID: b3c4d5e6f7a8
Revises: f0a1b2c3d4e5
Create Date: 2026-08-25

"""

from alembic import op

revision = "b3c4d5e6f7a8"
down_revision = "f0a1b2c3d4e5"
branch_labels = None
depends_on = None

#: Kept as literals rather than imported from `app.services.sync_lanes`: a
#: migration must keep describing the schema it created even if the constant it
#: was named after is later renamed or deleted. `tests/services/test_sync_lanes.py`
#: is what asserts the two spellings still agree.
_LANES = ("auto_sync_normal", "manual_bulk_normal")


def upgrade() -> None:
    for lane in _LANES:
        op.execute(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pgmq.meta WHERE queue_name = '{lane}'
                ) THEN
                    PERFORM pgmq.create('{lane}');
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    # The schema itself is `f0a1b2c3d4e5`'s to drop — it installed it, and
    # `manual_single_normal` still lives in it after this downgrade.
    for lane in _LANES:
        op.execute(f"SELECT pgmq.drop_queue('{lane}');")
