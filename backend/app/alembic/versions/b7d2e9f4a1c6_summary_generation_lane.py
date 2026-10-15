"""The generation Lane, and one running Attempt per Summary (SFR-02, ADR-030)

Attempts run on the Sync worker, never inside an API request. They get a queue
of their own rather than a place in the scraping Lanes: a Summary waits on a
Provider for minutes, and a scraping slot held that long is throughput taken
from Telegram syncs.

The partial unique index is what refuses a second start: two requests racing
past a read-then-insert would both see no running Attempt.

Revision ID: b7d2e9f4a1c6
Revises: a3f0c8e1b5d7
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d2e9f4a1c6"
down_revision: str | None = "a3f0c8e1b5d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LANE = "summary_generation"


def upgrade() -> None:
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
    op.create_index(
        "ux_tg_summary_attempts_running",
        "tg_summary_attempts",
        ["summary_id"],
        unique=True,
        postgresql_where=sa.text("outcome = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("ux_tg_summary_attempts_running", table_name="tg_summary_attempts")
    op.execute(f"SELECT pgmq.drop_queue('{_LANE}');")
