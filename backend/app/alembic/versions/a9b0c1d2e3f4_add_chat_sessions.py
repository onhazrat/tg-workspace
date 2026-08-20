"""promote chats to their own aggregate; add artifact-list columns

A chat used to be a ``tg_summaries`` row whose ``text`` began with the literal
string ``"Chat: "``, with the transcript in ``tg_summary_payloads.chat_messages``.
That encoded the *kind* of an artifact in a prefix of its body text, and a chat
started while a summary was open patched *that summary* rather than creating a
row — so it never appeared in history as its own thing.

This revision is **DDL only**. The data move lives in
``backend/scripts/backfill_chat_sessions.py`` because it deletes user artifacts,
and ``prestart.sh`` runs ``alembic upgrade head`` unattended on every container
start: a migration that silently deletes ``tg_summaries`` rows would have no
operator in the loop and no way to see the count first. The downgrade *is*
automatic, because reversing it needs no Python — see below.

Three columns are added for the unified ``/data/artifacts`` list:

``tg_discover_reports.candidate_count`` — ``report_to_camel_light`` computed
``len(report.candidates)``, detoasting the whole candidate array of every row on
the page to ship one integer. Same defect ``chat_message_count`` fixed one table
over.

``tg_tag_runs.extra`` and ``tg_discover_reports.extra`` — small open bags for
``isStarred``/``note``, so History's starred filter works on all four artifact
kinds rather than silently skipping two of them.

And one data migration that *is* safe to run unattended, because it neither
deletes nor derives: ``tg_llm_logs.log_type`` ``"chat"`` -> ``"chat_full_scope"``
and ``"rag_chat"`` -> ``"chat_semantic"``, matching the renamed chat modes. Every
historical ``"chat"`` row predates semantic mode, so the mapping is exact in both
directions.

Revision ID: a9b0c1d2e3f4
Revises: z8a9b0c1d2e3
Create Date: 2026-08-20
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "a9b0c1d2e3f4"
down_revision = "z8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_chat_sessions",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("channels", sa.JSON(), nullable=True),
        sa.Column("start_date", sa.BigInteger(), nullable=False),
        sa.Column("end_date", sa.BigInteger(), nullable=False),
        sa.Column("language", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("mode", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("post_count", sa.Integer(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("extra", sa.JSON(), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_tg_chat_sessions_user_id", "tg_chat_sessions", ["user_id"], unique=False
    )
    # The union's sort key. With this, each leg of /data/artifacts is an index
    # scan feeding a MergeAppend rather than a sort over the whole table.
    op.create_index(
        "ix_tg_chat_sessions_timestamp_id",
        "tg_chat_sessions",
        [sa.text("timestamp DESC"), "id"],
        unique=False,
    )

    op.create_table(
        "tg_chat_session_payloads",
        sa.Column(
            "chat_session_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False
        ),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("messages", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("chat_session_id"),
    )
    op.create_index(
        "ix_tg_chat_session_payloads_user_id",
        "tg_chat_session_payloads",
        ["user_id"],
        unique=False,
    )

    # --- artifact-list columns -------------------------------------------------
    op.add_column(
        "tg_discover_reports",
        sa.Column(
            "candidate_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.execute(
        """
        UPDATE tg_discover_reports
        SET candidate_count = COALESCE(
            jsonb_array_length(candidates::jsonb), 0
        )
        WHERE candidates IS NOT NULL
          AND jsonb_typeof(candidates::jsonb) = 'array'
        """
    )
    # Dropped once backfilled: the column is maintained on write from here on,
    # and a lingering default would quietly mask a write path that forgot.
    op.alter_column("tg_discover_reports", "candidate_count", server_default=None)

    op.add_column("tg_tag_runs", sa.Column("extra", sa.JSON(), nullable=True))
    op.add_column(
        "tg_discover_reports", sa.Column("extra", sa.JSON(), nullable=True)
    )

    # --- sort indexes for the other three union legs ---------------------------
    op.create_index(
        "ix_tg_summaries_timestamp_id",
        "tg_summaries",
        [sa.text("timestamp DESC"), "id"],
        unique=False,
    )
    op.create_index(
        "ix_tg_tag_runs_created_at_id",
        "tg_tag_runs",
        [sa.text("created_at DESC"), "id"],
        unique=False,
    )
    op.create_index(
        "ix_tg_discover_reports_timestamp_id",
        "tg_discover_reports",
        [sa.text("timestamp DESC"), "id"],
        unique=False,
    )

    # --- chat mode rename, in the one place it was persisted -------------------
    op.execute("UPDATE tg_llm_logs SET log_type = 'chat_full_scope' WHERE log_type = 'chat'")
    op.execute("UPDATE tg_llm_logs SET log_type = 'chat_semantic' WHERE log_type = 'rag_chat'")


def downgrade() -> None:
    op.execute("UPDATE tg_llm_logs SET log_type = 'chat' WHERE log_type = 'chat_full_scope'")
    op.execute("UPDATE tg_llm_logs SET log_type = 'rag_chat' WHERE log_type = 'chat_semantic'")

    # Chats become summaries again. Lossless, and expressible in SQL because the
    # hard direction is the other one: deriving a title from the first user
    # message inside a JSON array needs Python, but `'Chat: ' || title` is its
    # exact inverse. That asymmetry is why the destructive direction is a script
    # an operator runs and the reversal is automatic.
    op.execute(
        """
        INSERT INTO tg_summaries (
            id, user_id, text, channels, start_date, end_date, language, model,
            post_count, timestamp, extra, chat_message_count, prompt_excerpt,
            updated_at
        )
        SELECT c.id, c.user_id, 'Chat: ' || COALESCE(c.title, ''), c.channels,
               c.start_date, c.end_date, c.language, c.model, c.post_count,
               c.timestamp, c.extra, c.message_count, NULL, now()
        FROM tg_chat_sessions c
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO tg_summary_payloads (
            summary_id, user_id, chat_messages, updated_at
        )
        SELECT c.id, c.user_id, p.messages, now()
        FROM tg_chat_sessions c
        JOIN tg_chat_session_payloads p ON p.chat_session_id = c.id
        ON CONFLICT (summary_id)
        DO UPDATE SET chat_messages = EXCLUDED.chat_messages
        """
    )
    op.execute(
        """
        UPDATE tg_summaries s SET chat_message_count = COALESCE((
            SELECT jsonb_array_length(p.chat_messages::jsonb)
            FROM tg_summary_payloads p
            WHERE p.summary_id = s.id
              AND p.chat_messages IS NOT NULL
              AND jsonb_typeof(p.chat_messages::jsonb) = 'array'
        ), 0)
        """
    )

    op.drop_index("ix_tg_discover_reports_timestamp_id", table_name="tg_discover_reports")
    op.drop_index("ix_tg_tag_runs_created_at_id", table_name="tg_tag_runs")
    op.drop_index("ix_tg_summaries_timestamp_id", table_name="tg_summaries")
    op.drop_column("tg_discover_reports", "extra")
    op.drop_column("tg_tag_runs", "extra")
    op.drop_column("tg_discover_reports", "candidate_count")
    op.drop_index(
        "ix_tg_chat_session_payloads_user_id", table_name="tg_chat_session_payloads"
    )
    op.drop_table("tg_chat_session_payloads")
    op.drop_index("ix_tg_chat_sessions_timestamp_id", table_name="tg_chat_sessions")
    op.drop_index("ix_tg_chat_sessions_user_id", table_name="tg_chat_sessions")
    op.drop_table("tg_chat_sessions")
