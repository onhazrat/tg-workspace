# 07: RBAC tables, permission constants, seeded roles

**What to build:** User, Admin, and Owner exist as real roles. The current superuser becomes an Admin. Authorisation checks name a permission, not a role, so a fourth role is data rather than a migration.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Role and assignment tables exist, seeded with the three roles
- [ ] Permission constants exist and call sites check them, never a role name
- [ ] The existing superuser maps to Admin with no loss of access
- [ ] The approval flag exists, separate from the active flag, defaulting to approved
