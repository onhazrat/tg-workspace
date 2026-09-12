"""AW-07: delete the Artifacts that cannot supply a frozen Scope, and drop the
columns that used to stand in for one.

Revision ID: c9e4a8b71d25
Revises: b8d2f3a51c04
Create Date: 2026-09-13

An Artifact is paid for in Posts and has to record exactly which Posts. AW-05
and AW-06 made every *interactive* creation path freeze that record; this
deletes the rows that carry none, and then removes the per-kind columns the
frozen `scope` supersedes so two stored Scope values can never disagree.

**The predicate is `scope IS NULL`, which is "cannot supply the contract" and
not "is old".** Those are the same set only because every UI path freezes a
Scope now. They are not the same set for the two doors AW-06 deliberately left
open — `upsert_*` via `PUT`, which the browser's own data-transfer import still
uses — so a row written through one of those *today* is deleted by this
revision too. That is the acceptance criterion as written ("rows of every kind
that cannot provide the complete frozen Scope"), and it is survivable only
because the deployment has not launched and the Accounts belong to the product
team (ADR-018). On a launched deployment this predicate would have to be bounded
by age, or those doors closed first.

**Nothing is backfilled.** Discover is the one family that *could* be — it
stored the whole filter set from the start — and it is deleted on the same terms
as the other three, because a rule with one silent exception is not a rule. The
other three could only be backfilled by inventing the filters nobody recorded,
and a guessed filter is a lie about which Posts produced a result.

The deletion is irreversible and that is the point of it being its own
revision. It is acceptable here only because the deployment has not launched and
the existing Accounts belong to the product team (ADR-018); do not copy the
policy to post-launch data.

## What goes

* every row of `tg_summaries`, `tg_chat_sessions`, `tg_tag_runs` and
  `tg_discover_reports` whose `scope` is NULL, with its payload row;
* `channels`, `start_date` and `end_date` from all four tables;
* `keyword`, `forwarded`, `media`, `max_per_channel`, `max_per_channel_mode`,
  `seed` and `scoped_post_count` from `tg_discover_reports`, which stored the
  whole filter set a second time.

`tg_discover_reports.scope` becomes NOT NULL as well, unlike the other three.
Its response model declares `scope` required rather than nullable — the scope
card renders it unconditionally — so a report without one is a 500 rather than a
row that reads as "no Scope recorded". The other three answer `scope: null`
honestly, so their legacy `PUT` create doors can stay open.

## The payload rows

`tg_summary_payloads` and `tg_chat_session_payloads` carry no foreign key to
their parent — deliberately, so both stay droppable and truncatable — so nothing
cascades and they are deleted here by id. `tg_tag_runs` and
`tg_discover_reports` keep their corpus on the row itself and need no second
statement.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "c9e4a8b71d25"
down_revision = "b8d2f3a51c04"
branch_labels = None
depends_on = None

#: The trio every Artifact family carried, and the order to re-add it in.
_TRIO_TABLES = (
    "tg_summaries",
    "tg_chat_sessions",
    "tg_tag_runs",
    "tg_discover_reports",
)

#: `tg_discover_reports` alone stored the filter set twice: these are the seven
#: columns `scope` already holds under the same names.
_REPORT_FILTER_COLUMNS = (
    "keyword",
    "forwarded",
    "media",
    "max_per_channel",
    "max_per_channel_mode",
    "seed",
    "scoped_post_count",
)


def _json() -> sa.types.TypeEngine[object]:
    return postgresql.JSON(astext_type=sa.Text())


def upgrade() -> None:
    # The payloads first, by the ids about to disappear: no foreign key links
    # them, so a parent deleted first leaves an orphan nothing can find.
    op.execute(
        "DELETE FROM tg_summary_payloads WHERE summary_id IN "
        "(SELECT id FROM tg_summaries WHERE scope IS NULL)"
    )
    op.execute(
        "DELETE FROM tg_chat_session_payloads WHERE chat_session_id IN "
        "(SELECT id FROM tg_chat_sessions WHERE scope IS NULL)"
    )
    for table in _TRIO_TABLES:
        op.execute(f"DELETE FROM {table} WHERE scope IS NULL")  # noqa: S608

    for table in _TRIO_TABLES:
        op.drop_column(table, "channels")
        op.drop_column(table, "start_date")
        op.drop_column(table, "end_date")
    for column in _REPORT_FILTER_COLUMNS:
        op.drop_column("tg_discover_reports", column)

    # Only here, and the asymmetry is the contract: see the module docstring.
    op.alter_column("tg_discover_reports", "scope", nullable=False)


def downgrade() -> None:
    """Put the columns back, empty.

    **The deleted Artifacts do not come back.** They were rows, not schema, and
    nothing in this revision recorded them — reversing a `DELETE` would need a
    copy this deliberately did not make. What a downgrade restores is a database
    the previous revision's code can run against: the columns exist again, with
    their old defaults, holding nothing.

    Rows that survived the upgrade therefore come back with a NULL channel list
    and a zero-width window rather than with the Scope they were created under.
    That is honest and it is still lossy, so a downgrade is a rollback of the
    code, not a way to recover the data.
    """
    op.alter_column("tg_discover_reports", "scope", nullable=True)

    for table in _TRIO_TABLES:
        op.add_column(table, sa.Column("channels", _json(), nullable=True))
        op.add_column(
            table,
            sa.Column(
                "start_date", sa.BigInteger(), nullable=False, server_default="0"
            ),
        )
        op.add_column(
            table,
            sa.Column("end_date", sa.BigInteger(), nullable=False, server_default="0"),
        )
    op.add_column(
        "tg_discover_reports", sa.Column("keyword", sa.String(), nullable=True)
    )
    op.add_column(
        "tg_discover_reports",
        sa.Column("forwarded", sa.String(), nullable=False, server_default="all"),
    )
    op.add_column(
        "tg_discover_reports",
        sa.Column("media", sa.String(), nullable=False, server_default="all"),
    )
    op.add_column(
        "tg_discover_reports",
        sa.Column(
            "max_per_channel", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "tg_discover_reports",
        sa.Column(
            "max_per_channel_mode",
            sa.String(),
            nullable=False,
            server_default="latest",
        ),
    )
    op.add_column(
        "tg_discover_reports",
        sa.Column("seed", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "tg_discover_reports",
        sa.Column("scoped_post_count", sa.Integer(), nullable=True),
    )

    # The defaults above exist only so a NOT NULL column can be added to a
    # populated table; the revisions that created these columns gave them none.
    # Left in place they are schema this database never had, and autogenerate
    # would propose dropping them on the next revision.
    for table in _TRIO_TABLES:
        for column in ("start_date", "end_date"):
            op.alter_column(table, column, server_default=None)
    for column in (
        "forwarded",
        "media",
        "max_per_channel",
        "max_per_channel_mode",
        "seed",
    ):
        op.alter_column("tg_discover_reports", column, server_default=None)
