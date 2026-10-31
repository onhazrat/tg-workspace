"""A kept Partial response is Cut short, not Incomplete (CW-01, ADR-043)

The flag in `tg_summaries.extra` was `incomplete`; ADR-043 gives "incomplete"
to Incomplete Channels, so the key becomes `cutShort`. Its value moves as is.

Revision ID: c5e1a7f3b902
Revises: a7d3e9c2f5b1
Create Date: 2026-10-30 12:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "c5e1a7f3b902"
down_revision = "a7d3e9c2f5b1"
branch_labels = None
depends_on = None


def _rename(old: str, new: str) -> str:
    return (
        "UPDATE tg_summaries SET extra = ((extra::jsonb - :old)"
        " || jsonb_build_object(:new, extra::jsonb -> :old))::json"
        " WHERE extra IS NOT NULL AND (extra::jsonb) ? :old"
    ).replace(":old", f"'{old}'").replace(":new", f"'{new}'")


#: Run by the test against seeded rows, so the test reads what deploy runs.
RENAME_SQL = _rename("incomplete", "cutShort")


def upgrade() -> None:
    op.execute(sa.text(RENAME_SQL))


def downgrade() -> None:
    op.execute(sa.text(_rename("cutShort", "incomplete")))
