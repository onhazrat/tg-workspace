"""A Post's View count and reaction chips are columns (REACH-01, ADR-024).

Adds `views_count`, `reaction_counts` and `views_observed_at` to `tg_posts`,
all nullable, and sets `fillfactor = 90` so that a later refresh of the
unindexed counters can be a HOT update. The fillfactor applies to pages
written from now on; existing pages keep theirs until the table is rewritten.

Copying the counters out of media is `backend/scripts/move_post_counters_to_columns.py`,
run after the deploy, because it rewrites every Post's TOASTed media.

Revision ID: 4e7a1c9b3d20
Revises: a7c3e9f1d2b4
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "4e7a1c9b3d20"
down_revision: str | None = "a7c3e9f1d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tg_posts", sa.Column("views_count", sa.Integer(), nullable=True))
    op.add_column(
        "tg_posts",
        sa.Column("reaction_counts", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "tg_posts", sa.Column("views_observed_at", sa.BigInteger(), nullable=True)
    )
    op.execute("ALTER TABLE tg_posts SET (fillfactor = 90)")


def downgrade() -> None:
    op.execute("ALTER TABLE tg_posts RESET (fillfactor)")
    op.drop_column("tg_posts", "views_observed_at")
    op.drop_column("tg_posts", "reaction_counts")
    op.drop_column("tg_posts", "views_count")
