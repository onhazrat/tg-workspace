# 07: RBAC tables, permission constants, seeded roles

**What to build:** User, Admin, and Owner exist as real roles. The current superuser becomes an Admin. Authorisation checks name a permission, not a role, so a fourth role is data rather than a migration.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Role and assignment tables exist, seeded with the three roles
- [x] Permission constants exist and call sites check them, never a role name
- [x] The existing superuser maps to Admin with no loss of access
- [x] The approval flag exists, separate from the active flag, defaulting to approved

## What shipped

- `app/models_rbac.py` — a **third** model module. RBAC is neither template auth
  nor TG domain, so filing it under either would have made that file's stated
  purpose false. `rbac_roles` carries its permission set as a JSON column rather
  than via a third join table, which is what makes "a fourth role is an insert"
  literally true. `rbac_user_roles` has a composite key and cascades both ways.
- `app/core/permissions.py` — the `Permission` StrEnum and the three `SEEDED_ROLES`.
  Permissions are code (a closed set the code names); roles are data.
- `app/services/rbac.py` — read model, registered in the service-kind inventory.
  Resolving permissions is a read; seeding is done by the migration and
  `init_db`, so the kind guard mechanically stops this module acquiring writes.
- `app/api/deps.py` — `require_permission(Permission.X)`, a callable class.
  Replaces `get_current_active_superuser`, which is **deleted**.
- Migration `b0c1d2e3f4a5` — tables, seed, `user.is_approved NOT NULL DEFAULT
  true` (no table rewrite on PG11+), and `INSERT ... SELECT WHERE is_superuser`
  so existing superusers become Admins in the same transaction as the schema.
- `core/db.py::reconcile_seeded_roles` — runs on every boot.

Ten call sites converted, including the four in `items.py`, so the guard "no
authorisation path reads `is_superuser`" holds with **zero** exceptions.

Thirteen guards, all mutation-tested. Twelve through the usual script; the
cascade one needed the constraint dropped in the database directly, because
mutating `ondelete="CASCADE"` in the *model* proves nothing — the schema comes
from the migration, and the annotation only feeds autogenerate.

## Decisions taken (confirmed with the operator)

1. **A third model module** rather than bending `models.py` or `models_tg.py`.
2. **Roles are the only authority.** `is_superuser` is never consulted; the
   migration and `init_db` both seed Admin so neither an existing deployment nor
   a fresh bootstrap can come up locked out.
3. **`items.py` converted too**, though ticket 29 deletes it, so the guard needs
   no exception. An exception nothing checks becomes a leftover nobody touches.

## Found on the way

- **`POST /password-recovery-html-content/{email}` had never worked.** It set a
  response header literally named `subject:` — a colon is the delimiter, not a
  name character, so the route raised on every call. Ticket 07's "the superuser
  still reaches every route it used to" test appears to be the first thing that
  ever called it. Fixed here since it is one character and in a file this ticket
  already touches.
- **"Super users are not allowed to delete themselves" was reworded** to
  "Account administrators…", in both places it appears. The check no longer means
  superuser, and leaving role vocabulary in a user-visible string is exactly the
  drift this ticket removes. Two existing assertions updated with it.
- **`require_permission` needs no marker attribute.** It first carried one so the
  ticket-01 exemption guard could recognise it; mutation testing showed the guard
  passed anyway, because a permission check cannot run without resolving *who* is
  asking, so `get_current_user` always sits beneath it. The special case was
  removed and that structural fact is now asserted instead.

## Unblocks

Ticket **25** (open registration and approval), **18** (admin-only log routes),
**26** (View as — `Permission.VIEW_AS` is already declared and Owner-only).

Ticket 25 should also close the enumeration oracle recorded in ticket 01:
`POST /users/signup` still answers 400 for a registered address and 200 for an
unregistered one.
