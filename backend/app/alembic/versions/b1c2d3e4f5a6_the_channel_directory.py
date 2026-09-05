"""The Channel Directory (ticket 01, IDEA-011 D16)

`tg_discover_probes` becomes `tg_channel_directory`. The table was named for
the job that filled it, not for what it holds, and once it is the corpus-wide
map of every Channel anyone has seen referenced — followed or not — that name
misleads about its scope and its lifetime.

Renamed rather than created-and-copied: every existing verdict has to survive,
because the premise of the table is that a handle is probed once and the answer
cached. Re-probing a corpus of resolved handles to rebuild a table we already
had would be the most expensive possible way to rename something.

The five metadata columns are the ones `_parse_channel_meta` already extracts
and `record_probe_result` already discarded. They are spelled and typed exactly
as `tg_channels` spells them, so promoting an entry into a followed Channel
needs no translation.

The seed is an `INSERT ... SELECT` from `tg_channels`: every Channel somebody
follows is a Channel we know about, so the Directory should not launch pretending
otherwise. `ON CONFLICT DO NOTHING` because a followed handle may already have
been probed, and the probe's answer is the more recent of the two. Seeded rows
get `status='ok'` and `kind='channel'` — a Channel that has been synced is by
construction a public channel we can scrape, which is exactly what that verdict
asserts.

Revision ID: b1c2d3e4f5a6
Revises: a2b3c4d5e6f7
Create Date: 2026-09-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b1c2d3e4f5a6"
down_revision: str | None = "a2b3c4d5e6f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_TABLE = "tg_discover_probes"
_NEW_TABLE = "tg_channel_directory"

#: `(old, new)`. Postgres does not rename a table's indexes with it, so they
#: would keep the old name forever and the next person grepping for the table
#: would not find them. The primary key is in this list for the same reason and
#: renames the same way: its constraint is backed by an index, so `ALTER INDEX`
#: carries the constraint name along with it.
_INDEXES = (
    ("ix_tg_discover_probes_status", "ix_tg_channel_directory_status"),
    ("ix_tg_discover_probes_queue", "ix_tg_channel_directory_queue"),
    ("tg_discover_probes_pkey", "tg_channel_directory_pkey"),
)

_NEW_COLUMNS = ("photos", "videos", "files", "links")

#: Module-level rather than inline in `upgrade()` so the test can execute the
#: statement that actually deploys, instead of a copy of it that can drift.
#:
#: `latest_id` is deliberately left at 0 rather than taken from a Channel's sync
#: cursors: those describe a backward walk over stored history, not the newest
#: post on the preview page, and the two disagreeing would make a seeded entry
#: read as stale the moment it was written.
#: **`checked_at` and `attempted_at` are not decoration.** `probe_map` — the
#: read-time join every report goes through — filters on `attempted_at IS NOT
#: NULL`. A seeded row without them is stranded: `status='ok'` is conclusive, so
#: the queue skips it forever, while the join hides it, and the metadata this
#: whole statement exists to carry reaches no reader.
#:
#: **The `last_updated` filter is what makes the `ok` verdict true.** A
#: `tg_channels` row is not evidence that a handle can be scraped — one is
#: created when somebody follows a handle, including a restricted or frozen one,
#: which `create_followed_channel` files under the restricted setting group
#: rather than refusing. A Channel that has actually been synced is a different
#: claim, and it is the one `ok` makes. Channels without it are left out
#: entirely rather than seeded as `unknown`: they have no metadata worth copying
#: (their columns are NULL for the same reason), and omitting them leaves the
#: probe queue to answer for them exactly as it does today.
#:
#: **The handle must be normalized the way `normalize_handle` normalizes it** —
#: `lstrip("@").strip().lower()`, not just the lowercase half. A row keyed `@foo`
#: matches no lookup and would not dedupe against the real `foo` when probed.
SEED_FROM_CHANNELS_SQL = f"""
    INSERT INTO {_NEW_TABLE} (
        handle, status, kind, display_name, bio, subscribers,
        photos, videos, files, links, photo_url, telegram_chat_id,
        latest_id, attempts, priority, created_at, checked_at, attempted_at
    )
    SELECT
        lower(btrim(ltrim(btrim(c.name), '@'))), 'ok', 'channel',
        c.display_name, c.bio, c.subscribers,
        c.photos, c.videos, c.files, c.links, c.photo_url, c.telegram_chat_id,
        0, 0, 1000000, now(), now(), now()
    FROM tg_channels AS c
    WHERE c.name IS NOT NULL
      AND btrim(ltrim(btrim(c.name), '@')) <> ''
      AND c.last_updated IS NOT NULL
    ON CONFLICT (handle) DO NOTHING
"""


def upgrade() -> None:
    op.rename_table(_OLD_TABLE, _NEW_TABLE)
    for old, new in _INDEXES:
        op.execute(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}")

    for name in _NEW_COLUMNS:
        op.add_column(_NEW_TABLE, sa.Column(name, sa.String(), nullable=True))
    op.add_column(
        _NEW_TABLE, sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True)
    )

    op.execute(SEED_FROM_CHANNELS_SQL)


def downgrade() -> None:
    op.drop_column(_NEW_TABLE, "telegram_chat_id")
    for name in reversed(_NEW_COLUMNS):
        op.drop_column(_NEW_TABLE, name)
    for old, new in _INDEXES:
        op.execute(f"ALTER INDEX IF EXISTS {new} RENAME TO {old}")
    op.rename_table(_NEW_TABLE, _OLD_TABLE)
    # The seeded rows are deliberately left behind. They are indistinguishable
    # from rows a probe wrote, and dropping "everything that looks seeded" would
    # take real verdicts with it.
