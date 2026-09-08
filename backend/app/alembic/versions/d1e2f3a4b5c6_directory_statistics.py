"""Directory statistics from sample Posts (ticket 02, ADR-015)

Six nullable columns on `tg_channel_directory`, written at probe time by the
aggregate that already writes the samples. ADR-015 argues why they are stored
rather than derived on read; the short version is that the entries which lose
their samples are exactly the ones that can never recompute them.

Not a companion table. The list-vs-detail rule exists to keep large detoastable
fields out of list reads, and these are four small numbers, a short string and a
timestamp that the list read specifically needs — a companion table would add a
join to the one query that has to stay cheap.

`sample_count` is a smallint because a probe reads one preview page, which is
twenty Posts.

## The backfill, and the one column it leaves alone

Every entry that already holds samples gets its statistics computed here, in one
statement, so the feature does not ship looking empty. The arithmetic is
restated in SQL rather than driven from `services/directory_statistics.py`: an
applied revision has to keep meaning what it meant, and importing a module that
is free to change would quietly rewrite what this migration did.

**`script` is deliberately not backfilled.** It is a per-character tally over
captions, which is a page of SQL to say badly, and it is the one statistic this
ticket puts on no row and in no sort. Every entry that has samples is `ok` and
therefore refreshable, so all of them re-probe inside `directoryRefreshDays` — a
week by default — and fill it in properly. A backfill is a bridge over that
week, and this column does not need one.

The numeric backfill is worth having for the same reason it is only a bridge:
last post age and cadence are what the Operator scans, and a week of blank rows
is a week of the feature looking broken.

The thresholds are `directory_statistics.MIN_SAMPLES`, five, restated as a
literal here for the reason above.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_WEEK_MS = 7 * 24 * 60 * 60 * 1000

#: One pass over the samples table, grouped by handle.
#:
#: `(n - 1) / span` and not `n / span`: N Posts give N-1 intervals, and dividing
#: by Posts reports every Channel busier than it is. A zero span is reachable
#: above the threshold — an album posted as several messages in one second — so
#: it yields NULL rather than a division by zero.
#:
#: The median's threshold counts rows that actually **carry** a view count,
#: separately from the sample count gating the other rates: Telegram stops
#: rendering a counter on older Posts, so twenty samples can carry one measured
#: view between them, and gating on the sample count would let that single
#: observation become a median.
_BACKFILL = f"""
UPDATE tg_channel_directory AS d
SET last_post_at  = s.last_post_at,
    sample_count  = s.n,
    posts_per_week = s.posts_per_week,
    median_views  = s.median_views,
    forward_share = s.forward_share
FROM (
    SELECT
        handle,
        count(*) AS n,
        to_timestamp(max(timestamp) / 1000.0) AT TIME ZONE 'UTC' AS last_post_at,
        CASE
            WHEN count(*) >= 5 AND max(timestamp) > min(timestamp)
            THEN (count(*) - 1)
                 / ((max(timestamp) - min(timestamp))::float / {_WEEK_MS})
        END AS posts_per_week,
        CASE
            WHEN count(*) FILTER (WHERE media ->> 'viewsCount' IS NOT NULL) >= 5
            THEN round(
                percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY (media ->> 'viewsCount')::float
                ) FILTER (WHERE media ->> 'viewsCount' IS NOT NULL)
            )
        END AS median_views,
        CASE
            WHEN count(*) >= 5
            THEN count(*) FILTER (WHERE forwarded_from IS NOT NULL)::float
                 / count(*)
        END AS forward_share
    FROM tg_channel_directory_samples
    GROUP BY handle
) AS s
WHERE d.handle = s.handle
"""


def upgrade() -> None:
    op.add_column(
        "tg_channel_directory",
        sa.Column("last_post_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "tg_channel_directory",
        sa.Column("sample_count", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "tg_channel_directory",
        sa.Column("posts_per_week", sa.Float(), nullable=True),
    )
    op.add_column(
        "tg_channel_directory",
        sa.Column("median_views", sa.Integer(), nullable=True),
    )
    op.add_column(
        "tg_channel_directory",
        sa.Column("forward_share", sa.Float(), nullable=True),
    )
    op.add_column(
        "tg_channel_directory",
        sa.Column("script", sa.String(), nullable=True),
    )
    op.execute(_BACKFILL)


def downgrade() -> None:
    for name in (
        "script",
        "forward_share",
        "median_views",
        "posts_per_week",
        "sample_count",
        "last_post_at",
    ):
        op.drop_column("tg_channel_directory", name)
