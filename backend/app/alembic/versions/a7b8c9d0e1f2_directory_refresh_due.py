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

Existing rows are left `NULL` on purpose. A backfill would make every entry the
deployment already holds due at once, which is a crawl of the whole Directory on
the first sweep after the upgrade — precisely the load the refresh window is the
lever against. They come due as they are re-probed for other reasons, and the
followed ones are refreshed by sync within a sync interval anyway.

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


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("refresh_due_at", sa.DateTime(), nullable=True))
    op.create_index(
        _INDEX,
        _TABLE,
        ["refresh_due_at"],
        unique=False,
        postgresql_where=sa.text("refresh_due_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, "refresh_due_at")
