"""The LLM log records the Provider and who spent the Key (BYOK-03).

Four columns on `tg_llm_logs`, all nullable, no backfill. Rows written before
BYOK named no Provider because there was only one; inventing `gemini` for them
would be a guess written as a fact, and `NULL` reads correctly as "from before
this was recorded".

`provider` and `base_url` are **denormalised with no foreign key**. A log row
has to stay readable after the Key that made it is deleted — revoking at the
Provider and deleting here is one decision — and a cascade would take the
evidence with the credential. They are columns rather than keys inside
`full_request` because that blob is on `LOG_HEAVY_COLUMNS` and never reaches a
list page; the 56 MB sync-log page is why that split exists.

`acted_by_user_id` / `acted_by_email` are the pair the four artifact tables
already carry, arriving here because a *failed* AI call produces no Artifact to
carry it. `SET NULL`, so deleting the Owner who once helped somebody leaves the
record of what they did behind.

Hand-written for the reason `e2f3a4b5c6d7` gives: `--autogenerate` against this
database also proposes dropping seven hand-made partial indexes and relaxing
four `NOT NULL`s it cannot see.

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-09-09

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "f3a4b5c6d7e8"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_llm_logs",
        sa.Column("provider", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "tg_llm_logs",
        sa.Column("base_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "tg_llm_logs", sa.Column("acted_by_user_id", sa.Uuid(), nullable=True)
    )
    op.add_column(
        "tg_llm_logs",
        sa.Column(
            "acted_by_email", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True
        ),
    )
    op.create_foreign_key(
        "fk_tg_llm_logs_acted_by_user_id",
        "tg_llm_logs",
        "user",
        ["acted_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_tg_llm_logs_acted_by_user_id", "tg_llm_logs", type_="foreignkey"
    )
    op.drop_column("tg_llm_logs", "acted_by_email")
    op.drop_column("tg_llm_logs", "acted_by_user_id")
    op.drop_column("tg_llm_logs", "base_url")
    op.drop_column("tg_llm_logs", "provider")
