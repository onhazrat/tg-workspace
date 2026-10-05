"""The Directory's search index (DIR-04, ADR-027)

One row per listed Directory entry: a weighted tsvector of its handle and
display name (A), bio (B) and newest samples (C), built with the text search
configuration its Language calls for, and the normalised names for a trigram
typo match.

The table starts empty. `scripts/backfill_directory_search.py` fills it, in
batches and re-runnably; every writer keeps it current after that.

`fastupdate = off` on the GIN index, as GitLab runs its search indexes: the
table turns over about weekly, and a pending list that grows between vacuums is
read by every search. The autovacuum settings are tighter than the default for
the same turnover.

Revision ID: 086f79ada387
Revises: 048ed733ea41
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TSVECTOR

revision: str = "086f79ada387"
down_revision: str | None = "048ed733ea41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "tg_channel_directory_search"


def upgrade() -> None:
    # A trusted extension since PG 13, so the database owner may create it.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_table(
        _TABLE,
        sa.Column("handle", sa.String(), nullable=False),
        sa.Column("ts_config", sa.String(), nullable=False),
        sa.Column("tsv", TSVECTOR(), nullable=False),
        sa.Column("names", sa.Text(), nullable=False),
        sa.Column("index_version", sa.SmallInteger(), nullable=False),
        sa.Column("indexed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["handle"], ["tg_channel_directory.handle"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("handle"),
    )
    op.execute(
        f"ALTER TABLE {_TABLE} SET (autovacuum_vacuum_scale_factor = 0.05, "
        "autovacuum_analyze_scale_factor = 0.05)"
    )
    op.create_index(
        "ix_tg_channel_directory_search_tsv",
        _TABLE,
        ["tsv"],
        postgresql_using="gin",
        postgresql_with={"fastupdate": "off"},
    )
    op.create_index(
        "ix_tg_channel_directory_search_names",
        _TABLE,
        ["names"],
        postgresql_using="gin",
        postgresql_ops={"names": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_tg_channel_directory_search_names", table_name=_TABLE)
    op.drop_index("ix_tg_channel_directory_search_tsv", table_name=_TABLE)
    op.drop_table(_TABLE)
