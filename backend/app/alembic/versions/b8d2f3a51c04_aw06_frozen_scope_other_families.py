"""AW-06: freeze the Scope of the other three Artifact families.

Revision ID: b8d2f3a51c04
Revises: a7c1e2f40b93
Create Date: 2026-09-12

The same two columns AW-05 added to Summaries, for Chats, Tag runs and Discover
reports: `scope` holds the frozen value an Artifact was produced from, and
`scope_posts` holds the explicit Post selection a semantic or related-Post
ranking named.

Where `scope_posts` lands follows each table's own corpus split rather than one
rule imposed across all three. A chat already keeps its transcript in
`tg_chat_session_payloads`, so the refs go there. A tag run and a report keep
their corpus on the base row and stay out of the list projection by column
selection, so the refs go on the row beside it.

Nullable, and deliberately not backfilled. Discover is the one family that could
be backfilled honestly — it already stores the whole filter set — and it is left
alone anyway, because a rule with one silent exception is the rule nobody can
state afterwards. AW-07 deletes what cannot supply the contract.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "b8d2f3a51c04"
down_revision = "a7c1e2f40b93"
branch_labels = None
depends_on = None


def _json() -> sa.types.TypeEngine[object]:
    return postgresql.JSON(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column("tg_chat_sessions", sa.Column("scope", _json(), nullable=True))
    op.add_column(
        "tg_chat_session_payloads", sa.Column("scope_posts", _json(), nullable=True)
    )
    op.add_column("tg_tag_runs", sa.Column("scope", _json(), nullable=True))
    op.add_column("tg_tag_runs", sa.Column("scope_posts", _json(), nullable=True))
    op.add_column("tg_discover_reports", sa.Column("scope", _json(), nullable=True))
    op.add_column(
        "tg_discover_reports", sa.Column("scope_posts", _json(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tg_discover_reports", "scope_posts")
    op.drop_column("tg_discover_reports", "scope")
    op.drop_column("tg_tag_runs", "scope_posts")
    op.drop_column("tg_tag_runs", "scope")
    op.drop_column("tg_chat_session_payloads", "scope_posts")
    op.drop_column("tg_chat_sessions", "scope")
