"""A Directory entry's median views become Reach (REACH-04, ADR-024).

Renames `tg_channel_directory.median_views` to `reach` and adds
`reach_estimated`. The stored values are still medians of hours-old View counts
until `backend/scripts/recompute_directory_reach.py` runs after the deploy; a
script rather than this migration because the rule lives in Python
(`services/reach.py`) and an applied revision must keep meaning what it meant.

Revision ID: 5b8d2f6e1a47
Revises: 4e7a1c9b3d20
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5b8d2f6e1a47"
down_revision: str | None = "4e7a1c9b3d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("tg_channel_directory", "median_views", new_column_name="reach")
    op.add_column(
        "tg_channel_directory",
        sa.Column(
            "reach_estimated", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("tg_channel_directory", "reach_estimated")
    op.alter_column("tg_channel_directory", "reach", new_column_name="median_views")
