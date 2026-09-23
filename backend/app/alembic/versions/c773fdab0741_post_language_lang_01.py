"""A Post carries its Language (LANG-01, ADR-021).

Adds `tg_posts.language` and the partial index LANG-03's walk reads. The column
is nullable with no default, so adding it is a catalogue change and rewrites no
row; null means "not read yet", which is true of every Post that exists now.
This revision writes no Post rows: the walk reads them, newest first, because
an UPDATE over the whole corpus here would stall prestart for as long as it
took.

`ix_tg_posts_language_unread` matches every Post when it is created, so it is a
full build over the whole corpus. It is built CONCURRENTLY, outside the
migration's transaction, unlike `ix_tg_posts_references_pending` in CRG-01: on
`docker compose up -d` the old Sync worker keeps writing Posts until compose
recreates it, and a plain build's SHARE lock would hold every one of those
writes, sessions open, for as long as the build ran. `IF NOT EXISTS` makes a
re-run after an interrupted build safe to retry; an interrupted CONCURRENTLY
build leaves an INVALID index behind, which the downgrade drops.

**Hand-written**, because autogenerate cannot express a partial index with a
`DESC` key. The model declares it too, so autogenerate does not emit a drop.

Revision ID: c773fdab0741
Revises: 45653f10b97f
Create Date: 2026-09-23 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c773fdab0741"
down_revision = "45653f10b97f"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tg_posts", sa.Column("language", sa.String(), nullable=True))
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tg_posts_language_unread
            ON tg_posts (timestamp DESC)
            WHERE language IS NULL
            """
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_tg_posts_language_unread")
    op.drop_column("tg_posts", "language")
