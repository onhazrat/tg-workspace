"""Channel follows

Creates `tg_channel_follows`, the relation between a User and a Channel
(ticket 04, plan step A1). DDL only: the backfill that fills it is
`backend/scripts/backfill_channel_follows.py`, run deliberately by an operator,
because it needs a `--dry-run` and an audit alongside it and `prestart.sh` runs
`alembic upgrade head` unattended.

Creating an empty table is online-safe on a live database — no rewrite, no
scan, and nothing reads it until tickets 15-16.

The index on `channel_id` is not redundant with the primary key. The PK is
`(user_id, channel_id)`, so it serves "which channels does this user follow"
and cannot serve the other direction — "who follows this channel", which is what
retention and the scheduler ask.

Autogenerate also reported a dozen unrelated diffs on other tables: hand-written
partial and composite indexes the models do not declare, and a TEXT/VARCHAR
mismatch on `tg_summaries.prompt_excerpt`. Those are pre-existing drift between
the models and earlier migrations, not this ticket's business, and dropping
seven live indexes as a side effect of adding a table is how a migration becomes
an outage. They are deliberately not carried here.

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "c1d2e3f4a5b6"
down_revision = "b0c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tg_channel_follows",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "setting_group_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
        sa.Column("followed_at", sa.BigInteger(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("start_id", sa.Integer(), nullable=True),
        sa.Column("start_time", sa.BigInteger(), nullable=True),
        sa.Column("discovered_via", sa.JSON(), nullable=True),
        sa.Column("next_sync_at", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        # Both sides cascade. Deleting an account takes its follows with it;
        # deleting a Channel takes the follows of a row that is gone, which
        # would otherwise be a follow nobody can open.
        sa.ForeignKeyConstraint(["channel_id"], ["tg_channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "channel_id"),
    )
    op.create_index(
        op.f("ix_tg_channel_follows_channel_id"),
        "tg_channel_follows",
        ["channel_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_tg_channel_follows_channel_id"), table_name="tg_channel_follows"
    )
    op.drop_table("tg_channel_follows")
