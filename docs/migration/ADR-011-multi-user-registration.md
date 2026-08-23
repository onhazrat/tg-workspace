# ADR-011: Multi-user registration and approval

**Status:** Accepted (2026-08-23) — supersedes the registration half of
[ADR-002](./ADR-002-auth.md) and Mode A's `USERS_OPEN_REGISTRATION=false` rule in
[DECISIONS.md](./DECISIONS.md).

## Context

The deployment model was **Mode A**: one operator, one superuser owning all data,
open registration off in production, and email signup and recovery "stripped from
the production path". That was the right call for a homelab install with a single
person using it.

It is no longer what is being built. The multi-user programme
(`docs/multi-user-tenancy-plan.md`) makes accounts a real concept: roles
(ticket 07), per-User scoping, quotas. Registration has to exist for any of that
to mean anything. Leaving the old rule written down while the code does the
opposite is worse than either choice on its own — the next person reads the ADR
and believes it.

## Decision

**Registration is a supported path**, gated by two independent settings:

| Setting | Default | Meaning |
|---|---|---|
| `USERS_OPEN_REGISTRATION` | `true` | Whether `POST /users/signup` accepts anyone at all. |
| `USERS_REQUIRE_APPROVAL` | `false` | Whether a new account waits for an Admin. |

They are separate because they answer different questions: *may strangers apply*
and *do applications need review*. An internet-facing deployment wants both on. A
homelab wants registration off entirely and the bootstrap superuser. A small team
wants registration on and approval on.

**Approval defaults to off.** Someone who turned open registration on asked for
open registration; silently queueing their sign-ups for a screen they never
enabled would be the opposite of what they asked for.

**Approval is not enforced at login.** An unapproved person receives a token,
can read `/users/me`, and is refused by every data-bearing router with a
distinct reason. The alternative — refusing the login — leaves nowhere to
explain the situation, and no way for them to tell "wrong password" from
"waiting for an admin".

**`is_approved` is a separate column from `is_active`.** "Never approved" and
"an Admin turned this off" are different states, resolve differently, and the
admin screen has to show both. Disabling an approved account must not send it
back to the pending queue when it is re-enabled.

**Signup answers identically for every address.** It returns 202 and one fixed
message, and returns a *message* rather than the created account — a body
carrying an id only exists when creation happened, so returning `UserPublic`
would reopen the account-enumeration oracle by construction. This is the same
leak [ticket 01] closed on password recovery, which signup still had.

## Consequences

- A person who mistypes an address they already own gets no hint, and finds out
  when their password does not work. Accepted: the alternative is telling any
  stranger which addresses have accounts. The edge rate limit (`compose.yml`)
  keeps it from being cheap to probe.
- `is_approved` defaults to `true` at the column level, so turning approval on
  affects only accounts created afterwards. Existing users are never
  retroactively locked out.
- Mode A remains a *supported configuration* — set `USERS_OPEN_REGISTRATION=false`
  and it behaves exactly as before. It is no longer the only one.

## What this does not decide

Per-User data scoping. Every account still sees the same corpus until the
scoping tickets land; approval controls *entry*, not *isolation*. Do not read
this ADR as saying the deployment is multi-tenant yet.
