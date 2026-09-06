"""Directory sample posts (ticket 02, IDEA-011 D16)

A Directory entry keeps a sample of the Channel's recent Posts, so an Operator
can judge what a Channel actually publishes before following it.

The table is modelled on `tg_posts` and deliberately is not it. A `tg_posts` row
belongs to a contiguous history the sync orchestrator tracks with anchors and
sync state; a sample is an unversioned snapshot of one preview page, replaced
wholesale on every conclusive probe. Sharing a table would force every feed,
search, summary, embedding, retention and stats query to grow an exclusion
predicate, and the first one that forgot would mix Channels nobody follows into
the corpus.

Dropped relative to `tg_posts`: the owner stamp (the Directory is corpus-wide),
the sync bookkeeping (which would invite sync logic to trust these rows), and
`updated_at` in favour of `captured_at`, because rows are replaced rather than
edited — and because that is the clock the sample retention window runs on.

Keyed by `(handle, post_id)` rather than a surrogate id: the snapshot is
replaced per handle and nothing else ever addresses one of these rows. The
foreign key cascades from `tg_channel_directory`, so a sample cannot outlive the
entry it describes.

Revision ID: f1a2b3c4d5e6
Revises: b1c2d3e4f5a6
Create Date: 2026-09-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "tg_channel_directory_samples"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("handle", sa.String(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("date", sa.String(), nullable=False, server_default=""),
        sa.Column(
            "timestamp", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("forwarded_from", sa.String(), nullable=True),
        sa.Column("forwarded_from_name", sa.String(), nullable=True),
        sa.Column("media", sa.JSON(), nullable=True),
        sa.Column("links", sa.JSON(), nullable=True),
        sa.Column("reply_to_post_id", sa.Integer(), nullable=True),
        sa.Column("reply_to", sa.JSON(), nullable=True),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["handle"],
            ["tg_channel_directory.handle"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("handle", "post_id"),
    )
    # The retention sweep's only predicate. Indexed because it runs hourly
    # forever over a table that grows with every handle the Directory learns.
    op.create_index(
        "ix_tg_channel_directory_samples_captured_at",
        _TABLE,
        ["captured_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_tg_channel_directory_samples_captured_at", table_name=_TABLE)
    op.drop_table(_TABLE)
