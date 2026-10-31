"""Confirmed gaps whose Post is stored are not gaps (CW-01, ADR-043)

Storing a Post now clears its confirmed gap in the same write. Until now it
did not: on one deployment 2,955 of 36,013 confirmed gaps were ids already
held, which inflates every hole count. This deletes them. Irreversible, and
nothing to restore: each deleted row contradicted a stored Post.

Revision ID: d6f2b8a4c013
Revises: c5e1a7f3b902
Create Date: 2026-10-30 12:10:00

"""

import sqlalchemy as sa
from alembic import op

revision = "d6f2b8a4c013"
down_revision = "c5e1a7f3b902"
branch_labels = None
depends_on = None

#: Run by the test against seeded rows, so the test reads what deploy runs.
CLEAR_SQL = (
    "DELETE FROM tg_post_sync_state g USING tg_posts p"
    " WHERE p.channel_name = g.channel_name AND p.post_id = g.post_id"
)


def upgrade() -> None:
    op.execute(sa.text(CLEAR_SQL))


def downgrade() -> None:
    pass
