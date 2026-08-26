"""Denormalise channel_name onto tg_sync_log_payloads (ticket 19)

Ticket 19 makes a sync log channel telemetry: it answers "did this Channel
deliver Posts, and if not why not", which is a fact about the Channel rather
than about whoever triggered the scrape. `SyncLog` and `SyncLogPayload` both
move from `Scope.USER_OWNED` to `Scope.FOLLOW_SCOPED`, and the seam correlates a
follow-scoped table's EXISTS on a real column named in `tenancy.FOLLOW_KEYS`.

`tg_sync_logs` already has `channel_name`. Its payload table did not, so this
adds it and backfills from the parent.

Denormalising rather than joining is the pattern that table already follows and
states in its own docstring: `timestamp` is there so the payload sweep stays a
single-table bulk DELETE instead of joining the whole log table back in. The
scope has the same requirement for the same reason. `tg_sync_logs` was measured
at 191k rows on staging, and putting a join inside the predicate of every read
of the table the payload split exists to keep cheap would give back what that
split bought.

`ADD COLUMN` with a server default is metadata-only on PostgreSQL 11+, so no
table rewrite and no long exclusive lock. The backfill is a single `UPDATE ...
FROM` on a table that is much smaller than its parent, because payloads expire
on the shorter `SYNC_LOG_PAYLOAD_RETENTION` horizon.

Idempotent by construction, like the ticket 06 carve: `prestart.sh` runs
`alembic upgrade head` on every deploy, and re-running the backfill over rows
that already carry the name writes the same value.

A payload whose parent log has already been swept keeps the empty string. The
row is unreadable through the API either way (`get_log` reads the parent first),
and it is deleted on the payload table's own horizon.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-08-26

"""

import sqlalchemy as sa
from alembic import op

revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_sync_log_payloads",
        sa.Column("channel_name", sa.String(), nullable=False, server_default=""),
    )
    op.execute(
        """
        UPDATE tg_sync_log_payloads AS p
           SET channel_name = l.channel_name
          FROM tg_sync_logs AS l
         WHERE l.id = p.sync_log_id
           AND p.channel_name = ''
        """
    )
    # After the backfill, not before. Building it first makes the UPDATE
    # maintain an index for every row it touches and rules out HOT updates,
    # which leaves a freshly built index already bloated.
    op.create_index(
        "ix_tg_sync_log_payloads_channel_name",
        "tg_sync_log_payloads",
        ["channel_name"],
    )
    # The owner stamp is dead as of this ticket, and the rows written before it
    # are cleared rather than left to rot. `upsert_sync_log` stops writing the
    # column, but three sweeps still read it — `jobs/retention.run_retention_cleanup`,
    # `logs.delete_old_logs` / `expire_sync_payloads_stmt`, and `stats._scoped_count`
    # / `_scoped_delete` — all as `user_id = :operator OR user_id IS NULL`.
    #
    # Left in place, a row stamped with some *other* account before the upgrade
    # matches none of those predicates ever again: it is excluded from every
    # retention sweep and from `syncLogCount` permanently, while the Logs tab
    # goes on showing it because that read is follow-scoped now. A log that is
    # visible, uncountable and unreclaimable is the worst of the three states.
    #
    # Nulling the column makes all three predicates behave identically for every
    # row, which is the behaviour a single-operator deployment already had.
    # Ticket 22 drops both columns; this only stops them lying in the meantime.
    op.execute("UPDATE tg_sync_logs SET user_id = NULL WHERE user_id IS NOT NULL")
    op.execute(
        "UPDATE tg_sync_log_payloads SET user_id = NULL WHERE user_id IS NOT NULL"
    )


def downgrade() -> None:
    # The owner stamps are not restored. They were a "who triggered this scrape"
    # note that nothing read, and there is nowhere left to read them from.
    op.drop_index(
        "ix_tg_sync_log_payloads_channel_name", table_name="tg_sync_log_payloads"
    )
    op.drop_column("tg_sync_log_payloads", "channel_name")
