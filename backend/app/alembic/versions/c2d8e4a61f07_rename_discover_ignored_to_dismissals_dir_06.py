"""Rename tg_discover_ignored to tg_dismissals (DIR-06)

A Dismissal is one Account's, shared by Discovery reports and the Directory, so
the table takes the glossary's name. A rename, not a copy: every existing row,
its composite key `(handle, user_id)` and its cascading foreign key are kept,
and only the names move.

Revision ID: c2d8e4a61f07
Revises: 96ca1cdc4d39
Create Date: 2026-10-06
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c2d8e4a61f07"
down_revision: str | None = "96ca1cdc4d39"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _rename(old: str, new: str) -> None:
    op.rename_table(old, new)
    op.execute(f'ALTER TABLE {new} RENAME CONSTRAINT "{old}_pkey" TO "{new}_pkey"')
    op.execute(
        f'ALTER TABLE {new} RENAME CONSTRAINT "fk_{old}_user_id_user" '
        f'TO "fk_{new}_user_id_user"'
    )
    op.execute(f'ALTER INDEX "ix_{old}_user_id" RENAME TO "ix_{new}_user_id"')


def upgrade() -> None:
    _rename("tg_discover_ignored", "tg_dismissals")


def downgrade() -> None:
    _rename("tg_dismissals", "tg_discover_ignored")
