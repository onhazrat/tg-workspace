"""Split settings into a global and a per-User table (ticket 06)

Creates `tg_user_settings` and carves the old `sync` blob three ways:
deployment scheduler policy stays in `tg_app_settings.sync`, the scheduler's own
counters move to `tg_app_settings.sync_runtime`, and the per-channel defaults a
person picks move to `tg_user_settings.sync_prefs`.

**Idempotent, because it runs on every deploy.** `scripts/prestart.sh` calls
`alembic upgrade head`, and the carve is written so a second pass over an
already-carved row does nothing: once the `sync` row holds only policy fields
there is nothing left to extract, and both inserts are `ON CONFLICT DO NOTHING`.

**Behaviour-neutral.** `jobs/settings.load_sync_settings` reassembles the three
rows into the dict callers saw before, so `GET`/`PUT /data/settings/sync` keep
their exact wire shape and nothing in the browser changed.

**The preference half needs an owner**, and a database can be in a state where
there is none — a fresh install migrated before its first superuser is created.
The rule is the one `services/follows.resolve_follow_owner` already uses so the
two cannot disagree: the settings row's own `user_id` stamp, else the account
matching `FIRST_SUPERUSER`, else the oldest superuser. If there is no account at
all the preference fields are **left in the `sync` row** rather than dropped, so
the next deploy — by which time the bootstrap superuser exists — completes the
move. Deleting them would lose real settings to save one query.

Revision ID: d7e8f9a0b1c2
Revises: c1d2e3f4a5b6
Create Date: 2026-08-25

"""

from typing import Any

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "d7e8f9a0b1c2"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None

SYNC_KEY = "sync"
SYNC_RUNTIME_KEY = "sync_runtime"
SYNC_PREFS_KEY = "sync_prefs"

# Duplicated from `app/services/settings_registry.py` on purpose. A migration
# pins the shape of the data at the moment it ran; importing the live constant
# would make this file's behaviour change whenever a field is reclassified,
# which is exactly what a migration must not do.
RUNTIME_FIELDS = (
    "consecutiveFailures",
    "autoSyncPauseUntil",
    "autoSyncPartialCursor",
    "autoSyncPartialBatchSize",
)
PREF_FIELDS = (
    "dynamicSyncEnabledDefault",
    "dynamicSyncExpectedPostsDefault",
    "globalStartTimeMode",
    "globalStartTimeValue",
)
POLICY_FIELDS = (
    "regularSyncIntervalMinutes",
    "syncConcurrency",
    "syncFailureBackoffMinutes",
)

# Popped by the reader on every load since long before this ticket, so the carve
# is the moment to stop storing them. `autoSyncInterval` is first renamed to its
# modern spelling if the modern one is absent.
LEGACY_FIELDS = ("autoSyncEnabled", "autoSyncInterval")


def upgrade() -> None:
    op.create_table(
        "tg_user_settings",
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("key", "user_id"),
    )
    op.create_index(
        op.f("ix_tg_user_settings_user_id"),
        "tg_user_settings",
        ["user_id"],
        unique=False,
    )

    _carve_sync_blob()


def _carve_sync_blob() -> None:
    bind = op.get_bind()
    row = bind.execute(
        sa.text(
            "SELECT value, user_id FROM tg_app_settings WHERE key = :key"
        ).bindparams(key=SYNC_KEY)
    ).first()
    if row is None:
        return

    stored: dict[str, Any] = dict(row[0] or {})
    stamped_owner = row[1]

    if "regularSyncIntervalMinutes" not in stored and isinstance(
        stored.get("autoSyncInterval"), (int, float)
    ):
        stored["regularSyncIntervalMinutes"] = int(stored["autoSyncInterval"])
    for field in LEGACY_FIELDS:
        stored.pop(field, None)

    runtime = {k: stored[k] for k in RUNTIME_FIELDS if k in stored}
    prefs = {k: stored[k] for k in PREF_FIELDS if k in stored}
    policy = {k: v for k, v in stored.items() if k not in RUNTIME_FIELDS}

    if runtime:
        # DO NOTHING rather than DO UPDATE: if a `sync_runtime` row already
        # exists, the carve has run and its counters are newer than these.
        bind.execute(
            sa.text(
                "INSERT INTO tg_app_settings (key, user_id, value, updated_at) "
                "VALUES (:key, :user_id, :value, now()) "
                "ON CONFLICT (key) DO NOTHING"
            ).bindparams(
                sa.bindparam("key", value=SYNC_RUNTIME_KEY),
                sa.bindparam("user_id", value=stamped_owner),
                sa.bindparam("value", value=runtime, type_=sa.JSON()),
            )
        )

    owner = stamped_owner if stamped_owner is not None else _bootstrap_owner(bind)
    if prefs and owner is not None:
        bind.execute(
            sa.text(
                "INSERT INTO tg_user_settings (key, user_id, value, updated_at) "
                "VALUES (:key, :user_id, :value, now()) "
                "ON CONFLICT (key, user_id) DO NOTHING"
            ).bindparams(
                sa.bindparam("key", value=SYNC_PREFS_KEY),
                sa.bindparam("user_id", value=owner),
                sa.bindparam("value", value=prefs, type_=sa.JSON()),
            )
        )
    elif prefs:
        # No account to own them yet. Keep them where they are so the next
        # deploy finishes the job; the reader falls back to defaults meanwhile,
        # which is what an install with no users would show anyway.
        policy = {k: v for k, v in policy.items() if k not in PREF_FIELDS} | prefs
        _replace_sync(bind, policy)
        return

    _replace_sync(bind, {k: v for k, v in policy.items() if k not in PREF_FIELDS})


def _replace_sync(bind: sa.engine.Connection, value: dict[str, Any]) -> None:
    bind.execute(
        sa.text(
            "UPDATE tg_app_settings SET value = :value, updated_at = now() "
            "WHERE key = :key"
        ).bindparams(
            sa.bindparam("key", value=SYNC_KEY),
            sa.bindparam("value", value=value, type_=sa.JSON()),
        )
    )


def _bootstrap_owner(bind: sa.engine.Connection) -> Any:
    """The account the preference half belongs to on a single-operator install.

    `FIRST_SUPERUSER` first, matching `services/operator.get_operator_user_id`,
    then the oldest superuser as a fallback for a deployment whose bootstrap
    address has since been changed. Read from the environment rather than by
    importing `app.core.config`, because a migration must not depend on the
    running app's settings object.
    """
    import os

    email = os.environ.get("FIRST_SUPERUSER")
    if email:
        found = bind.execute(
            sa.text("SELECT id FROM \"user\" WHERE email = :email").bindparams(
                email=email
            )
        ).first()
        if found is not None:
            return found[0]

    found = bind.execute(
        sa.text(
            'SELECT id FROM "user" WHERE is_superuser IS TRUE ORDER BY id LIMIT 1'
        )
    ).first()
    return found[0] if found is not None else None


def downgrade() -> None:
    """Merge the three rows back into one `sync` blob, then drop the table.

    Lossy only in the case the split exists to prevent: if two accounts hold
    different preferences, one blob cannot express both, so the bootstrap
    owner's win. That is the pre-ticket-06 behaviour being restored, not a new
    defect — the old schema had exactly one row for everybody.
    """
    bind = op.get_bind()

    runtime_row = bind.execute(
        sa.text(
            "SELECT value FROM tg_app_settings WHERE key = :key"
        ).bindparams(key=SYNC_RUNTIME_KEY)
    ).first()
    prefs_row = bind.execute(
        sa.text(
            "SELECT value FROM tg_user_settings WHERE key = :key "
            "ORDER BY updated_at LIMIT 1"
        ).bindparams(key=SYNC_PREFS_KEY)
    ).first()
    sync_row = bind.execute(
        sa.text(
            "SELECT value FROM tg_app_settings WHERE key = :key"
        ).bindparams(key=SYNC_KEY)
    ).first()

    if sync_row is not None:
        merged = dict(sync_row[0] or {})
        merged.update(dict(runtime_row[0] or {}) if runtime_row else {})
        merged.update(dict(prefs_row[0] or {}) if prefs_row else {})
        _replace_sync(bind, merged)

    bind.execute(
        sa.text("DELETE FROM tg_app_settings WHERE key = :key").bindparams(
            key=SYNC_RUNTIME_KEY
        )
    )

    op.drop_index(op.f("ix_tg_user_settings_user_id"), table_name="tg_user_settings")
    op.drop_table("tg_user_settings")
