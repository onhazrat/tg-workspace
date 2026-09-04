# #120 👥 Open registration and approval (ticket 25)

**State:** merged 2026-08-23 · **Branch:** `worktree-ticket-25-registration-approval` into `main` · **Diff:** +895 / -53 across 24 files · **Opened:** 2026-08-23

---

Closes ticket 25, and the item ticket 01 left behind.

## Two switches, not one

`USERS_OPEN_REGISTRATION` decides whether strangers may apply. `USERS_REQUIRE_APPROVAL`
decides whether an application is reviewed. They answer different questions and real
deployments want different combinations — a homelab wants signup off entirely, an
internet-facing instance wants both on, a small team wants signup on and approval on.

Approval defaults to **off**. Someone who turned open registration on asked for open
registration; silently queueing their sign-ups for a screen they never enabled is the
opposite of that. `is_approved` already defaults true at the column level, so turning it
on affects only accounts created afterwards and can never retroactively lock anyone out.

## Approval is not enforced at login

An unapproved person gets a token, can read `/users/me`, and is refused by every
data-bearing router with its own distinct reason. Refusing the login instead leaves
nowhere to explain the situation — an error on a form, with no way to tell "wrong
password" from "waiting for an admin". That distinct `detail` is what lets the app route
to `/pending-approval`, and a guard asserts it never converges with the generic
privileges message, since the two resolve in completely different ways: one is someone
else's action, the other is final.

**The gate is mounted per router**, not on ~90 routes — being unapproved is a property of
the session, and a rule repeated ninety times gets forgotten on the ninety-first. The
guard **inverts** the check: an unrecognised router counts as a hole rather than an
exemption, so a new data router that skips it fails, and exempting one means writing down
why.

## Signup no longer says which addresses have accounts

It replied 400 "already exists" for a registered address and 200 for a free one — the same
oracle ticket 01 closed on password recovery, still open one route over and *cheaper* to
walk, since it needed no mail configuration to work.

It now returns 202 and one fixed message. It returns a **message rather than the created
account**, which is structural rather than cosmetic: a body carrying an id only exists
when creation actually happened, so returning `UserPublic` would reopen the leak however
carefully the status codes were matched.

The cost is real and written down: someone who mistypes an address they already own gets
no hint, and finds out when their password does not work. The edge rate limit from ticket
01 is what keeps that from being cheap to probe by timing instead.

## Also

- `crud.create_user` assigns the default role, so every creation path — self signup, an
  Admin filling the form, the bootstrap — produces an account with a role, and "a User
  with no role" is unrepresentable. `init_db` reconciles the seeded roles *before*
  creating the superuser, since that assignment is a foreign key into `rbac_roles`.
- `/pending-approval` is a real route outside `_layout`, so the URL matches what is on
  screen. `_layout.beforeLoad` resolves the user through the same query key `useAuth`
  already uses and redirects before the shell renders, so none of its requests are sent.
- Approve / disable / re-enable all go through the existing `PATCH /users/{id}`;
  `is_approved` joined `UserUpdate`. No new endpoints.

## The locked decision, reversed properly

The spec required this: *"That record, the auth architecture decision record, the
repository guidance file, and the development and deployment guides must be updated in the
same change, or the prose will describe the opposite of the code."*

**ADR-011** is new. ADR-002's registration sentence and Mode A's
`USERS_OPEN_REGISTRATION=false`-in-production rule are struck through in place with
pointers, matching how ADR-009 was recorded. `CLAUDE.md`, `.env.example` and
`development.md` follow. Mode A remains a supported *configuration*; it is no longer the
only one.

## Verification

- Backend **1155 passed, 2 skipped**; frontend **846 pass, 0 fail**.
- `mypy --strict`, `ty`, `ruff`, `tsc --noEmit`, biome — clean.
- **Twelve guards, every one watched to fail.**

The approval guard earned its keep immediately: it caught `/password-recovery` and
`/reset-password`, which sit on the `login` router but not under its prefix — the same
quirk behind ticket 01's bug. They are correctly ungated (needing an admin before you can
reset a password you already own is a lockout, not a gate) and are recorded with that
reason rather than silently permitted.

Two tests that encoded the old behaviour were **rewritten rather than deleted**: the API
test asserting the 400 leak, and the Playwright spec asserting the leak message on screen.
Both now assert the opposite.

## Still open

Per-User data scoping. Every approved account still sees the same corpus — approval
controls entry, not isolation. That is tickets 15–17 and 21.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ECprSH6vxMjdY3U9Rnj44m
