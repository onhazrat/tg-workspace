"""A forward records which Post it came from (CRG-03).

Two nullable integer columns, one on `tg_posts` and its twin on
`tg_channel_directory_samples`, populated at scrape time out of the forward
attribution's href.

**There is no backfill, and there can never be one.** The scraper read that
href for its first path segment, kept the handle and discarded the rest, so the
Post id is not recoverable from any stored column — not from `forwarded_from`,
which is the handle alone, and not from `links`, which holds only the hrefs
found in the Post *body*. A link is luckier: its parser drops the id segment
too, but the raw href survives verbatim on `Post.links`, which is why CRG-01
could recover link target ids without touching the scraper. A forward's href
survives nowhere.

So every forward already in the corpus keeps a NULL here for ever, and CRG-04's
backfill will write those References with a NULL `target_post_id`. That is not
an oversight to go hunting for a source for; the source does not exist. Only
Posts scraped after this deploys gain the detail.

Nullable rather than defaulted for the same reason: NULL means "we never saw
the href", which is a different sentence from any number.
"""

import sqlalchemy as sa
from alembic import op

revision = "b7c1e5d39f04"
down_revision = "d1f0a7c93b62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_posts",
        sa.Column("forwarded_from_post_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "tg_channel_directory_samples",
        sa.Column("forwarded_from_post_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tg_channel_directory_samples", "forwarded_from_post_id")
    op.drop_column("tg_posts", "forwarded_from_post_id")
