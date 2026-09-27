"""View observations: sampled sightings of a Post's View count (REACH-05, ADR-024).

Creates `tg_view_observations`, one row per sighting of a Post the Observation
stride selects, keyed by `(post_uuid, observed_at)` and cascading from
`tg_posts`. `published_at` is indexed because the prune deletes by it. The
stride's runtime row in `tg_app_settings` is not seeded: a missing row reads
as stride 1.

Revision ID: c770921c22d6
Revises: 4e7a1c9b3d20
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c770921c22d6"
down_revision: str | None = "4e7a1c9b3d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tg_view_observations",
        sa.Column("post_uuid", sa.Uuid(), nullable=False),
        sa.Column("observed_at", sa.BigInteger(), nullable=False),
        sa.Column("views_count", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["post_uuid"], ["tg_posts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("post_uuid", "observed_at"),
    )
    op.create_index(
        "ix_tg_view_observations_published_at",
        "tg_view_observations",
        ["published_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tg_view_observations_published_at", table_name="tg_view_observations"
    )
    op.drop_table("tg_view_observations")
