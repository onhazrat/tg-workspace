# #165 👁️ View as, read-only (ticket 26)

**State:** merged 2026-09-02 · **Branch:** `ticket-26-view-as-read-only` into `main` · **Diff:** +2787 / -54 across 38 files · **Opened:** 2026-09-02

---

An Owner can look at the app as another User to reproduce a reported problem, and cannot change anything while looking.

Closes ticket 26 (`.scratch/multi-user-tenancy/issues/26-view-as-read-only.md`). Design and the decisions behind it: `docs/view-as-read-only-plan.md`.

## The session is a token

`POST /view-as/{user_id}` exchanges the Owner's token for a short-lived one whose `sub` is the **target** and whose `act` claim is the acting Owner. Putting the target in the standard claim is the design rather than a shortcut: the tenancy seam, the follow scoping and the browser's storage namespace already answer for `sub`, so "exactly as that User sees it" becomes true of the ~40 read paths nobody would have remembered to audit. It also settles the ribbon, which reads its claims off the token and therefore survives a reload with no state, no request and nothing to rehydrate.

## Every write is refused, and the allowlist is an inventory

The refusal lives in `get_current_user` and nowhere else — one gate, every authenticated route. A middleware would be a second gate to keep in step, which is the drift that left `/password-recovery` unreachable for months.

It refuses any non-safe method **minus a declared allowlist** of five reads that are POSTs only because the channel selection travels in the body. `tests/api/test_view_as.py` walks every mutating operation the app mounts and fails on one that is neither refused, allowlisted with a reason, nor derived from the dependency tree as authenticating nobody — then calls each allowlisted path with a real token, so an entry nothing exercises cannot pass as a rule.

## Getting back

A deleted or disabled target answers with its own detail string, because `isAuthFailure` reads `"User not found"` and `"Inactive user"` as a dead session — answering either would sign the **Owner** out over something that happened to somebody else's account. The browser layers `view_as_token` over `access_token` rather than replacing it, so returning is one removal and never a restore that could fail.

The audit row is the one table here whose foreign keys do not cascade: the case a reader most wants an answer for is the deleted account.

## Two changes outside the ticket's scope

Both required for the feature to be reachable at all. The bootstrap superuser now holds `owner` rather than `admin`, since `VIEW_AS` is Owner-only and a deployment whose one privileged account is an Admin cannot use this. And `test_rbac.py` asserts the permissions that account holds rather than its role id — a test naming the role would have failed on a change that took nothing away, which is the brittleness roles-as-data exists to avoid.

## What review caught

Two failures no checkbox reaches, both fixed in the second commit and both guarded:

- **The ribbon missed the main screen.** Mounted in the app shell, which does not wrap `/summarizer` (`_tg` renders a bare `Outlet`). Now at the router root.
- **Expiry was a login loop.** `activeToken()` served the stored token past its `exp`, so the transport cleared the Owner's token and left the dead View-as one behind for the next sign-in to prefer.

Three unused things went with them: a dead `request.state.view_as` write whose comment named a reader that does not exist, a `vsid` claim read nowhere, and a `list_sessions` parameter with no caller.

## Verification

- 2,070 backend tests, 898 frontend unit tests, mypy / ty / ruff / biome / tsc / production build all clean
- **Twelve mutations run against the new guards; all twelve went red** — five backend (the read-only branch, the deleted-target detail, a transposed actor/subject pair, the peer refusal, an always-true allowlist), seven frontend (logout cleanup, the token layering, expiry, the ribbon mount, the layout offset, the expiry fallback, the stale-session cleanup)
- Exercised live against a dev server: the exchange, a read answering as the target, three writes refused, an allowlisted read let through, the audit trail read back, and a deleted target answering `"Viewed account no longer exists"` while its record survived with `subjectUserId: null` and the address intact

Not verified in a browser — the Chrome extension was not connected in this session. The ribbon's data source (`viewAsClaims`) has unit coverage including the reload and expiry cases, and its mount and layout offset are guarded structurally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015dssTRErvCx6r46a8qzdm3
