"""The harvest marks the Post instead of walking a cursor (ticket 05)

`tg_posts.harvested` replaces both marks in the `directory_runtime` settings
row. The sweep becomes `WHERE NOT harvested ORDER BY timestamp DESC`, so a Post
a backward sync stored is reached by being unprocessed rather than by re-lapping
the corpus, and a row that commits after the walk has passed its position is
picked up on any later tick rather than skipped silently.

The column is added with a `false` server default, which is metadata-only on
PostgreSQL 11+ — no rewrite of 4.7M rows. Every existing Post therefore starts
unharvested and the corpus is walked once from scratch. That is deliberate:
seeding the flag from the old `harvestTail` would mean deriving it from a
`Post.timestamp` mark, and the Posts it would get wrong are exactly the
backward-synced ones the sweep exists to reach.

`ix_tg_posts_unharvested` is partial. It covers only the rows still to do, so it
starts corpus-sized and shrinks toward empty for the life of the install — the
opposite of an ordering index a cursor design has to carry forever to serve a
query that reads nothing. `timestamp DESC` because the sweep takes the newest
unharvested Post first, which is how a new reference reaches the Directory on
the next tick with no second leg to arrange it.

`ix_tg_posts_timestamp` from ticket 04 is **kept**. `jobs/retention.py` scans it
with no channel equality, so it has a reader that is not the harvest.

The index is built with an ordinary `CREATE INDEX`. `prestart.sh` runs
migrations before the app boots, so nothing is serving and nothing is syncing
while the lock is held; `CONCURRENTLY` would buy a guarantee that is already
free and cost a non-transactional migration that can leave an `INVALID` index
behind on failure.

The `directory_runtime` settings row is deleted because nothing reads it any
more and `settings_registry.classify` raises `KeyError` for a key nobody
classified — an orphan row would be a live fault waiting for whoever next
enumerates stored settings.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: str | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UNHARVESTED_INDEX = "ix_tg_posts_unharvested"


def upgrade() -> None:
    op.add_column(
        "tg_posts",
        sa.Column(
            "harvested", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_index(
        _UNHARVESTED_INDEX,
        "tg_posts",
        [sa.text("timestamp DESC")],
        postgresql_where=sa.text("NOT harvested"),
    )
    op.execute("DELETE FROM tg_app_settings WHERE key = 'directory_runtime'")


def downgrade() -> None:
    op.drop_index(_UNHARVESTED_INDEX, table_name="tg_posts")
    op.drop_column("tg_posts", "harvested")
