"""Key tg_discover_ignored by (handle, user_id) (ticket 30)

A dismissal is one account's judgement. The table was keyed by `handle` alone,
so the first account to dismiss a candidate dismissed it for everybody, and
`ignore_channels` — which skips a handle that already has a row — made the
second account's dismissal write nothing at all.

Scoping the read without moving the key is worse than leaving the table alone:
the scoped read then tells the second account the handle is not dismissed while
its write keeps being a no-op, so the button silently does nothing for ever.
The key and the read have to move together, which is why this is a migration.

## Owners are settled here, not deferred to the readers

A composite primary key cannot contain NULL, so "belongs to nobody" stops being
expressible the moment this runs — that is the `operator.py` ambiguity decision
24 dissolves. Every surviving row therefore leaves this migration with a real
owner:

* a row whose `user_id` names a live account keeps it;
* a row with NULL, or with an id left behind by a deleted account (the TG
  tables have no foreign key to `user.id`, so orphan stamps are a real state
  `audit_tenancy_drift.py` counts), is adopted by the operator.

"Orphan and NULL are the same situation — nobody who exists owns this" is
`follows.resolve_follow_owner`'s rule, and the operator is resolved the same way
ticket 06's and ticket 20's migrations resolve it: `FIRST_SUPERUSER`, else the
oldest superuser. Three answers to "who owns a legacy row" is exactly the drift
ticket 04 exists to prevent.

## It completes in one pass

`prestart.sh` runs `alembic upgrade head` on every deploy, but alembic stamps a
revision and never re-runs it — so a migration that leaves work "for the next
deploy" leaves it undone for ever. (Ticket 06's migration claims otherwise in
its own docstring; that claim is wrong and is not copied here.)

The one case that cannot be finished is a database with **no account at all**,
where there is nobody to adopt anything. A fresh install migrated before its
first superuser exists has an empty table, so that case completes silently. A
*non-empty* table with no resolvable owner is a different situation wearing the
same clothes, and this refuses it rather than deleting: `is_superuser` decides
nothing since ticket 18 moved authorisation onto RBAC roles, so clearing it
breaks nothing an operator would notice until a migration treats it as "no
accounts exist" and drops every dismissal on the deployment.

Every account starts clean rather than inheriting the deployment's dismissals.
The spec's list of per-User tables names "ignored Channels", so a dismissal is
personal from here on; the existing rows go to the operator because on the
single-operator deployment this migrates, the operator is who made them.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-08-26
"""

from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None

PK_NAME = "tg_discover_ignored_pkey"
FK_NAME = "fk_tg_discover_ignored_user_id_user"


def upgrade() -> None:
    bind = op.get_bind()
    _settle_owners(bind)

    op.alter_column(
        "tg_discover_ignored",
        "user_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.drop_constraint(PK_NAME, "tg_discover_ignored", type_="primary")
    op.create_primary_key(
        PK_NAME, "tg_discover_ignored", ["handle", "user_id"]
    )
    op.create_foreign_key(
        FK_NAME,
        "tg_discover_ignored",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def _settle_owners(bind: sa.engine.Connection) -> None:
    """Give every surviving row an owner that exists.

    No duplicate check is needed: `handle` was the primary key, so it is
    already unique and `(handle, user_id)` is unique for any assignment.

    With no account to adopt them, dropping the rows is only safe if there are
    none — so that is checked rather than asserted in prose. The unguarded
    version was a silent `DELETE` of every account's dismissals, and the branch
    is more reachable than it looks: ticket 18 moved authorisation onto RBAC
    roles and nothing reads `is_superuser` any more, so an operator clearing
    that flag breaks nothing visible until this runs on the next `prestart.sh`.
    Losing data during a deploy must be loud.
    """
    owner = _bootstrap_owner(bind)
    if owner is None:
        remaining = bind.execute(
            sa.text("SELECT count(*) FROM tg_discover_ignored")
        ).scalar_one()
        if remaining:
            raise RuntimeError(
                f"tg_discover_ignored holds {remaining} row(s) and no account "
                "exists to own them: `FIRST_SUPERUSER` names no user and no "
                'row in "user" has is_superuser set. A dismissal cannot be '
                "keyed without an owner, so this migration will not guess one "
                "and will not delete them. Set FIRST_SUPERUSER to an existing "
                "address, or restore a superuser, then deploy again."
            )
        return

    bind.execute(
        sa.text(
            "UPDATE tg_discover_ignored SET user_id = :owner "
            'WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM "user")'
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
    """Return to one dismissal per handle for the whole deployment.

    Lossy in exactly the case the split exists to prevent: if two accounts hold
    a verdict on one handle, a single-column key cannot express both, so the
    oldest row wins and the rest are dropped. That restores the pre-ticket-30
    behaviour rather than introducing a new defect — the old schema had one
    dismissal for everybody.

    Owners are kept on the surviving rows. They were NULL only because nothing
    had ever set them, and un-setting them would restore an ambiguity, not a
    value.
    """
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM tg_discover_ignored a USING tg_discover_ignored b "
            "WHERE a.handle = b.handle "
            "AND (b.created_at, b.user_id) < (a.created_at, a.user_id)"
        )
    )

    op.drop_constraint(FK_NAME, "tg_discover_ignored", type_="foreignkey")
    op.drop_constraint(PK_NAME, "tg_discover_ignored", type_="primary")
    op.create_primary_key(PK_NAME, "tg_discover_ignored", ["handle"])
    op.alter_column(
        "tg_discover_ignored",
        "user_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
