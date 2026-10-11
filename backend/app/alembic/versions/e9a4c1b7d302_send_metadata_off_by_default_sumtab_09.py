"""Send metadata off by default, existing Summaries included (SUMTAB-09)

Every Summary the browser opened stored `sendMetadata: true` whether or not
anyone asked, so a stored `true` records no choice. The flag is dropped from
every Summary, which reads as off: a Summary sends metadata only once somebody
turns the switch on again. Not reversible, because the old value was a default.

Revision ID: e9a4c1b7d302
Revises: c2d8e4a61f07
Create Date: 2026-10-10
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e9a4c1b7d302"
down_revision: str | None = "c2d8e4a61f07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE tg_summaries SET extra = (extra::jsonb - 'sendMetadata')::json "
        "WHERE extra::jsonb ->> 'sendMetadata' = 'true'"
    )


def downgrade() -> None:
    pass
