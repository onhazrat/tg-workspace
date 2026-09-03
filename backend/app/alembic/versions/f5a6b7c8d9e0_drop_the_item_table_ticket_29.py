"""Drop the template's `item` table (ticket 29)

`Item` was the FastAPI template's demo resource, kept through the migration as
the one worked example of owner-scoped access. `services/tenancy.py` is that
example now, for 27 tables rather than one, so the demo is dead weight that a
reader has to be told to ignore — `OUT_OF_SCOPE` said so in prose until this
revision deleted the need for it.

The downgrade recreates the table but not its rows. That is the honest shape:
nothing in the application has read or written `item` since the template was
forked, so a rollback wants the schema back for Alembic's sake and has no data
to restore.

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f5a6b7c8d9e0"
down_revision: str | None = "e4f5a6b7c8d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("item")


def downgrade() -> None:
    op.create_table(
        "item",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
