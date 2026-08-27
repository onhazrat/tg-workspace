"""Create the three best-effort lanes (ticket 12)

Decision 27 is six queues, `{auto_sync, manual_bulk, manual_single} x {normal,
best_effort}`. Ticket 09 created one, ticket 10 created the two other
normal-tier lanes, and these are the remaining three — the point at which the
product is complete and `app/services/sync_lanes.py` can stop describing lanes
that do not exist.

**Created before anything enqueues onto them, deliberately.** Ticket 23 is what
first selects the best-effort tier; until then these three stay empty. That is
not a mechanism with no caller — the *consumer* is the caller, and it is in
this ticket: the strict-between-tiers rule in `LaneScheduler` is only testable,
and `sync_lane_control` can only pause or drain a lane, if the lane exists.
`pgmq.read` raises on a queue that was never created, so a lane the worker
drains and no migration makes is every sweep failing, not a quiet no-op.

Idempotent, because `prestart.sh` runs `alembic upgrade head` on every deploy
and because a lane may already exist on a database where a previous attempt got
part-way: `pgmq.create` raises on an existing queue, so this checks `pgmq.meta`
first rather than relying on the migration having run exactly once.

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-08-27

"""

from alembic import op

revision = "b9c0d1e2f3a4"
down_revision = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None

#: Kept as literals rather than imported from `app.services.sync_lanes`: a
#: migration must keep describing the schema it created even if the constant it
#: was named after is later renamed or deleted. `tests/services/test_sync_lanes.py`
#: is what asserts the two spellings still agree.
_LANES = (
    "manual_single_best_effort",
    "manual_bulk_best_effort",
    "auto_sync_best_effort",
)


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
    # The schema itself is `f0a1b2c3d4e5`'s to drop — it installed it, and the
    # three normal-tier lanes still live in it after this downgrade.
    for lane in _LANES:
        op.execute(f"SELECT pgmq.drop_queue('{lane}');")
