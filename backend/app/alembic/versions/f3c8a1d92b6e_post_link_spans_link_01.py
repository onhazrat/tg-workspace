"""A Post keeps its Links as positions over its text (LINK-01, ADR-022).

Adds `tg_posts.link_spans`, nullable and never backfilled. A masked Link's
destination was discarded at scrape time and no stored column holds it, so a
Post stored before this revision stays null, and null is how the renderer
knows to fall back to its regex. Sync never re-reads a stored Post, so the
column fills in through new Posts, first syncs and import.

Revision ID: f3c8a1d92b6e
Revises: e5a1c7d20b94
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3c8a1d92b6e"
down_revision: str | None = "e5a1c7d20b94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tg_posts", sa.Column("link_spans", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("tg_posts", "link_spans")
