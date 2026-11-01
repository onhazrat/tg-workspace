"""Walked ranges replace confirmed gaps; each Channel stores its pace (WR-01, ADR-044)

Revision ID: a4d8e2c6f019
Revises: e7a3c9b5d124
Create Date: 2026-11-01 18:00:00

Ranges are built from the Posts already held. Two consecutive held Posts of a
Channel share a range when no id lies between them, when one sync job stored
both (a walk's pages are contiguous), or when every id between them is a
confirmed gap. Anything else stays a Hole for a sync to repair: on staging
that left 307 junctions between jobs, none over 10 ids. The range holding a
Channel's newest Post takes its head-read moment, and its lowest range the
claim to its first Post.

The confirmed-gap table is dropped. The downgrade recreates it empty: the
gaps it held are not recoverable from ranges, and the check reads none.

"""

import sqlalchemy as sa
from alembic import op

revision = "a4d8e2c6f019"
down_revision = "e7a3c9b5d124"
branch_labels = None
depends_on = None

#: Run by the test against seeded rows, so the test reads what deploy runs.
#: The `CASE` fixes the order, so the gap count runs only at a junction.
BUILD_RANGES_SQL = """
INSERT INTO tg_walked_ranges
    (id, channel_name, lo_id, hi_id, lo_ts, hi_ts, reached_start, updated_at)
SELECT gen_random_uuid(), channel_name, min(post_id), max(post_id),
       min(timestamp), max(timestamp), false, now() AT TIME ZONE 'utc'
FROM (
    SELECT channel_name, post_id, timestamp,
           sum(CASE WHEN joins THEN 0 ELSE 1 END)
               OVER (PARTITION BY channel_name ORDER BY post_id) AS run
    FROM (
        SELECT s.channel_name, s.post_id, s.timestamp,
               CASE
                   WHEN s.prev_id IS NULL THEN false
                   WHEN s.post_id = s.prev_id + 1 THEN true
                   WHEN s.job IS NOT NULL AND s.job = s.prev_job THEN true
                   ELSE (
                       SELECT count(*) FROM tg_post_sync_state g
                       WHERE g.channel_name = s.channel_name
                         AND g.post_id > s.prev_id AND g.post_id < s.post_id
                   ) = s.post_id - s.prev_id - 1
               END AS joins
        FROM (
            SELECT channel_name, post_id, timestamp,
                   retrieval_job_id AS job,
                   lag(post_id) OVER w AS prev_id,
                   lag(retrieval_job_id) OVER w AS prev_job
            FROM tg_posts
            WINDOW w AS (PARTITION BY channel_name ORDER BY post_id)
        ) s
    ) j
) r
GROUP BY channel_name, run
"""

TOP_READ_SQL = """
UPDATE tg_walked_ranges r SET top_read_at = c.head_read_at
FROM tg_channels c
WHERE c.name = r.channel_name AND c.head_read_at IS NOT NULL
  AND r.hi_id = (
      SELECT max(x.hi_id) FROM tg_walked_ranges x
      WHERE x.channel_name = r.channel_name
  )
"""

REACHED_START_SQL = """
UPDATE tg_walked_ranges r SET reached_start = true
FROM tg_channels c
WHERE c.name = r.channel_name AND c.history_reached_channel_start
  AND r.lo_id = (
      SELECT min(x.lo_id) FROM tg_walked_ranges x
      WHERE x.channel_name = r.channel_name
  )
"""

#: Posts an hour over the week before the head read, no earlier than the first
#: Post; under an hour of history is no pace. The sync adds the scrape cutoff,
#: which is per Account and has no place in a migration.
PACE_SQL = """
UPDATE tg_channels c SET pace_per_hour = w.posts * 3600000.0 / w.span
FROM (
    SELECT c2.id, c2.head_read_at - s.since AS span,
           (SELECT count(*) FROM tg_posts p
            WHERE p.channel_name = c2.name
              AND p.timestamp BETWEEN s.since AND c2.head_read_at) AS posts
    FROM tg_channels c2
    CROSS JOIN LATERAL (
        SELECT greatest(
            c2.head_read_at - 604800000,
            coalesce(
                (SELECT min(p.timestamp) FROM tg_posts p
                 WHERE p.channel_name = c2.name),
                c2.head_read_at
            )
        ) AS since
    ) s
    WHERE c2.head_read_at IS NOT NULL
) w
WHERE c.id = w.id AND w.span >= 3600000
"""


def upgrade() -> None:
    op.create_table(
        "tg_walked_ranges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_name", sa.String(), nullable=False),
        sa.Column("lo_id", sa.Integer(), nullable=False),
        sa.Column("hi_id", sa.Integer(), nullable=False),
        sa.Column("lo_ts", sa.BigInteger(), nullable=False),
        sa.Column("hi_ts", sa.BigInteger(), nullable=False),
        sa.Column("top_read_at", sa.BigInteger(), nullable=True),
        sa.Column("reached_start", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_tg_walked_ranges_channel_lo",
        "tg_walked_ranges",
        ["channel_name", "lo_id"],
    )
    # A parallel sort over every Post overflows a 64 MB /dev/shm.
    op.execute(sa.text("SET LOCAL max_parallel_workers_per_gather = 0"))
    for sql in (BUILD_RANGES_SQL, TOP_READ_SQL, REACHED_START_SQL):
        op.execute(sa.text(sql))
    # Last: adding the column locks every Channel until the commit, and the
    # build above took a minute on staging.
    op.add_column("tg_channels", sa.Column("pace_per_hour", sa.Float()))
    op.execute(sa.text(PACE_SQL))

    op.drop_index("ix_tg_post_sync_state_channel_name", table_name="tg_post_sync_state")
    op.drop_table("tg_post_sync_state")


def downgrade() -> None:
    op.create_table(
        "tg_post_sync_state",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_name", sa.String(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("confirmed_at", sa.BigInteger(), nullable=False),
        sa.Column("confirmed_job_id", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_name", "post_id"),
    )
    op.create_index(
        "ix_tg_post_sync_state_channel_name", "tg_post_sync_state", ["channel_name"]
    )
    op.drop_column("tg_channels", "pace_per_hour")
    op.drop_index("ix_tg_walked_ranges_channel_lo", table_name="tg_walked_ranges")
    op.drop_table("tg_walked_ranges")
