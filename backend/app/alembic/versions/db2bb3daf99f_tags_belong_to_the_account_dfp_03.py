"""Tags belong to the Account, not the Follow (ADR-029, DFP-03)

A Tag was a JSON list on `tg_channel_follows`, so unfollowing deleted it. This
creates `tg_tags`, one row per Account, normalized handle and lowercased Tag
name, moves every Follow's Tags into it and drops the Follow's column.

The move reads the JSON the way `channel_tags.normalize_channel_tags` does: a
bare string is a manual Tag assigned at 0, a name is trimmed and a blank one
skipped, `source` is `ai` or `manual`, a missing or negative `assignedAt` is 0.
`group:` names are reserved and derived, so none is carried. The rules are
written out here rather than imported, so this revision keeps meaning what it
meant if the helper changes.

Case-duplicates merge into one row, keeping the earliest assigned, which is
the name as first written; on a tie the first in the list wins. They meet
within one legacy Follow, or across two Follows of one handle (two Channel ids
differing only by case).

Revision ID: db2bb3daf99f
Revises: f3b8d1a6c925
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "db2bb3daf99f"
down_revision: str | None = "f3b8d1a6c925"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Python's `str.strip()` set, for the trims `normalize_handle` and
#: `normalize_channel_tags` do.
_WS = r"E' \t\n\r\f\v'"

#: Every Follow's Tags into `tg_tags`. Run by the guard as well as `upgrade`.
MOVE_TAGS_SQL = f"""
INSERT INTO tg_tags (user_id, handle, tag_key, name, source, assigned_at)
SELECT DISTINCT ON (user_id, handle, tag_key)
       user_id, handle, tag_key, name, source, assigned_at
FROM (
    SELECT f.user_id,
           lower(btrim(ltrim(btrim(c.name, {_WS}), '@'), {_WS})) AS handle,
           lower(t.name) AS tag_key,
           t.name, t.source, t.assigned_at, f.channel_id, t.ord
    FROM tg_channel_follows AS f
    JOIN tg_channels AS c ON c.id = f.channel_id
    CROSS JOIN LATERAL (
        SELECT btrim(
                   CASE jsonb_typeof(e)
                       WHEN 'string' THEN e #>> '{{}}'
                       WHEN 'object' THEN
                           CASE WHEN jsonb_typeof(e -> 'name') = 'string'
                                THEN e ->> 'name' END
                   END,
                   {_WS}
               ) AS name,
               CASE WHEN jsonb_typeof(e) = 'object' AND e ->> 'source' = 'ai'
                    THEN 'ai' ELSE 'manual' END AS source,
               CASE WHEN jsonb_typeof(e) = 'object'
                         AND jsonb_typeof(e -> 'assignedAt') = 'number'
                         AND (e ->> 'assignedAt')::numeric >= 0
                    THEN trunc((e ->> 'assignedAt')::numeric)::bigint
                    ELSE 0 END AS assigned_at,
               ord
        FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(f.tags::jsonb) = 'array'
                      THEN f.tags::jsonb ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS x(e, ord)
    ) AS t
    WHERE t.name IS NOT NULL AND t.name <> ''
      AND lower(t.name) NOT LIKE 'group:%'
) AS moved
WHERE handle <> ''
ORDER BY user_id, handle, tag_key, assigned_at, channel_id, ord
ON CONFLICT DO NOTHING
"""


def upgrade() -> None:
    op.create_table(
        "tg_tags",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("handle", sa.String(), nullable=False),
        sa.Column("tag_key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("assigned_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "handle", "tag_key"),
    )
    op.execute(MOVE_TAGS_SQL)
    op.drop_column("tg_channel_follows", "tags")


def downgrade() -> None:
    """Put each Follow's Tags back on it; Tags on unfollowed Channels are lost.

    The older schema has nowhere to keep a Tag without a Follow.
    """
    op.add_column(
        "tg_channel_follows",
        sa.Column("tags", sa.JSON(), nullable=True, server_default="[]"),
    )
    op.execute(
        f"""
        UPDATE tg_channel_follows AS f
        SET tags = moved.tags
        FROM (
            SELECT f2.user_id, f2.channel_id,
                   json_agg(json_build_object(
                       'name', t.name, 'source', t.source,
                       'assignedAt', t.assigned_at
                   ) ORDER BY t.assigned_at, t.tag_key) AS tags
            FROM tg_channel_follows AS f2
            JOIN tg_channels AS c ON c.id = f2.channel_id
            JOIN tg_tags AS t ON t.user_id = f2.user_id
             AND t.handle = lower(btrim(ltrim(btrim(c.name, {_WS}), '@'), {_WS}))
            GROUP BY f2.user_id, f2.channel_id
        ) AS moved
        WHERE f.user_id = moved.user_id AND f.channel_id = moved.channel_id
        """
    )
    op.drop_table("tg_tags")
