"""Saved metadata copies become row keys (SUMTAB review)

A row toggle, and the old panel's Save before it, stored a frozen copy of the
generated metadata in `metadataText`, which the scheduler then copied onto
every regenerated Summary: each scheduled Publication repeated the first
Summary's window, Channels and count. A Summary now saves the rows it leaves
out (`metadataOmittedRows`) and the metadata is generated afresh every time.

A saved text made only of the heading and generated rows, in order, is such a
copy, whatever values it froze: it becomes the keys of the rows it lacks and
`metadataText` is dropped. Any other text is somebody's own writing and stays
a custom override. A value edited by hand inside a generated row cannot be told
from a frozen one, and is regenerated with the rest.

The labels are frozen here rather than imported, so this revision keeps meaning
what it meant if the generator changes. Not reversible: the dropped copies held
stale values, which is the defect.

Revision ID: f3b8d1a6c925
Revises: e9a4c1b7d302
Create Date: 2026-10-11
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3b8d1a6c925"
down_revision: str | None = "e9a4c1b7d302"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_HEADING = "📊 *Analysis Metadata*"
_ROWS = (
    ("timeRange", "🕒 *Time Range:*"),
    ("channelsUsed", "📡 *Channels Used:*"),
    ("channelList", "📋 *Channel List:*"),
    ("aiModel", "🤖 *AI Model:*"),
    ("postsAnalyzed", "📝 *Posts Analyzed:*"),
)


def _kept_rows(text: str) -> list[str] | None:
    """The row keys `text` keeps, or None when it is not a generated copy."""
    heading, *lines = text.split("\n")
    if heading != _HEADING:
        return None
    kept: list[str] = []
    remaining = list(_ROWS)
    for line in lines:
        # An empty Channel list ends at the label, its space trimmed.
        while (
            remaining
            and line.rstrip() != remaining[0][1]
            and not line.startswith(remaining[0][1] + " ")
        ):
            remaining.pop(0)
        if not remaining:
            return None
        kept.append(remaining.pop(0)[0])
    return kept


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, extra FROM tg_summaries "
            "WHERE coalesce(extra::jsonb ->> 'metadataText', '') <> ''"
        )
    ).all()
    for row_id, extra in rows:
        value = extra if isinstance(extra, dict) else json.loads(extra)
        kept = _kept_rows(value["metadataText"])
        if kept is None:
            continue
        value.pop("metadataText")
        omitted = [key for key, _ in _ROWS if key not in kept]
        if omitted:
            value["metadataOmittedRows"] = omitted
        bind.execute(
            sa.text(
                "UPDATE tg_summaries SET extra = CAST(:extra AS json) WHERE id = :id"
            ),
            {"extra": json.dumps(value), "id": row_id},
        )


def downgrade() -> None:
    pass
