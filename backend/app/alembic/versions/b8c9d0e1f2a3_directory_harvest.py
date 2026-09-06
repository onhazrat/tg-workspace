"""The harvest sweep: what the crawl costs, and the walk that feeds it (ticket 04, IDEA-011 D16)

Two changes, both in service of handles entering the Directory on their own.

`tg_directory_probe_usage` is the deployment-level tally of what the probe lane
spent. It has no owner column and that is the claim, not an omission: a probe
answers a question about the corpus, so there is no account whose Request it is.
Ticket 23 left probe traffic charged to nobody deliberately; counting it here
does not reopen that, because a tally is not a Budget. What changed is that the
harvest sweep makes probe traffic something that runs unprompted, and an
uncounted crawler is one you hear about from Telegram rather than from a
dashboard.

`ix_tg_posts_timestamp` is what makes the harvest walk affordable. The sweep
walks stored Posts in `timestamp` order from a cursor, and `tg_posts` carried
only `(channel_name, timestamp)` — useless for a global order with no channel
equality, so every tick would have seq-scanned the table and top-N sorted it.
That is precisely the "a scheduled job pays its cost every tick, forever" shape
this repo has already paid for once. One btree on an int8, on a table whose
inserts are batched by the sync orchestrator.

No backfill. The usage table starts empty because the days before this
revision genuinely have no count, and a zero row for them would be
indistinguishable from a real quiet day — the same reason `charge_requests`
refuses a zero charge.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_USAGE_TABLE = "tg_directory_probe_usage"
_POSTS_INDEX = "ix_tg_posts_timestamp"


def upgrade() -> None:
    op.create_table(
        _USAGE_TABLE,
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("day"),
    )
    op.create_index(_POSTS_INDEX, "tg_posts", ["timestamp"])


def downgrade() -> None:
    op.drop_index(_POSTS_INDEX, table_name="tg_posts")
    op.drop_table(_USAGE_TABLE)
