"""The channel reference graph: tg_post_references (CRG-01, ADR-019).

Adds the table, the Post flag that drives its walk, and the epoch the chat-id
grace counts from. **No bulk update.** Migrations run at prestart with the
service down, and an UPDATE across roughly 4.7 million Posts there stalls a
deploy for an unknown number of minutes with nothing reporting progress. The
flag's server default of false is what makes every existing Post pending
without one, and CRG-04's script is what works through the backlog at speed.

`ix_tg_posts_references_pending` is the one cost this revision does not avoid.
Its predicate matches every Post at the moment it is created, so it is a full
build under a SHARE lock at prestart — far cheaper than the UPDATE above, and
the same *kind* of unreported stall, which is worth saying plainly rather than
leaving the paragraph above to imply otherwise. It is accepted here because the
index is written once and shrinks toward empty as CRG-04 works through the
backlog; a deployment large enough to feel it should build it CONCURRENTLY out
of band and stamp this revision.

Two things autogenerate cannot express and which are therefore written by hand:
the uniqueness constraint's `NULLS NOT DISTINCT`, and the partial index. Both
are declared in the model as well, because autogenerate reads metadata rather
than intent and emits a drop for an index it cannot see.

`NULLS NOT DISTINCT` is not tidiness. `target_post_id` is NULL for every
mention and for every forward scraped before CRG-03, and under Postgres's
default null semantics those rows never collide — so a plain UNIQUE would dedup
the minority of the table and duplicate the majority on every re-run of the
backfill. Postgres 15 or newer is required; the deployment runs 18.

The epoch row is written here rather than derived at read time so that every
Post already in the corpus gets a full grace window measured from this
instant. Without it the window would expire the moment this applied, for
exactly the Posts it exists to protect.
"""

import json
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "d1f0a7c93b62"
down_revision = "c9e4a8b71d25"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_post_references",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_chat_id", sa.BigInteger(), nullable=False),
        sa.Column("source_channel", sa.String(), nullable=False),
        sa.Column("source_post_id", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("target_handle", sa.String(), nullable=False),
        sa.Column("target_chat_id", sa.BigInteger(), nullable=True),
        sa.Column("target_post_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_tg_post_references_source_channel",
        "tg_post_references",
        ["source_channel"],
    )
    op.create_index(
        "ix_tg_post_references_target",
        "tg_post_references",
        ["target_handle"],
    )
    op.execute(
        """
        ALTER TABLE tg_post_references
        ADD CONSTRAINT uq_tg_post_references_occurrence
        UNIQUE NULLS NOT DISTINCT
        (source_chat_id, source_post_id, target_handle, kind, target_post_id)
        """
    )

    op.add_column(
        "tg_posts",
        sa.Column(
            "references_extracted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.execute(
        """
        CREATE INDEX ix_tg_posts_references_pending
        ON tg_posts (timestamp DESC)
        WHERE NOT references_extracted
        """
    )

    epoch_ms = int(datetime.now(UTC).timestamp() * 1000)
    op.execute(
        sa.text(
            """
            INSERT INTO tg_app_settings (key, value, updated_at)
            VALUES ('reference_graph', CAST(:value AS json), NOW())
            ON CONFLICT (key) DO NOTHING
            """
        ).bindparams(value=json.dumps({"epochMs": epoch_ms}))
    )


def downgrade() -> None:
    op.execute("DELETE FROM tg_app_settings WHERE key = 'reference_graph'")
    op.execute("DROP INDEX IF EXISTS ix_tg_posts_references_pending")
    op.drop_column("tg_posts", "references_extracted")
    op.drop_index("ix_tg_post_references_target", table_name="tg_post_references")
    op.drop_index(
        "ix_tg_post_references_source_channel", table_name="tg_post_references"
    )
    op.drop_table("tg_post_references")
