"""Index tg_channels.name for the reference graph correlations (CRG-04).

`post_references._eligible` and `_deferring_channels` both correlate a scalar
subquery on `tg_channels.name = tg_posts.channel_name`, once per candidate
Post. The column had no index, so each of those probes was a sequential scan
of `tg_channels`. The sweep's scan limit bounds how often that happens per
tick; CRG-04's dry run counts the whole pending corpus and bounds nothing.

Not unique, deliberately. `channels.py` carries a detector for two rows
sharing a name because it happens, and both callers above answer `= 1` rather
than picking one, so a unique index here would refuse rows the application is
built to tolerate.

**Hand-written.** Autogenerate against a live database emitted this index plus
drops for nine existing ones it cannot see in the metadata — the partial
unique index on `telegram_chat_id`, the setting-group `COALESCE` index, the
`DESC` list indexes — which is the failure mode `CLAUDE.md` names. Only the
`CREATE INDEX` below was intended.

Revision ID: 45653f10b97f
Revises: b7c1e5d39f04
Create Date: 2026-09-22 01:14:45.922320

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "45653f10b97f"
down_revision = "b7c1e5d39f04"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_tg_channels_name", "tg_channels", ["name"], unique=False)


def downgrade():
    op.drop_index("ix_tg_channels_name", table_name="tg_channels")
