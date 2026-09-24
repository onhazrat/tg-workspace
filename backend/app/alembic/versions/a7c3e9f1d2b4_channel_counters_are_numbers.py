"""Channel counters are stored as numbers (ADR-023).

Converts the five counters on `tg_channels` and `tg_channel_directory` from
Telegram's display text ("28.3K") to the integer it stands for (28300). The
parse runs in SQL and matches `parse_abbreviated_count`: spaces and commas are
separators, K/M/B multiply, the product is rounded. The upgrade refuses to run
if any non-null value does not parse, because nulling it would silently turn a
counter we read into one we never saw. Staging held none on 2026-09-24.

The downgrade writes the plain integer back as text ("28300"), which every
reader before this revision parses; the abbreviated form is not restored.

Revision ID: a7c3e9f1d2b4
Revises: f3c8a1d92b6e
Create Date: 2026-09-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7c3e9f1d2b4"
down_revision: str | None = "f3c8a1d92b6e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("tg_channels", "tg_channel_directory")
COUNTERS = ("subscribers", "photos", "videos", "files", "links")


def counter_to_int_sql(column: str) -> str:
    """SQL reading `column`'s Telegram text as an integer, NULL when it is not one."""
    clean = f"lower(regexp_replace({column}, '[\\s,]', '', 'g'))"
    return (
        f"CASE WHEN {clean} ~ '^[0-9]+(\\.[0-9]+)?[kmb]?$' THEN "
        f"round(rtrim({clean}, 'kmb')::numeric * "
        f"CASE right({clean}, 1) WHEN 'k' THEN 1000 WHEN 'm' THEN 1000000 "
        f"WHEN 'b' THEN 1000000000 ELSE 1 END)::integer END"
    )


def refuse_unparsable(
    bind: sa.engine.Connection, table: str, columns: Sequence[str]
) -> None:
    for column in columns:
        bad = bind.execute(
            sa.text(
                f"SELECT {column} FROM {table} WHERE {column} IS NOT NULL "
                f"AND {column} <> '' AND ({counter_to_int_sql(column)}) IS NULL "
                "LIMIT 5"
            )
        ).scalars()
        samples = list(bad)
        if samples:
            raise RuntimeError(
                f"{table}.{column} holds counters that do not parse: {samples!r}"
            )


def upgrade() -> None:
    bind = op.get_bind()
    for table in TABLES:
        refuse_unparsable(bind, table, COUNTERS)
    for table in TABLES:
        for column in COUNTERS:
            op.alter_column(
                table,
                column,
                type_=sa.Integer(),
                existing_nullable=True,
                postgresql_using=counter_to_int_sql(column),
            )


def downgrade() -> None:
    for table in TABLES:
        for column in COUNTERS:
            op.alter_column(
                table,
                column,
                type_=sa.String(),
                existing_nullable=True,
                postgresql_using=f"{column}::text",
            )
