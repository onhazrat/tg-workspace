"""RBAC roles, role assignments, and the approval flag

Creates `rbac_roles` and `rbac_user_roles`, seeds the three roles, gives every
existing superuser the Admin role, and adds `user.is_approved`.

The seed and the Admin assignment are data written by a migration, which this
project normally pushes into `backend/scripts/`. They belong here because they
are not a data *move* — they are the thing that makes this migration
behaviour-neutral. The moment the new code deploys, authorisation reads role
assignments and stops reading `is_superuser`; if the assignment were a script an
operator runs afterwards, every superuser would be locked out of user
management in the window between the two. Correctness, not convenience.

`ADD COLUMN ... NOT NULL DEFAULT true` does not rewrite the table on PostgreSQL
11+, so this is online-safe on a live database.

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b0c1d2e3f4a5"
down_revision = "a9b0c1d2e3f4"
branch_labels = None
depends_on = None


# Duplicated from `app/core/permissions.py` rather than imported, on purpose. A
# migration is a historical record of what the schema did on the day it ran; an
# import would let a later edit of the constants silently rewrite history, and
# `alembic upgrade` on an old database would seed rows that never existed.
_ROLE_SEED = [
    ("user", "Signed-in person. Owns their own data and nothing else.", []),
    (
        "admin",
        "Manages accounts and operational endpoints.",
        ["users:read", "users:manage", "items:manage_any", "utils:admin"],
    ),
    (
        "owner",
        "Everything an Admin can do, plus looking as another User.",
        ["users:read", "users:manage", "items:manage_any", "utils:admin", "view_as"],
    ),
]


def upgrade():
    op.create_table(
        "rbac_roles",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("permissions", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "rbac_user_roles",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "role_id", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["rbac_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "role_id"),
    )

    roles = sa.table(
        "rbac_roles",
        sa.column("id", sa.String),
        sa.column("description", sa.String),
        sa.column("permissions", sa.JSON),
    )
    op.bulk_insert(
        roles,
        [
            {"id": role_id, "description": description, "permissions": permissions}
            for role_id, description, permissions in _ROLE_SEED
        ],
    )

    op.add_column(
        "user",
        sa.Column(
            "is_approved", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )

    # Every existing superuser becomes an Admin. This is the "no loss of access"
    # half of the ticket: without it, the deploy that stops reading
    # `is_superuser` takes user management away from the only account that has
    # it. `ON CONFLICT DO NOTHING` keeps the migration idempotent.
    op.execute(
        sa.text(
            """
            INSERT INTO rbac_user_roles (user_id, role_id)
            SELECT id, 'admin' FROM "user" WHERE is_superuser IS TRUE
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade():
    op.drop_column("user", "is_approved")
    op.drop_table("rbac_user_roles")
    op.drop_table("rbac_roles")
