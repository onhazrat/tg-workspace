# 25: Open registration and approval

**What to build:** People can sign up for themselves. An Admin can require approval, and an unapproved person sees a clear explanation rather than errors.

**Blocked by:** 07 (done)

**Status:** done

- [x] Registration creates a User with the default role
- [x] Approval can be required by configuration, defaulting to off
- [x] An unapproved person is refused with a clear reason and sees a dedicated page
- [x] An Admin can approve, disable, and re-enable accounts

Plus the item ticket 01 left behind:

- [x] `POST /users/signup` no longer reveals which addresses have accounts

## What shipped

- **`crud.create_user` assigns `ROLE_USER`**, so every path that makes an account
  — self signup, an Admin filling the form, the bootstrap — produces one with a
  role. Doing it there rather than per caller is what makes "a User with no role"
  unrepresentable. `init_db` adds Admin on top for the bootstrap superuser, and
  now reconciles the seeded roles *before* creating it, since the default-role
  assignment is a foreign key into `rbac_roles`.
- **`USERS_REQUIRE_APPROVAL`**, default off. Separate from
  `USERS_OPEN_REGISTRATION` because they answer different questions: may
  strangers apply, and do applications need review.
- **The approval gate is mounted per router** in `api/main.py`, not on ~90
  routes. Being unapproved is a property of the session, and a rule repeated
  ninety times is one that gets forgotten on the ninety-first.
- **`POST /users/signup` returns 202 and a fixed message**, always. It returns a
  *message* rather than the created account deliberately: a body carrying an id
  only exists when creation happened, so returning `UserPublic` would reopen the
  oracle by construction however carefully the status codes were matched.
- **`/pending-approval`**, a real route outside `_layout`. `_layout.beforeLoad`
  resolves the current user through the same query key `useAuth` uses and
  redirects, so the shell never renders and none of its requests are sent.

## Decisions taken (confirmed with the operator)

1. Signup answers identically for every address, with no notification email —
   staging and the shipped `.env` have no SMTP host, so the notify variant would
   degrade to this anyway.
2. An unapproved person **logs in** and gets a page, rather than being refused at
   the login form. The spec story asks for a page, and a refused login leaves
   nowhere to put one.
3. Approve/disable/re-enable go through the existing `PATCH /users/{id}`;
   `is_approved` joined `UserUpdate`. No new endpoints.
4. The pending state is its own route, so the URL matches what is on screen.

## Locked decision reversed, as the spec required

`docs/migration/ADR-011-multi-user-registration.md` is new. It supersedes the
registration sentence in ADR-002 and Mode A's
`USERS_OPEN_REGISTRATION=false`-in-production rule in `DECISIONS.md`; both are
struck through in place with a pointer, matching how ADR-009 was recorded.
`CLAUDE.md`, `.env.example` and `development.md` updated in the same change —
the spec called this out precisely so the prose would not end up describing the
opposite of the code.

Mode A is still a supported *configuration*. It is no longer the only one.

## Found on the way

The approval guard fired on `/password-recovery`, `/password-recovery-html-content`
and `/reset-password`. They sit on the `login` router but not under its prefix,
because that router is mounted prefix-less at `/api/v1` — the same quirk that made
forgot-password unreachable in ticket 01. They are correctly ungated: needing an
admin before you can reset a password you already own is a lockout, not a gate.
Recorded in `UNGATED_PREFIXES` with the reason.

## Still open

Per-User data scoping. Every approved account still sees the same corpus —
approval controls entry, not isolation. That is tickets 15–17 and 21.
