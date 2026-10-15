"""Drop `Post.harvested` (DDS-03)

DDS-02 made the harvest sweep read the reference graph instead of walking the
Posts, so nothing reads the flag or its partial index any more. Staging ran on
the graph for 17 days before this, with the Directory growing from 64.5k entries
to 843k.

The downgrade puts the column back with every Post unharvested, as ticket 05's
revision added it. No reader is restored with it, so that state is never wrong.

Revision ID: e4c7a2b9d1f0
Revises: db2bb3daf99f
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4c7a2b9d1f0"
down_revision: str | None = "db2bb3daf99f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UNHARVESTED_INDEX = "ix_tg_posts_unharvested"


def upgrade() -> None:
    op.drop_index(_UNHARVESTED_INDEX, table_name="tg_posts")
    op.drop_column("tg_posts", "harvested")


def downgrade() -> None:
    op.add_column(
        "tg_posts",
        sa.Column(
            "harvested", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_index(
        _UNHARVESTED_INDEX,
        "tg_posts",
        [sa.text("timestamp DESC")],
        postgresql_where=sa.text("NOT harvested"),
    )
