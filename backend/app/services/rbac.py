"""Read model — resolves a User's permissions from their role assignments.

Kind: **read model** (`tests/services/test_service_kinds.py`). It reads
`rbac_user_roles` joined to `rbac_roles` and never commits. Seeding is not done
here on purpose: roles are written by the migration that creates them and by
`init_db` for the bootstrap superuser, so this module has no reason to write and
the service-kind guard mechanically keeps it that way.

**`is_superuser` is not consulted anywhere in this module, and must not be.**
The column still exists — dropping it is a later ticket — but two answers to
"can this user do X" is exactly the drift that makes authorisation rot: they can
disagree, and nothing notices. `tests/api/test_permission_checks.py` asserts no
authorisation path reads it.
"""

from __future__ import annotations

import uuid

from sqlmodel import Session, col, select

from app.core.permissions import Permission
from app.models_rbac import Role, UserRole


def role_ids_for(session: Session, user_id: uuid.UUID) -> frozenset[str]:
    """The role ids assigned to one User."""
    rows = session.exec(
        select(col(UserRole.role_id)).where(col(UserRole.user_id) == user_id)
    ).all()
    return frozenset(str(role_id) for role_id in rows)


def permissions_for(session: Session, user_id: uuid.UUID) -> frozenset[Permission]:
    """The union of every permission granted by the User's roles.

    Unknown strings in `rbac_roles.permissions` are dropped rather than raising.
    That column is data an operator can edit, so a typo there must not turn
    every request by that User into a 500 — it should cost them the one
    permission they mistyped, which is the failure mode they can actually see
    and fix.
    """
    granted = session.exec(
        select(Role.permissions)
        .join(UserRole, col(UserRole.role_id) == col(Role.id))
        .where(col(UserRole.user_id) == user_id)
    ).all()

    known = {permission.value for permission in Permission}
    return frozenset(
        Permission(value)
        for permission_list in granted
        for value in (permission_list or [])
        if value in known
    )


def has_permission(
    session: Session, user_id: uuid.UUID, permission: Permission
) -> bool:
    """Whether one User holds one permission, through any of their roles."""
    return permission in permissions_for(session, user_id)
