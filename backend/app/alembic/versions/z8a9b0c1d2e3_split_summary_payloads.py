"""move citedPosts/promptText/chatMessages into tg_summary_payloads

``GET /data/summaries`` took **2.69 s to return 49 rows**. The three
corpus-sized fields lived in ``tg_summaries.extra``, and TOAST is
all-or-nothing per value: reading *any* key of ``extra`` detoasted the whole
thing, so one page pulled 26 MB compressed (48 MB of it ``promptText``) to ship
1.15 MB. Every tab paid it, because the contexts that fetch summaries are
always mounted.

Pushing the projection into SQL was measured and rejected —
``extra::jsonb - 'citedPosts' - 'promptText' - 'chatMessages'`` still costs
2.86 s and 11,028 buffers, because the detoast and the parse happen either way.
Selecting the same columns without ``extra`` costs 0.07 s and 7 buffers. The
fields have to leave the column.

They leave for a table rather than a sibling column so the fast path is
fail-closed: ``select(Summary)`` cannot accidentally read what is not in its
FROM clause, where a forgotten ``defer()`` would silently restore the 2.69 s.

``chat_message_count`` and ``prompt_excerpt`` become real columns on
``tg_summaries``. They are the only parts of the heavy fields the list surfaces
ever rendered, and as columns the list projection needs nothing from the new
table at all.

Unlike ``y7z8a9b0c1d2_split_sync_log_payloads`` — whose bodies were disposable
telemetry, deliberately not copied — this is user content. The upgrade copies
it across and the downgrade merges it back, so the split is reversible in both
directions.

Two derived keys (``chatMessageCount``, ``promptExcerpt``) are also stripped
from ``extra``. Clients round-trip list items back through ``PUT``, which had
been persisting the server's own derived values; they are recomputed on every
write now, and a stored copy could only ever go stale.

Revision ID: z8a9b0c1d2e3
Revises: y7z8a9b0c1d2
Create Date: 2026-08-19
"""

from typing import Any

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "z8a9b0c1d2e3"
down_revision = "y7z8a9b0c1d2"
branch_labels = None
depends_on = None

# Duplicated from app.services.summaries rather than imported: a migration is a
# snapshot, and importing app code would let a later refactor change what an
# old revision does. Keep in step with SUMMARY_PROMPT_EXCERPT_CHARS.
_EXCERPT_CHARS = 80

# Rows per excerpt batch, and how much of each prompt is fetched to build one.
# The head is bounded because the whole problem here is that these values are
# large; 400 characters of already-collapsed text is a wide margin over the 80
# the excerpt keeps.
_BATCH = 500
_PROMPT_HEAD_CHARS = 400

_HEAVY_KEYS = ("citedPosts", "promptText", "chatMessages")
_DERIVED_KEYS = ("chatMessageCount", "promptExcerpt")


def _excerpt(prompt_head: str | None, *, is_empty: bool) -> str | None:
    """Mirror of `app.services.summaries._derive_prompt_excerpt`.

    Postgres has already collapsed ASCII whitespace runs in `prompt_head`;
    `str.split()` is idempotent over that and additionally folds the Unicode
    whitespace `\\s` does not match, so the result equals what the service
    would compute from the full text.

    `is_empty` carries the one distinction the collapsed head loses. The
    service returns `None` for an empty prompt but `""` for a whitespace-only
    one, and those are different on the wire — absent key versus present and
    empty. Both arrive here as `""`.
    """
    if is_empty:
        return None
    collapsed = " ".join((prompt_head or "").split())
    if len(collapsed) <= _EXCERPT_CHARS:
        return collapsed
    return collapsed[: _EXCERPT_CHARS - 1] + "…"


def upgrade() -> None:
    op.create_table(
        "tg_summary_payloads",
        sa.Column("summary_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("cited_posts", sa.JSON(), nullable=True),
        sa.Column("prompt_text", sa.Text(), nullable=True),
        sa.Column("chat_messages", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("summary_id"),
    )
    op.create_index(
        op.f("ix_tg_summary_payloads_user_id"),
        "tg_summary_payloads",
        ["user_id"],
        unique=False,
    )

    op.add_column(
        "tg_summaries",
        sa.Column(
            "chat_message_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column("tg_summaries", sa.Column("prompt_excerpt", sa.Text(), nullable=True))

    bind = op.get_bind()
    _copy_payloads_out(bind)
    _backfill_derived_columns(bind)
    _strip_extra(bind)

    # The default existed only so the column could be added NOT NULL.
    op.alter_column("tg_summaries", "chat_message_count", server_default=None)


def _copy_payloads_out(bind: Any) -> None:
    """One server-side INSERT … SELECT — the values are never pulled into Python.

    A summary with none of the three fields gets no payload row, matching the
    "no empty rows" rule `app.services.summaries.apply_summary_payload` keeps.
    """
    bind.execute(
        sa.text(
            """
            INSERT INTO tg_summary_payloads
                (summary_id, user_id, cited_posts, prompt_text, chat_messages,
                 updated_at)
            SELECT id,
                   user_id,
                   (extra::jsonb -> 'citedPosts')::json,
                   extra::jsonb ->> 'promptText',
                   (extra::jsonb -> 'chatMessages')::json,
                   now()
            FROM tg_summaries
            WHERE jsonb_typeof(extra::jsonb) = 'object'
              AND extra::jsonb ?| :heavy
            ON CONFLICT (summary_id) DO NOTHING
            """
        ),
        {"heavy": list(_HEAVY_KEYS)},
    )


def _backfill_derived_columns(bind: Any) -> None:
    """`chat_message_count` in SQL, `prompt_excerpt` in batched Python.

    The count is a `jsonb_array_length`. The excerpt is not expressible in SQL
    that provably matches the service's `" ".join(text.split())`, so it is
    computed by the same code path over a bounded head of each prompt.
    """
    bind.execute(
        sa.text(
            """
            UPDATE tg_summaries s
            SET chat_message_count = COALESCE(
                (SELECT jsonb_array_length(p.chat_messages::jsonb)
                 FROM tg_summary_payloads p
                 WHERE p.summary_id = s.id
                   AND jsonb_typeof(p.chat_messages::jsonb) = 'array'),
                0)
            """
        )
    )

    last_id = ""
    while True:
        rows = (
            bind.execute(
                sa.text(
                    """
                    SELECT summary_id,
                           prompt_text = '' AS is_empty,
                           left(btrim(regexp_replace(prompt_text, '\\s+', ' ', 'g')),
                                :head) AS prompt_head
                    FROM tg_summary_payloads
                    WHERE summary_id > :last_id AND prompt_text IS NOT NULL
                    ORDER BY summary_id
                    LIMIT :batch
                    """
                ),
                {"last_id": last_id, "head": _PROMPT_HEAD_CHARS, "batch": _BATCH},
            )
            .mappings()
            .all()
        )
        if not rows:
            return
        for row in rows:
            bind.execute(
                sa.text(
                    "UPDATE tg_summaries SET prompt_excerpt = :excerpt WHERE id = :id"
                ),
                {
                    "id": row["summary_id"],
                    "excerpt": _excerpt(row["prompt_head"], is_empty=row["is_empty"]),
                },
            )
        last_id = rows[-1]["summary_id"]


def _strip_extra(bind: Any) -> None:
    """Remove the moved keys — this is the step that reclaims the read cost.

    The freed TOAST space returns to the table's freelist rather than the OS
    (see `y7z8a9b0c1d2`), which is fine: the goal here is that a list query
    stops *reading* it, not that the disk shrinks.
    """
    removals = " ".join(f"- '{key}'" for key in (*_HEAVY_KEYS, *_DERIVED_KEYS))
    bind.execute(
        sa.text(
            f"""
            UPDATE tg_summaries
            SET extra = (extra::jsonb {removals})::json
            WHERE jsonb_typeof(extra::jsonb) = 'object'
              AND extra::jsonb ?| :keys
            """
        ),
        {"keys": [*_HEAVY_KEYS, *_DERIVED_KEYS]},
    )


def downgrade() -> None:
    """Merge the payloads back into `extra` before dropping the table.

    Lossless for the three moved fields. The two derived keys are not restored:
    they were never authored, and the pre-split code recomputed them on read
    anyway.
    """
    op.get_bind().execute(
        sa.text(
            """
            UPDATE tg_summaries s
            SET extra = (
                COALESCE(s.extra::jsonb, '{}'::jsonb)
                || CASE WHEN p.cited_posts IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object('citedPosts', p.cited_posts::jsonb)
                   END
                || CASE WHEN p.prompt_text IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object('promptText', p.prompt_text)
                   END
                || CASE WHEN p.chat_messages IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object('chatMessages', p.chat_messages::jsonb)
                   END
            )::json
            FROM tg_summary_payloads p
            WHERE p.summary_id = s.id
            """
        )
    )

    op.drop_column("tg_summaries", "prompt_excerpt")
    op.drop_column("tg_summaries", "chat_message_count")
    op.drop_index(
        op.f("ix_tg_summary_payloads_user_id"), table_name="tg_summary_payloads"
    )
    op.drop_table("tg_summary_payloads")
