"""Directory entries carry a Language instead of an alphabet (LANG-05, ADR-021).

`script` was a per-character tally that read Persian and Arabic as one answer.
It is dropped rather than translated: an alphabet names no Language. No
backfill, because the detector lives in Python and the samples are refreshed
inside the Directory window anyway; each entry gains a Language on its next
conclusive probe.

Revision ID: e5a1c7d20b94
Revises: cb38e8223f97
Create Date: 2026-09-23 20:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e5a1c7d20b94"
down_revision = "cb38e8223f97"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tg_channel_directory", sa.Column("language", sa.String(), nullable=True)
    )
    op.drop_column("tg_channel_directory", "script")


def downgrade():
    op.add_column(
        "tg_channel_directory", sa.Column("script", sa.String(), nullable=True)
    )
    op.drop_column("tg_channel_directory", "language")
