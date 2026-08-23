"""Resolving a User's permissions from their role assignments."""

from __future__ import annotations

import uuid

import pytest
from sqlmodel import Session, delete, select

from app.core.db import engine, reconcile_seeded_roles
from app.core.permissions import ROLE_ADMIN, ROLE_OWNER, ROLE_USER, Permission
from app.models import User
from app.models_rbac import Role, UserRole
from app.services import rbac


@pytest.fixture
def user() -> uuid.UUID:
    """A throwaway account, removed afterwards along with its assignments."""
    with Session(engine) as session:
        reconcile_seeded_roles(session)
        row = User(
            email=f"rbac-{uuid.uuid4().hex[:12]}@example.com",
            hashed_password="not-a-real-hash",
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        user_id = row.id

    yield user_id

    with Session(engine) as session:
        session.exec(delete(UserRole).where(UserRole.user_id == user_id))
        target = session.get(User, user_id)
        if target is not None:
            session.delete(target)
        session.commit()


def _assign(user_id: uuid.UUID, *role_ids: str) -> None:
    with Session(engine) as session:
        for role_id in role_ids:
            session.add(UserRole(user_id=user_id, role_id=role_id))
        session.commit()


def test_a_user_with_no_roles_holds_nothing(user: uuid.UUID) -> None:
    with Session(engine) as session:
        assert rbac.permissions_for(session, user) == frozenset()
        assert not rbac.has_permission(session, user, Permission.USERS_READ)


def test_a_role_grants_its_permissions(user: uuid.UUID) -> None:
    _assign(user, ROLE_ADMIN)
    with Session(engine) as session:
        assert rbac.has_permission(session, user, Permission.USERS_MANAGE)
        assert rbac.has_permission(session, user, Permission.UTILS_ADMIN)
        assert not rbac.has_permission(session, user, Permission.VIEW_AS)


def test_permissions_from_several_roles_are_unioned(user: uuid.UUID) -> None:
    """Two roles are additive, not a precedence order.

    Worth pinning: an implementation that picked "the highest role" would pass
    every single-role test above and quietly drop permissions here.
    """
    _assign(user, ROLE_USER, ROLE_OWNER)
    with Session(engine) as session:
        assert rbac.has_permission(session, user, Permission.VIEW_AS)
        assert rbac.has_permission(session, user, Permission.USERS_READ)


def test_role_ids_are_reported(user: uuid.UUID) -> None:
    _assign(user, ROLE_USER, ROLE_ADMIN)
    with Session(engine) as session:
        assert rbac.role_ids_for(session, user) == {ROLE_USER, ROLE_ADMIN}


def test_an_unknown_permission_string_is_ignored_not_raised(
    user: uuid.UUID,
) -> None:
    """`rbac_roles.permissions` is operator-editable data.

    A typo there must cost the one permission that was mistyped, not turn every
    request by everyone holding that role into a 500. Fail small, and in a way
    the operator can see and fix.
    """
    with Session(engine) as session:
        session.add(
            Role(
                id="typo-role",
                description="deliberately grants a value that is not a Permission",
                permissions=["users:read", "users:no_such_permission"],
            )
        )
        session.commit()
    _assign(user, "typo-role")

    try:
        with Session(engine) as session:
            resolved = rbac.permissions_for(session, user)
        assert resolved == frozenset({Permission.USERS_READ})
    finally:
        with Session(engine) as session:
            session.exec(delete(UserRole).where(UserRole.role_id == "typo-role"))
            stray = session.get(Role, "typo-role")
            if stray is not None:
                session.delete(stray)
            session.commit()


def test_deleting_a_user_takes_their_assignments_with_them(
    user: uuid.UUID,
) -> None:
    """Otherwise a recycled uuid would inherit a stranger's permissions."""
    _assign(user, ROLE_ADMIN)
    with Session(engine) as session:
        target = session.get(User, user)
        assert target is not None
        session.delete(target)
        session.commit()

        left = session.exec(select(UserRole).where(UserRole.user_id == user)).all()
        assert left == []


def test_the_bootstrap_superuser_is_an_admin() -> None:
    """The "no loss of access" mapping, checked at the data layer."""
    from app.core.config import settings

    with Session(engine) as session:
        superuser = session.exec(
            select(User).where(User.email == settings.FIRST_SUPERUSER)
        ).first()
        assert superuser is not None
        assert ROLE_ADMIN in rbac.role_ids_for(session, superuser.id)


def test_the_approval_flag_is_separate_from_the_active_flag(
    user: uuid.UUID,
) -> None:
    """Two states the admin screen has to tell apart, so two columns."""
    with Session(engine) as session:
        row = session.get(User, user)
        assert row is not None
        assert row.is_approved is True, "new accounts default to approved"

        row.is_approved = False
        session.add(row)
        session.commit()
        session.refresh(row)

        assert row.is_approved is False
        assert row.is_active is True, "revoking approval must not touch is_active"
