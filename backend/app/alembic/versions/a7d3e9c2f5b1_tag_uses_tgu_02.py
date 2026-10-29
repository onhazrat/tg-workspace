"""Tag uses, per Account, tab and Tag (TGU-02, ADR-042)

Revision ID: a7d3e9c2f5b1
Revises: f4c9a2e7b3d6
Create Date: 2026-10-29 12:00:00

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a7d3e9c2f5b1"
down_revision = "f4c9a2e7b3d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_tag_uses",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("tab", sa.String(), nullable=False),
        sa.Column("tag_key", sa.String(), nullable=False),
        sa.Column("used_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "tab", "tag_key", "used_at"),
    )


def downgrade() -> None:
    op.drop_table("tg_tag_uses")
