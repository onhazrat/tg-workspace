"""Drop the superseded owner and per-User columns (ticket 22)

Two groups of columns, superseded by two earlier tickets and kept until now so
the read paths could migrate one batch at a time.

**The owner stamps on the shared corpus.** `tg_channels`, `tg_posts`,
`tg_post_sync_state`, `tg_post_embeddings`, `tg_post_translations`,
`tg_sync_logs` and `tg_sync_log_payloads` are `FOLLOW_SCOPED` in
`services/tenancy.SCOPES`: what an account may see is decided by
`tg_channel_follows`, never by these. The column only ever recorded who scraped
a handle first, and filtering on it handed the second follower of a channel an
empty page for posts sitting right there. `tg_app_settings.user_id` is the same
shape from the other side — ticket 06 made that table deployment-wide with `key`
as its whole primary key, so two accounts cannot hold different values and the
column recorded who saved last.

**The per-User columns on `tg_channels`.** `setting_group_id`, `followed_at`,
`tags`, `start_id`, `start_time` and `discovered_via` moved to
`tg_channel_follows` in ticket 04. On the Channel a second follower had to
overwrite the first one's values to have any of their own; the follow table is
now their only home, and the application reads them from nowhere else.

The four sync cursors stay on `tg_channels`. They describe the shared backward
walk over one handle's history, which is the same walk however many people
follow it.

**A follow still holding NULL takes the Channel's value first.** Ticket 04
dual-wrote these fields and its backfill copied them across, so on a database
migrated in order this finds nothing — but a follow written before that
mirroring existed can hold NULL, which is what `schedule_group_id`'s `Channel`
fallback was for, and this revision is what removes that fallback. Once the
columns are dropped there is no source to recover from and a group-less follow
is permanent: `run_auto_sync` skips the channel silently for ever and
`get_group_for_channel` answers 500 for it. The copy therefore happens here,
in the one transaction that still holds both.

## The chat-id uniqueness rule changes shape, deliberately

`uq_tg_channels_user_telegram_chat_id_not_null` was unique on
`(user_id, telegram_chat_id)`, so it could only ever catch a collision *within*
one account's channels. That question stops being answerable when the column
goes, and it was the wrong question anyway: a Telegram chat id belongs to the
handle, not to whoever scraped it first, so two Channel rows claiming one chat
id means one chat's posts are being filed under two channels for everybody. The
replacement is unique on `telegram_chat_id` alone, still partial on NOT NULL.

**Existing duplicates are resolved before the index is built, not after.** A
`CREATE UNIQUE INDEX` that fails takes the whole revision with it, and
`prestart.sh` runs `alembic upgrade head` under `set -e` with the backend and
worker gated on it — so a failure here stops the deploy rather than logging a
warning. That is ticket 34's lesson, which cost a `UniqueViolation` on a green
suite and an open PR: a statement has to be checked against the constraints it
must satisfy, not only against its own predicate. The losing rows keep their
identity and lose only the binding: `telegram_chat_id` goes back to NULL, which
is the state a never-synced channel is already in, so the next sync re-binds it
and `_reconcile_telegram_chat_id` freezes it if the conflict is real. The
lowest `id` wins for no reason other than determinism.

Revision ID: f7f6948f2c5d
Revises: d2e3f4a5b6c7
Create Date: 2026-08-30

"""

import sqlalchemy as sa
from alembic import op

revision = "f7f6948f2c5d"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


#: The owner stamps, with the index each one carries. Frozen here rather than
#: derived from `tenancy.SCOPES`: an applied revision must keep meaning what it
#: meant, and importing live app code makes it drift the first time somebody
#: reclassifies a table. The guard in `tests/services/test_superseded_columns.py`
#: does the deriving, so a table that should have been on this list is a red
#: test rather than a column that quietly survives.
OWNER_COLUMNS: tuple[tuple[str, str], ...] = (
    ("tg_channels", "ix_tg_channels_user_id"),
    ("tg_posts", "ix_tg_posts_user_id"),
    ("tg_post_sync_state", "ix_tg_post_sync_state_user_id"),
    ("tg_post_embeddings", "ix_tg_post_embeddings_user_id"),
    ("tg_post_translations", "ix_tg_post_translations_user_id"),
    ("tg_sync_logs", "ix_tg_sync_logs_user_id"),
    ("tg_sync_log_payloads", "ix_tg_sync_log_payloads_user_id"),
    ("tg_app_settings", "ix_tg_app_settings_user_id"),
)

#: The per-User columns ticket 04 moved to `tg_channel_follows`.
CHANNEL_PER_USER_COLUMNS: tuple[str, ...] = (
    "setting_group_id",
    "followed_at",
    "tags",
    "start_id",
    "start_time",
    "discovered_via",
)

_OLD_CHAT_ID_INDEX = "uq_tg_channels_user_telegram_chat_id_not_null"
_NEW_CHAT_ID_INDEX = "uq_tg_channels_telegram_chat_id_not_null"


def rescue_null_follow_fields(bind: sa.engine.Connection) -> None:
    """Copy each per-User Channel value onto the follows still holding NULL.

    Ticket 04 dual-wrote these fields onto the follow and its backfill copied
    them across, so on a database migrated in order this finds nothing. A
    follow written *before* that mirroring existed can still hold NULL — which
    is what `schedule_group_id`'s `Channel` fallback was for, and this revision
    is what removes that fallback. Once the columns are dropped there is no
    source to recover from, and a group-less follow is not cosmetic:
    `run_auto_sync` skips the channel silently for ever and
    `get_group_for_channel` answers 500 for it.

    `IS NULL` per column rather than per row, because the columns diverged
    independently: a follow that picked up a group but never a start time is as
    reachable as one that has neither. And NULL only — an account that
    deliberately cleared its own tags must not have the Channel's handed back.

    A named function rather than an inline loop so the guard can run it against
    a schema with the columns restored; `upgrade` is the only caller.
    """
    for column in CHANNEL_PER_USER_COLUMNS:
        bind.execute(
            sa.text(
                "UPDATE tg_channel_follows AS f "
                f"SET {column} = c.{column} "  # noqa: S608
                "FROM tg_channels AS c "
                "WHERE f.channel_id = c.id "
                f"AND f.{column} IS NULL AND c.{column} IS NOT NULL"
            )
        )


def upgrade() -> None:
    bind = op.get_bind()

    # The chat-id index first: it is the one statement that can fail on real
    # data, and failing before anything is dropped leaves a database the next
    # `upgrade head` can retry unchanged.
    op.drop_index(_OLD_CHAT_ID_INDEX, table_name="tg_channels", if_exists=True)
    unbound = bind.execute(
        sa.text(
            """
            UPDATE tg_channels SET telegram_chat_id = NULL
            WHERE telegram_chat_id IS NOT NULL
              AND id <> (
                SELECT MIN(inner_channels.id) FROM tg_channels AS inner_channels
                WHERE inner_channels.telegram_chat_id = tg_channels.telegram_chat_id
              )
            """
        )
    ).rowcount
    op.create_index(
        _NEW_CHAT_ID_INDEX,
        "tg_channels",
        ["telegram_chat_id"],
        unique=True,
        postgresql_where=sa.text("telegram_chat_id IS NOT NULL"),
    )

    # See `rescue_null_follow_fields`: the follows that never got a copy take
    # the Channel's values here, in the one transaction that still holds both.
    rescue_null_follow_fields(bind)

    op.drop_index(
        "ix_tg_channels_setting_group_id", table_name="tg_channels", if_exists=True
    )
    for column in CHANNEL_PER_USER_COLUMNS:
        op.drop_column("tg_channels", column)

    for table, index_name in OWNER_COLUMNS:
        op.drop_index(index_name, table_name=table, if_exists=True)
        op.drop_column(table, "user_id")

    if unbound:
        # Not a warning about this migration going wrong — it is the collision
        # the old per-account index could not see, surfaced at the moment the
        # rule widened. Named so an operator can go and look.
        print(  # noqa: T201
            f"ticket 22: {unbound} channel(s) shared a telegram_chat_id across "
            f"accounts and had theirs cleared; the next sync re-binds each one "
            f"and freezes it if the conflict is real."
        )


def downgrade() -> None:
    """Put the columns back, empty.

    The values are not recoverable: the per-User ones live on
    `tg_channel_follows` with a row per follower, and this table has one row per
    handle, so there is no single value to restore for a channel two accounts
    follow. Picking one follower's would invent data. The owner stamps are gone
    outright — nothing recorded them elsewhere.

    Restoring the schema is still worth doing: a downgrade exists so an older
    application version can start, and that version's queries name these
    columns. It will read them as NULL, which for the owner stamps is a state it
    already handles, and `setting_group_id` is repopulated by the group
    resolution on the next write.
    """
    for table, index_name in reversed(OWNER_COLUMNS):
        op.add_column(table, sa.Column("user_id", sa.Uuid(), nullable=True))
        op.create_index(index_name, table, ["user_id"])

    op.add_column(
        "tg_channels", sa.Column("discovered_via", sa.JSON(), nullable=True)
    )
    op.add_column(
        "tg_channels", sa.Column("start_time", sa.BigInteger(), nullable=True)
    )
    op.add_column("tg_channels", sa.Column("start_id", sa.Integer(), nullable=True))
    op.add_column("tg_channels", sa.Column("tags", sa.JSON(), nullable=True))
    op.add_column(
        "tg_channels", sa.Column("followed_at", sa.BigInteger(), nullable=True)
    )
    op.add_column(
        "tg_channels", sa.Column("setting_group_id", sa.String(), nullable=True)
    )
    op.create_index(
        "ix_tg_channels_setting_group_id", "tg_channels", ["setting_group_id"]
    )

    op.drop_index(_NEW_CHAT_ID_INDEX, table_name="tg_channels", if_exists=True)
    op.create_index(
        _OLD_CHAT_ID_INDEX,
        "tg_channels",
        ["user_id", "telegram_chat_id"],
        unique=True,
        postgresql_where=sa.text("telegram_chat_id IS NOT NULL"),
    )
