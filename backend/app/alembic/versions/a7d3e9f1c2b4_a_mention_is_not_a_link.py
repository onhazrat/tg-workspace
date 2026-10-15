"""Drop the link References that are only an @mention's anchor

Telegram renders every plain `@foo` as `<a href="https://t.me/foo">`, so the
extractor stored each mention twice, once as a `mention` and once as a `link`
with no Post id. The extractor no longer does (`discover.is_the_mention`); this
deletes the copies it already wrote, 2,077,201 of staging's 7,319,550
References on 2026-10-14, and takes them back out of each citation pair's
`reference_count`.

Only `reference_count` moves. Every deleted row's pair keeps the mention row
beside it, so no pair disappears and no Channel's `cited_by` or `cites` changes.

ADR-019 calls the graph permanent. That decision is about retention, and its
amendment says why removing rows the extractor should never have written is not
retention.

Both tables are locked `EXCLUSIVE` first. `prestart` runs while the previous
worker is still extracting, and its `_count_citations` updates pairs in sorted
key order while this statement updates them in whatever order the join yields:
without the lock the two can deadlock, and Postgres may abort the migration.
`EXCLUSIVE` makes the old worker wait and leaves reads alone.

The downgrade does nothing. The only way to recreate the rows is to extract
every Post again under the old rule, which is the defect this removes.

Revision ID: a7d3e9f1c2b4
Revises: e4c7a2b9d1f0
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7d3e9f1c2b4"
down_revision: str | None = "e4c7a2b9d1f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DROP_SHADOWS = sa.text(
    """
    WITH gone AS (
        DELETE FROM tg_post_references l
        WHERE l.kind = 'link' AND l.target_post_id IS NULL
          AND EXISTS (
              SELECT 1 FROM tg_post_references m
              WHERE m.kind = 'mention'
                AND m.source_chat_id = l.source_chat_id
                AND m.source_post_id = l.source_post_id
                AND m.target_handle = l.target_handle
          )
        RETURNING l.source_channel, l.target_handle
    ), per_pair AS (
        SELECT source_channel, target_handle, count(*) AS n
        FROM gone GROUP BY 1, 2
    )
    UPDATE tg_citation_pairs p
    SET reference_count = p.reference_count - per_pair.n
    FROM per_pair
    WHERE p.citing_handle = per_pair.source_channel
      AND p.cited_handle = per_pair.target_handle
    """
)


def drop_mention_shadows(bind: sa.Connection) -> None:
    bind.execute(
        sa.text("LOCK TABLE tg_post_references, tg_citation_pairs IN EXCLUSIVE MODE")
    )
    bind.execute(_DROP_SHADOWS)


def upgrade() -> None:
    drop_mention_shadows(op.get_bind())


def downgrade() -> None:
    # Irreversible by design; see the module docstring.
    pass
