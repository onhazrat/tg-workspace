"""Split retention into deployment policy and per-User windows (ticket 20)

Carves the `retention` blob two ways: the corpus window, the sync-body window
and the new window for log rows nobody owns stay in `tg_app_settings.retention`,
and the log and report windows a person sets for their own rows move to
`tg_user_settings.retention_prefs`.

**Idempotent, because `scripts/prestart.sh` calls `alembic upgrade head` on
every deploy.** The carve is written to be a no-op on a second pass: once the
`retention` row holds only policy fields there is nothing left to extract, and
the insert is `ON CONFLICT DO NOTHING`. That matters for a downgrade-then-
upgrade, not for a repeat deploy — alembic stamps the revision and does not run
it twice. The ticket 06 migration's "the next deploy finishes the move" is
wrong for that reason, and this one does not repeat the claim: see the
no-account branch below for what actually happens there.

**Behaviour-neutral on a single-operator deployment.** `sharedLogRetentionDays`
is seeded from whatever `logRetentionDays` that deployment had, not from the
env default, so the sync and network families keep the window they were being
swept on. The personal half is copied to **every** existing account rather than
to the bootstrap owner alone: after the split the copy is what each account's
own rows are swept on, and giving the others defaults would silently change the
window for anybody who is not the operator.

**Ownerless Discover reports are adopted, once.** Report pruning becomes
per-account, so a report with no `user_id` — every report written before ticket
17 — would be reachable by no account's caps and would sit in the table
forever. Every report written since carries an owner, so this is a one-time
adoption and not a rule the job has to keep applying. The owner is resolved the
way `services/follows.resolve_follow_owner` and the ticket 06 migration resolve
it, so the three cannot disagree about who the operator is.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-08-26

"""

from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None

RETENTION_KEY = "retention"
RETENTION_PREFS_KEY = "retention_prefs"

# Duplicated from `app/services/settings_registry.py` on purpose, for the reason
# the ticket 06 migration duplicates the sync field lists: a migration pins the
# shape of the data at the moment it ran, and importing the live constant would
# make this file's behaviour change whenever a field is reclassified.
PREF_FIELDS = ("logRetentionDays", "reportRetentionDays", "reportRetentionMax")

#: The field the shared-log window is seeded from. Not an env default: a
#: deployment that had shortened its log window would otherwise find sync and
#: network logs suddenly kept for the stock 30 days, or swept on it.
SHARED_LOG_FIELD = "sharedLogRetentionDays"
LEGACY_LOG_FIELD = "logRetentionDays"


def upgrade() -> None:
    bind = op.get_bind()
    _carve_retention_blob(bind)
    _adopt_unowned_reports(bind)


def _carve_retention_blob(bind: sa.engine.Connection) -> None:
    row = bind.execute(
        sa.text("SELECT value FROM tg_app_settings WHERE key = :key").bindparams(
            key=RETENTION_KEY
        )
    ).first()
    if row is None:
        # Nothing stored: the deployment is running on defaults, and the
        # reader supplies both halves of them.
        return

    stored: dict[str, Any] = dict(row[0] or {})
    prefs = {k: stored[k] for k in PREF_FIELDS if k in stored}
    policy = {k: v for k, v in stored.items() if k not in PREF_FIELDS}

    # Seed the new window from the old one before dropping it, so the families
    # that lose their per-User home keep the horizon they had. Absent means the
    # deployment never set one, and the reader's default is the same number.
    if SHARED_LOG_FIELD not in policy and LEGACY_LOG_FIELD in stored:
        policy[SHARED_LOG_FIELD] = stored[LEGACY_LOG_FIELD]

    if prefs:
        owners = [
            found[0] for found in bind.execute(sa.text('SELECT id FROM "user"')).all()
        ]
        if not owners:
            # No account to own them: a database holding saved settings with
            # zero users, which takes deliberate effort to produce since you
            # must be signed in to save any. The deployment half is still
            # written — `sharedLogRetentionDays` has to be seeded from the old
            # `logRetentionDays` whatever happens, or the shared families
            # silently move to the stock 30 days.
            #
            # The personal fields stay in the global row rather than being
            # dropped, so the values are still there to be read by a human.
            # They will **not** be carved later: alembic stamps this revision
            # and never re-runs it, so the first account created on such a
            # database starts on the defaults. Losing three numbers on a state
            # that should not exist beats deleting them outright.
            _replace_retention(bind, policy | prefs)
            return
        for owner in owners:
            bind.execute(
                sa.text(
                    "INSERT INTO tg_user_settings (key, user_id, value, updated_at) "
                    "VALUES (:key, :user_id, :value, now()) "
                    "ON CONFLICT (key, user_id) DO NOTHING"
                ).bindparams(
                    sa.bindparam("key", value=RETENTION_PREFS_KEY),
                    sa.bindparam("user_id", value=owner),
                    sa.bindparam("value", value=prefs, type_=sa.JSON()),
                )
            )

    _replace_retention(bind, policy)


def _replace_retention(bind: sa.engine.Connection, value: dict[str, Any]) -> None:
    bind.execute(
        sa.text(
            "UPDATE tg_app_settings SET value = :value, updated_at = now() "
            "WHERE key = :key"
        ).bindparams(
            sa.bindparam("key", value=RETENTION_KEY),
            sa.bindparam("value", value=value, type_=sa.JSON()),
        )
    )


def _adopt_unowned_reports(bind: sa.engine.Connection) -> None:
    owner = _bootstrap_owner(bind)
    if owner is None:
        return
    bind.execute(
        sa.text(
            "UPDATE tg_discover_reports SET user_id = :owner WHERE user_id IS NULL"
        ).bindparams(sa.bindparam("owner", value=owner))
    )


def _bootstrap_owner(bind: sa.engine.Connection) -> Any:
    """The account legacy rows belong to on a single-operator install.

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
            sa.text('SELECT id FROM "user" WHERE email = :email').bindparams(
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
    """Merge the personal half back into the one `retention` blob.

    Lossy only in the case the split exists to prevent: if two accounts hold
    different windows, one blob cannot express both, so the oldest row wins.
    That is the pre-ticket-20 behaviour being restored, not a new defect — the
    old schema had exactly one window for everybody.

    The adopted reports keep their owner. Their `user_id` was NULL only because
    nothing had ever set it, and un-setting it would restore an ambiguity, not
    a value.
    """
    bind = op.get_bind()

    prefs_row = bind.execute(
        sa.text(
            "SELECT value FROM tg_user_settings WHERE key = :key "
            "ORDER BY updated_at LIMIT 1"
        ).bindparams(key=RETENTION_PREFS_KEY)
    ).first()
    retention_row = bind.execute(
        sa.text("SELECT value FROM tg_app_settings WHERE key = :key").bindparams(
            key=RETENTION_KEY
        )
    ).first()

    if retention_row is not None:
        merged = dict(retention_row[0] or {})
        merged.pop(SHARED_LOG_FIELD, None)
        merged.update(dict(prefs_row[0] or {}) if prefs_row else {})
        _replace_retention(bind, merged)

    bind.execute(
        sa.text("DELETE FROM tg_user_settings WHERE key = :key").bindparams(
            key=RETENTION_PREFS_KEY
        )
    )
