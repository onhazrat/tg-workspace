# #118 🔐 RBAC roles, permission constants, seeded roles (ticket 07)

**State:** merged 2026-08-23 · **Branch:** `worktree-ticket-07-rbac-roles` into `main` · **Diff:** +1084 / -34 across 23 files · **Opened:** 2026-08-23

---

Closes ticket 07. Unblocks tickets **25**, **18** and **26**.

## Why

Authorisation was `if user.is_superuser`, in ten places. That spreads one policy
decision across the whole codebase, so a third kind of account means finding and
editing every one of them. It is now `Depends(require_permission(Permission.X))`,
and a fourth role is an `INSERT`.

## Shape

**Permissions are code; roles are data.** Permissions are a closed set the code has to
name, so they are a `StrEnum` in `app/core/permissions.py`. Roles are not, so they are
rows — and the permission set lives as a JSON column *on the role row* rather than in a
third join table. That is what makes "adding a role is one statement" literally true.

**A third model module**, `app/models_rbac.py`. RBAC is neither template auth nor TG
domain, and filing it under the nearer wrong heading would have made that module's
docstring false. CLAUDE.md's rule now reads as by-category rather than by-count, because
the count was never the point.

**Roles are the only authority.** `is_superuser` survives as a column until a later ticket
drops it, but nothing consults it — a guard asserts that across `app/api` and
`app/services` with **zero** exceptions, which is why `items.py` was converted even though
ticket 29 deletes it. Two answers to "can this user do X" is drift that fails closed: the
symptom is a person who cannot do their job, not an alarm.

**Seeds are reconciled on every boot.** Migration seeds and code constants diverge the
moment someone adds a permission to Admin — the row still holds yesterday's list, and the
row is what authorisation reads, so the constant becomes a claim the system does not
honour. `reconcile_seeded_roles` touches only the three seeded ids; a role an operator
added is theirs.

## Migration `b0c1d2e3f4a5`

Creates the tables, seeds the roles, adds `user.is_approved NOT NULL DEFAULT true` (no
table rewrite on PG11+), and gives every existing superuser the Admin role **in the same
transaction as the schema**. That last part is data in a migration, which this repo
normally pushes into `scripts/`. It belongs here because it is what makes the change
behaviour-neutral: run afterwards as a script, every superuser would be locked out of user
management in the window between the two.

Verified against a simulated staging upgrade — an existing database carrying a superuser
and a plain user, migrated across the revision:

```
who got a role:     boss@example.com = admin
                    plain@example.com = NONE
is_approved:        both true
downgrade+upgrade:  1 assignment, not 2
```

## Verification

- Backend **1132 passed, 2 skipped**; frontend **846 pass, 0 fail**.
- `mypy --strict`, `ty`, `ruff`, `tsc --noEmit`, biome — clean.
- **Thirteen guards, every one watched to fail.** Two escaped on the first pass and both
  taught me something. The cascade guard needed the constraint dropped *in the database*,
  because mutating `ondelete="CASCADE"` in the model proves nothing — the schema comes
  from the migration and the annotation only feeds autogenerate. And the marker attribute
  I had added to `require_permission` turned out to do no work: a permission check cannot
  run without resolving who is asking, so `get_current_user` always sits beneath it. The
  special case was deleted and that structural fact asserted instead.

## Found on the way

- **`POST /password-recovery-html-content/{email}` had never worked.** It set a response
  header literally named `subject:`; a colon is the delimiter, not a name character, so
  the route raised on every call. This ticket's "the superuser still reaches every route
  it used to" test appears to be the first thing that ever called it. One-character fix,
  in a file this PR already touches.
- **"Super users are not allowed to delete themselves" → "Account administrators…"**, in
  both places it appears. The check no longer means superuser, and leaving role vocabulary
  in a user-visible string is the drift this ticket exists to remove. Two existing
  assertions updated with it.

## Still open, for ticket 25

`POST /users/signup` answers 400 for a registered address and 200 for an unregistered one,
so it is the account-enumeration oracle that ticket 01 closed on password recovery. Ticket
25 rewrites that handler.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ECprSH6vxMjdY3U9Rnj44m
