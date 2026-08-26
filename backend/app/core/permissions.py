"""Permission constants, and the roles seeded with them.

The point of this module is that **authorisation names a permission, never a
role**. `if user.is_admin` spreads a policy decision across every call site, so
adding a fourth role means finding and editing all of them. `if
has_permission(user, Permission.USERS_MANAGE)` puts the policy in one row of one
table, and a new role becomes an `INSERT`.

Permissions live in code because they are a closed set the code has to know the
names of. Roles live in data because they are not: `SEEDED_ROLES` is the
*initial* content of `rbac_roles`, not its definition. An operator who adds a
read-only auditor role adds a row; nothing here changes.

Adding a permission means adding it to at least one seeded role, or it is dead
code that no one can ever hold — `tests/core/test_permissions.py` asserts both
directions of that.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Permission(StrEnum):
    """Every authorisation decision the application can make.

    The value is what is stored in `rbac_roles.permissions`, so these strings
    are a persisted format: renaming one needs a migration, not just an edit.
    """

    USERS_READ = "users:read"
    """List and read accounts other than your own."""

    USERS_MANAGE = "users:manage"
    """Create, update and delete any account, and mint its reset token."""

    ITEMS_MANAGE_ANY = "items:manage_any"
    """Read and write Items belonging to someone else."""

    UTILS_ADMIN = "utils:admin"
    """Operational endpoints with no per-user meaning, such as test email."""

    QUOTA_READ_ANY = "quota:read_any"
    """Read what other accounts have spent against their Budgets.

    Separate from `USERS_READ` because it answers a different question. Knowing
    that an account exists is the price of administering accounts at all;
    knowing how much it synced and when is a behavioural record, and the auditor
    role the spec keeps in view might want one without the other.
    """

    DATA_ADMIN = "data:admin"
    """Administer the database itself: statistics, table sizes, clearing a
    table, import, export, the log purge, and the deployment's network settings.

    One permission rather than a diagnostic half and a destructive half. They
    are the same audience today, and an auditor who may read table sizes but
    not clear them is a role nobody has asked for — the day someone does, it is
    a constant here and a row in `rbac_roles`, which is what roles-as-data buys.
    """

    LOGS_READ_ANY = "logs:read_any"
    """Read log rows that belong to no single account — network logs today.

    Separate from `DATA_ADMIN` for the reason `QUOTA_READ_ANY` is separate from
    `USERS_READ`: what a deployment's proxies did is a behavioural record, and
    a reader of it does not thereby need the ability to drop a table.
    """

    JOBS_MANAGE = "jobs:manage"
    """Run the scheduler: read job status, enable or disable a job, trigger a
    run, and read a sync job nobody owns.

    Triggering `retention` deletes Posts, so this is destructive even though
    two of the three routes read like status endpoints. The unowned sync job is
    decision 23: a scheduled job keeps a nullable owner, and a row nobody
    claims leaks to an Admin and to nobody else.
    """

    VIEW_AS = "view_as"
    """Look at the application as another User (ticket 26 builds the flow).

    Declared here, and held by Owner only, because the spec calls for View-as to
    be *a permission rather than a role* precisely so that a future auditor role
    is an insert. Nothing checks it yet.
    """


# Role identifiers. Constants rather than bare strings so a typo is an
# AttributeError here instead of a silently role-less user at runtime.
ROLE_USER = "user"
ROLE_ADMIN = "admin"
ROLE_OWNER = "owner"


@dataclass(frozen=True)
class RoleSeed:
    id: str
    description: str
    permissions: tuple[Permission, ...]


#: The three roles the migration inserts. Order is widening, and each row is a
#: superset of the one above it today — but nothing depends on that, because a
#: role is a *set* of permissions, not a rank. A future role that holds
#: `VIEW_AS` and nothing else fits here without disturbing anything.
SEEDED_ROLES: tuple[RoleSeed, ...] = (
    RoleSeed(
        id=ROLE_USER,
        description="Signed-in person. Owns their own data and nothing else.",
        permissions=(),
    ),
    RoleSeed(
        id=ROLE_ADMIN,
        description="Manages accounts and operational endpoints.",
        permissions=(
            Permission.USERS_READ,
            Permission.USERS_MANAGE,
            Permission.ITEMS_MANAGE_ANY,
            Permission.UTILS_ADMIN,
            Permission.QUOTA_READ_ANY,
            Permission.DATA_ADMIN,
            Permission.LOGS_READ_ANY,
            Permission.JOBS_MANAGE,
        ),
    ),
    RoleSeed(
        id=ROLE_OWNER,
        description="Everything an Admin can do, plus looking as another User.",
        permissions=(
            Permission.USERS_READ,
            Permission.USERS_MANAGE,
            Permission.ITEMS_MANAGE_ANY,
            Permission.UTILS_ADMIN,
            Permission.QUOTA_READ_ANY,
            Permission.DATA_ADMIN,
            Permission.LOGS_READ_ANY,
            Permission.JOBS_MANAGE,
            Permission.VIEW_AS,
        ),
    ),
)

SEEDED_ROLES_BY_ID: dict[str, RoleSeed] = {role.id: role for role in SEEDED_ROLES}
