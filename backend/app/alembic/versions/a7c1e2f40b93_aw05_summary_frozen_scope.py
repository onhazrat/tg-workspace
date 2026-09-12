"""AW-05: freeze a Summary's Scope at submission.

Revision ID: a7c1e2f40b93
Revises: f3a4b5c6d7e8
Create Date: 2026-09-12

Two nullable JSON columns and nothing else. `tg_summaries.scope` holds the
frozen Scope a Summary was produced from; `tg_summary_payloads.scope_posts`
holds the explicit Post selection the semantic and related-Post paths name, kept
out of the base row because the list projection must not read it.

Nullable, because every existing row predates the contract and none of them can
supply it. They are **not** backfilled: a guessed keyword or cap is a lie about
which Posts produced a result, and AW-07 deletes them instead.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a7c1e2f40b93"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_summaries",
        sa.Column("scope", postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "tg_summary_payloads",
        sa.Column("scope_posts", postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tg_summary_payloads", "scope_posts")
    op.drop_column("tg_summaries", "scope")
