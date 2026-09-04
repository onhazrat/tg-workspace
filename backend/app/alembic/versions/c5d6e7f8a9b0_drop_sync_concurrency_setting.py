"""Strip the stored `syncConcurrency` key (ticket 36, ADR-012)

The setting is gone from the code: the scraping Partition's width derives from
the proxy fleet, and an operator's second number could only disagree with it.
Its own UI copy asked them to keep it at or below proxy capacity, which is an
invariant `min()` was already enforcing on their behalf.

The stored value has to go too. `tg_app_settings` holds one JSON blob under the
key `sync`, and `load_sync_settings` merges it over the code's defaults — so a
leftover field would keep being read back and served to the browser as a
setting that changes nothing. `_split_payload` drops unclassified fields on the
way *in*, which is why nothing raises, and is exactly why this would have sat
there unnoticed.

The downgrade does not put a value back. It cannot know what the deployment had
— and it does not matter: nothing reads the key on either side of this
revision, so restoring a number would be restoring a decoration.

Revision ID: c5d6e7f8a9b0
Revises: f5a6b7c8d9e0
Create Date: 2026-09-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c5d6e7f8a9b0"
down_revision: str | None = "f5a6b7c8d9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # `- 'syncConcurrency'` is jsonb's key-delete, so the column is cast in and
    # back rather than read into Python and rewritten. One statement, and it
    # touches nothing else in the blob — the scheduler's own counters live in a
    # different row since ticket 06, but the other sync *policy* fields are
    # right here beside it.
    op.execute(
        """
        UPDATE tg_app_settings
        SET value = (value::jsonb - 'syncConcurrency')::json
        WHERE key = 'sync' AND value::jsonb ? 'syncConcurrency'
        """
    )


def downgrade() -> None:
    """Nothing to restore. See the module docstring."""
