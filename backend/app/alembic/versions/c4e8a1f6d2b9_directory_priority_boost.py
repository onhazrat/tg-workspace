"""The Priority boost, and the queue ordered by effective priority (DPF)

`priority_boost` is an Operator's standing adjustment to how soon an entry is
fetched. It is its own column because every fetch rewrites `priority`, so a
boost folded into it would be erased by the next probe. Zero for every
existing row, so the upgrade changes no fetch order.

`effective_priority` is `priority - priority_boost`, stored and generated, so
the dequeue's ORDER BY has an index to read. The `(status, priority)` index it
replaces served exactly that ORDER BY and nothing else.

The stored Directory column defaults name two renamed columns, `last_post_days`
and `found_days`, which are `last_post_at` and `created_at` now that every
moment is named by its column. They are rewritten here so the Operator's choice
survives the rename.

Revision ID: c4e8a1f6d2b9
Revises: b7d2e9f4a1c6
Create Date: 2026-10-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4e8a1f6d2b9"
down_revision: str | None = "b7d2e9f4a1c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "tg_channel_directory"
_OLD_INDEX = "ix_tg_channel_directory_queue"
_NEW_INDEX = "ix_tg_channel_directory_effective_queue"

#: Frozen, as an applied revision must keep meaning what it meant.
_RENAMES = (("last_post_days", "last_post_at"), ("found_days", "created_at"))


def _rename_defaults(pairs: Sequence[tuple[str, str]]) -> None:
    # `value` is `json`, not `jsonb`, so the list is rewritten as text. Each
    # key appears quoted exactly once in `{"on": [...]}`.
    for old, new in pairs:
        op.execute(
            sa.text(
                "UPDATE tg_app_settings SET value = "
                "replace(value::text, :old, :new)::json WHERE key = 'directory_columns'"
            ).bindparams(old=f'"{old}"', new=f'"{new}"')
        )


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column("priority_boost", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        _TABLE,
        sa.Column(
            "effective_priority",
            sa.Integer(),
            sa.Computed("priority - priority_boost", persisted=True),
            nullable=False,
        ),
    )
    op.drop_index(_OLD_INDEX, table_name=_TABLE)
    op.create_index(_NEW_INDEX, _TABLE, ["status", "effective_priority"])
    _rename_defaults(_RENAMES)


def downgrade() -> None:
    _rename_defaults([(new, old) for old, new in _RENAMES])
    op.drop_index(_NEW_INDEX, table_name=_TABLE)
    op.create_index(_OLD_INDEX, _TABLE, ["status", "priority"])
    op.drop_column(_TABLE, "effective_priority")
    op.drop_column(_TABLE, "priority_boost")
