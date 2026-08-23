"""The permission constants and the roles seeded with them stay coherent.

Permissions are code and roles are data, which is the point — but it means the
two can disagree in ways nothing else notices. A permission nobody holds looks
like a working check that silently refuses everyone; a role granting a string
that is not a permission looks like access that is silently absent. Both fail
*closed*, which is the failure mode nobody reports until a person complains they
cannot do their job.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.core.db import engine, reconcile_seeded_roles
from app.core.permissions import (
    ROLE_ADMIN,
    ROLE_OWNER,
    ROLE_USER,
    SEEDED_ROLES,
    SEEDED_ROLES_BY_ID,
    Permission,
)
from app.models_rbac import Role


def test_the_three_roles_the_spec_names_are_seeded() -> None:
    assert set(SEEDED_ROLES_BY_ID) == {ROLE_USER, ROLE_ADMIN, ROLE_OWNER}


@pytest.mark.parametrize("seed", SEEDED_ROLES, ids=lambda seed: seed.id)
def test_a_seeded_role_grants_only_real_permissions(seed) -> None:  # type: ignore[no-untyped-def]
    """A typo here is access that silently does not exist."""
    for permission in seed.permissions:
        assert isinstance(permission, Permission)


def test_every_permission_is_held_by_someone() -> None:
    """A permission no role grants is a check that refuses everyone, forever.

    If a permission is genuinely meant to be unheld for now, give it to Owner —
    that is what Owner is for — rather than leaving it stranded here.
    """
    granted = {permission for seed in SEEDED_ROLES for permission in seed.permissions}
    stranded = sorted(set(Permission) - granted)
    assert not stranded, (
        f"no seeded role grants {stranded}; every call site checking it will "
        "refuse every user, including the Owner"
    )


def test_the_plain_user_role_grants_nothing() -> None:
    """`User` is the default role, so anything it holds is granted to everyone.

    Asserted rather than assumed: adding a permission to this row is the single
    easiest way to hand the whole world an admin capability by accident.
    """
    assert SEEDED_ROLES_BY_ID[ROLE_USER].permissions == ()


def test_view_as_is_owner_only() -> None:
    """The spec makes View-as a permission, not a role, and Owner holds it."""
    holders = {
        seed.id for seed in SEEDED_ROLES if Permission.VIEW_AS in seed.permissions
    }
    assert holders == {ROLE_OWNER}


def test_the_database_rows_match_the_constants_after_reconciliation() -> None:
    """Code is the source of truth for the *seeded* roles.

    `reconcile_seeded_roles` runs on every boot precisely so that adding a
    permission in code reaches an existing database. Without it, authorisation
    reads a row that still holds yesterday's list and the constant is a claim
    the system does not honour.
    """
    with Session(engine) as session:
        reconcile_seeded_roles(session)

        for seed in SEEDED_ROLES:
            role = session.get(Role, seed.id)
            assert role is not None, f"seeded role {seed.id} is missing"
            assert role.permissions == [p.value for p in seed.permissions], (
                f"{seed.id} in the database does not match the constants"
            )
            assert role.description == seed.description


def test_reconciliation_repairs_a_drifted_row() -> None:
    """The case the function exists for, exercised rather than asserted."""
    with Session(engine) as session:
        role = session.get(Role, ROLE_ADMIN)
        assert role is not None
        original = list(role.permissions)

        role.permissions = []
        session.add(role)
        session.commit()

        reconcile_seeded_roles(session)
        session.refresh(role)
        assert role.permissions == original
