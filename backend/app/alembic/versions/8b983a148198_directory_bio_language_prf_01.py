"""A Directory entry's Bio language (PRF-01, ADR-048)

The Language of the entry's Bio alone, beside the Language its Posts decide.
`None` until the Bio is read; the one-off `backfill_bio_language.py` reads the
Bios already stored.

Revision ID: 8b983a148198
Revises: d4a8c2e6f1b3
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8b983a148198"
down_revision: str | None = "d4a8c2e6f1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tg_channel_directory", sa.Column("bio_language", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tg_channel_directory", "bio_language")
