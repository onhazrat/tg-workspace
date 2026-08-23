"""Role and role-assignment tables.

A third model module, deliberately. `models.py` is the template's auth models
and `models_tg.py` is the TG domain; roles are neither, and putting them in
either one would have made that file's stated purpose false. The split is by
*what the models are*, not by how many files there are, so a third category gets
a third module rather than being filed under the nearest wrong heading.

The permission set lives on the role row rather than in a third join table.
That is what makes the spec's "a fourth role is an insert rather than a
migration" literally true: one `INSERT INTO rbac_roles` and the role exists,
fully specified. See `app/core/permissions.py` for why permissions themselves
stay in code.
"""

from __future__ import annotations

import uuid

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class Role(SQLModel, table=True):
    """A named set of permissions. Rows are data, not schema."""

    __tablename__ = "rbac_roles"

    id: str = Field(primary_key=True, max_length=64)
    description: str = Field(default="", max_length=255)

    #: Permission values from `app.core.permissions.Permission`. Stored as JSON
    #: rather than a join table so that adding a role is a single insert; the
    #: set is small, read whole, and never queried by element.
    permissions: list[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )


class UserRole(SQLModel, table=True):
    """Assignment of a role to a user.

    Composite natural key, so the same role cannot be assigned twice and the
    "does this user hold this role" lookup is a primary-key hit. Both foreign
    keys cascade: deleting a user takes their assignments with them, and so does
    deleting a role — an assignment to a role that no longer exists would grant
    an empty permission set while looking like access.
    """

    __tablename__ = "rbac_user_roles"

    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    role_id: str = Field(
        foreign_key="rbac_roles.id",
        primary_key=True,
        max_length=64,
        ondelete="CASCADE",
    )
