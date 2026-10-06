"""Citation pairs and counts (DIR-05, ADR-028)

One row per distinct citing Channel and cited Channel with its Reference
count, and per handle how many distinct Channels cite it and it cites. Both
start empty: `scripts/backfill_citation_pairs.py` fills them from the existing
References, in batches and re-runnably; `post_references.write_references`
keeps them current after that.

Revision ID: 96ca1cdc4d39
Revises: 086f79ada387
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "96ca1cdc4d39"
down_revision: str | None = "086f79ada387"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tg_citation_pairs",
        sa.Column("citing_handle", sa.String(), nullable=False),
        sa.Column("cited_handle", sa.String(), nullable=False),
        sa.Column("reference_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("citing_handle", "cited_handle"),
    )
    op.create_index(
        "ix_tg_citation_pairs_cited", "tg_citation_pairs", ["cited_handle"]
    )
    op.create_table(
        "tg_citation_counts",
        sa.Column("handle", sa.String(), nullable=False),
        sa.Column("cited_by", sa.Integer(), nullable=False),
        sa.Column("cites", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("handle"),
    )


def downgrade() -> None:
    op.drop_table("tg_citation_counts")
    op.drop_index("ix_tg_citation_pairs_cited", table_name="tg_citation_pairs")
    op.drop_table("tg_citation_pairs")
