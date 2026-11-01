"""A Directory entry comes due by expected new Posts (DRP-01, ADR-045)

Five steps, one revision:

1. A stored `directoryRefreshDays` becomes `directoryRefreshMaxDays`, so a
   deployment that stored 7 keeps a 7-day longest wait until an Operator
   changes it.
2. `refresh_target`, an entry's own Refresh target; `NULL` follows the
   deployment's.
3. A partial index on `(effective_priority, refresh_due_at)` for the stale leg
   of the dequeue, which now drains most overdue first among equals.
4. Every stored Posting rate is rebuilt from stored columns. The old rate was
   `(n - 1) / (newest - oldest)`, so the samples spanned `(n - 1) / old` weeks
   and ended at `last_post_at`; the new one is `n` over the time from the oldest
   sample to `checked_at`. Exact for every row with a rate, and no scan of the
   samples table, which timed out on staging. Live verdicts only: an
   `unavailable` entry's `checked_at` is the later answer that sealed it, not
   the fetch that took its samples. A followed Channel's `checked_at` is its
   last sync, so its rebuilt rate reads a little slow; sync keeps that entry
   current without a Refresh, so its due date does not matter.
5. Every live entry's due date is recomputed from the stored settings, falling
   back to the defaults 20 / 4 / 120. The 7-day backlog is resolved on deploy.

Each statement is frozen here, as an applied revision must keep meaning what it
meant; `tests/services/test_directory_refresh_migration.py` runs these
statements.

The downgrade drops the column and the index and renames the setting back. The
rebuilt rates and due dates stay: the next probe of each entry rewrites both.

Revision ID: b5e9d3f7a2c8
Revises: a4d8e2c6f019
Create Date: 2026-11-01
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "b5e9d3f7a2c8"
down_revision: str | None = "a4d8e2c6f019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "tg_channel_directory"
_INDEX = "ix_tg_channel_directory_refresh_queue"

#: The defaults in force when this revision was written.
DEFAULTS = {
    "directoryRefreshTarget": 20,
    "directoryRefreshMinDays": 4,
    "directoryRefreshMaxDays": 120,
}

RENAME_SETTING_SQL = """
UPDATE tg_app_settings
SET value = ((value::jsonb - 'directoryRefreshDays')
    || jsonb_build_object('directoryRefreshMaxDays', value::jsonb -> 'directoryRefreshDays'))::json
WHERE key = 'directory' AND value::jsonb ? 'directoryRefreshDays'
"""

_RENAME_BACK_SQL = """
UPDATE tg_app_settings
SET value = ((value::jsonb - 'directoryRefreshMaxDays')
    || jsonb_build_object('directoryRefreshDays', value::jsonb -> 'directoryRefreshMaxDays'))::json
WHERE key = 'directory' AND value::jsonb ? 'directoryRefreshMaxDays'
"""

REBUILD_RATE_SQL = """
UPDATE tg_channel_directory
SET posts_per_week = sample_count / (
    extract(epoch FROM greatest(checked_at, last_post_at) - last_post_at) / 604800.0
    + (sample_count - 1) / posts_per_week)
WHERE status = 'ok'
  AND posts_per_week > 0
  AND sample_count >= 5
  AND checked_at IS NOT NULL
  AND last_post_at IS NOT NULL
"""

#: `channel_directory._RECOMPUTE_DUE` as it stood. -1 is `RECHECK_PRIORITY`,
#: an entry an Operator made due on demand, which stays due.
RECOMPUTE_DUE_SQL = """
UPDATE tg_channel_directory
SET refresh_due_at = greatest(
    checked_at + make_interval(secs => 86400 * CASE
        WHEN posts_per_week > 0 THEN least(greatest(
            7.0 * coalesce(refresh_target, :target) / posts_per_week,
            :min_days), :max_days)
        ELSE :max_days END),
    retry_after)
WHERE status = 'ok'
  AND kind NOT IN ('bot', 'group', 'user')
  AND checked_at IS NOT NULL
  AND priority <> -1
"""


def policy(connection: Any) -> dict[str, int]:
    """The stored settings over `DEFAULTS`, as `RECOMPUTE_DUE_SQL` takes them.

    Each is read at its nearest bound, as `channel_directory.refresh_policy`
    reads them: a stored window of 0 meant "never refresh" before this
    revision, and a wait of 0 would mean "refresh every tick".
    """
    stored = connection.execute(
        sa.text("SELECT value FROM tg_app_settings WHERE key = 'directory'")
    ).scalar()
    merged = {**DEFAULTS, **(stored or {})}
    return {
        "target": min(max(int(merged["directoryRefreshTarget"]), 1), 1000),
        "min_days": max(int(merged["directoryRefreshMinDays"]), 1),
        "max_days": max(int(merged["directoryRefreshMaxDays"]), 1),
    }


def upgrade() -> None:
    op.execute(RENAME_SETTING_SQL)
    op.add_column(_TABLE, sa.Column("refresh_target", sa.SmallInteger(), nullable=True))
    op.create_index(
        _INDEX,
        _TABLE,
        ["effective_priority", "refresh_due_at"],
        unique=False,
        postgresql_where=sa.text("refresh_due_at IS NOT NULL"),
    )
    op.execute(REBUILD_RATE_SQL)
    connection = op.get_bind()
    connection.execute(sa.text(RECOMPUTE_DUE_SQL), policy(connection))


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, "refresh_target")
    op.execute(_RENAME_BACK_SQL)
