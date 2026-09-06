"""Directory entries go stale and come due again (ticket 03, IDEA-011 D16)

`refresh_due_at` is when a live entry's answer stops being current. Tickets 01
and 02 cached a conclusive verdict indefinitely, which is right for
followability — a bot does not become a channel — and wrong for a map, whose
whole value is that it describes Telegram now.

**It is deliberately a second column and not `retry_after`.** That one means
"this fetch failed, back off"; this one means "this answer is old". Same type,
opposite cause, and the one time they were conflated the result was a probe
starved behind sync work being mistaken for a probe that had failed. The dequeue
reads them as separate legs for that reason.

`NULL` means never due, which covers both halves of the exemption: a dead
verdict (bot, group, user account, private, deleted) that a timer cannot change,
and a handle with no answer yet, which is pending rather than stale.

Existing live entries are backfilled with a **jittered** due time, spread evenly
across one window. Leaving them `NULL` was the first draft and it shipped the
feature switched off: nothing re-probes a conclusive row. `enqueue_handles`
skips one, the pending leg of the dequeue wants `status = 'unknown'`, and the
stale leg wants a due time — so on any deployment that already has a Directory,
which is every deployment after ticket 01's seed, the window would have refreshed
nothing at all until somebody pressed refresh by hand. Stamping them all with the
same time is the other failure: a crawl of the whole Directory on the first sweep
after the upgrade, which is precisely the load the window is the lever against.
`random()` answers both, and it costs one full window before the first refresh
lands rather than making the upgrade itself the spike.

Dead entries stay `NULL`, matching `is_refreshable`: `unavailable` is private or
deleted, and `bot`/`group`/`user` is what the page turned out to be.

The index is partial. Only rows carrying a due time are ever asked about, and on
a mature Directory the dead and the never-probed are most of the table.

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-09-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "tg_channel_directory"
_INDEX = "ix_tg_channel_directory_refresh_due"


#: The default window, in days. Frozen as a literal rather than read from
#: `config.py`: an applied revision has to keep meaning what it meant, and a
#: later change to the default must not retroactively describe a different
#: backfill. The live setting takes over from the first refresh onward.
_BACKFILL_WINDOW_DAYS = 7

#: Mirrors `channel_directory.is_refreshable` — a live verdict and a live kind.
#: Frozen here for the same reason the window is.
_BACKFILL_DUE = sa.text(
    """
    UPDATE tg_channel_directory
    SET refresh_due_at = NOW() + (random() * INTERVAL ':days days')
    WHERE status = 'ok'
      AND kind NOT IN ('bot', 'group', 'user')
      AND checked_at IS NOT NULL
    """.replace(":days", str(_BACKFILL_WINDOW_DAYS))
)


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("refresh_due_at", sa.DateTime(), nullable=True))
    op.create_index(
        _INDEX,
        _TABLE,
        ["refresh_due_at"],
        unique=False,
        postgresql_where=sa.text("refresh_due_at IS NOT NULL"),
    )
    # The index first, so the backfill's rows land in an index that exists
    # rather than being caught by one built over them afterwards.
    op.execute(_BACKFILL_DUE)


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, "refresh_due_at")
