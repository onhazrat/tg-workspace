"""Each message of an Album is its own Post (ALB-01, ADR-046)

`album_id` holds the Album's first message id on every Post of an Album, and
is null outside one. No backfill: an Album stored as one Post keeps a null
until ALB-02 re-scrapes it.

Revision ID: c7f2a9e4d1b6
Revises: b5e9d3f7a2c8
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7f2a9e4d1b6"
down_revision: str | None = "b5e9d3f7a2c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tg_posts", sa.Column("album_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tg_posts", "album_id")
