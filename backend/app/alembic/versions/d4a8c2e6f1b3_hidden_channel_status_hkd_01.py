"""A Hidden Channel's verdict is `hidden`, not `private` (HKD-01, ADR-047)

In Telegram a private channel is one with no username, and every Directory
entry has one. Only the stored word changes; the rows mean what they meant.

Revision ID: d4a8c2e6f1b3
Revises: c7f2a9e4d1b6
Create Date: 2026-11-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d4a8c2e6f1b3"
down_revision: str | None = "c7f2a9e4d1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE tg_channel_directory SET status = 'hidden' WHERE status = 'private'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE tg_channel_directory SET status = 'private' WHERE status = 'hidden'"
    )
