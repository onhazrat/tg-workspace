# #142 🔒 Scope credentials and chat destinations (ticket 32)

**State:** merged 2026-08-26 · **Branch:** `worktree-ticket-32` into `main` · **Diff:** +310 / -17 across 6 files · **Opened:** 2026-08-26

---

Closes ticket 32 (`.scratch/multi-user-tenancy/issues/32-scope-credentials-and-chat-destinations.md`), which **unblocks ticket 21**.

## What was wrong

`list_bot_credentials` and `list_chat_destinations` were a bare `select(Model)` with no `user_id` parameter at all, so `GET /data/bot-credentials` and `GET /data/chat-destinations` returned every account's rows. Every *write* on the same two families has passed `user_id` since ticket 31, so one family answered two different questions about whose rows these are depending on the verb — the drift `tenancy.py` exists to prevent.

A credential row carries a **token**. Ticket 31 closed the write that let one account replace another's stored token; this is the read half of the same hole, and it was the half still open.

It also blocks ticket 21 for a reason the flip cannot fix: `scoped_select` narrows a statement that goes through it, and these two never called it, so enforcement would have changed nothing here and both lists would have kept returning everyone's rows — silently, with no test asserting otherwise.

## What changed

Both reads go through `scoped_select` with `user_id` as a **required keyword**. Both took `(session)` alone, so an optional owner would have left every existing caller passing nothing and still passing tests. The two route handlers pass `current_user.id`.

`tenancy.py` has classified both tables as `USER_OWNED` since ticket 03 — only the call sites had never adopted it, so there is no seam change here.

## The guard

`backend/tests/services/test_credential_tenancy_scoping.py`, parametrised over both families (twin-module rule) and over both flag states.

The test that earns its place is the **flag-off** one. A hand-rolled `.where(Model.user_id == user_id)` passes the enforced test with full marks and fails that one, because it narrows in a state where the seam promises not to — a changed response on today's shipping config, which is exactly what the adoption batches are not allowed to do.

Three mutations were watched going red before trusting any of it:

| Mutation | Caught by |
|---|---|
| drop `scoped_select`, back to a bare select | 2 enforced tests |
| hand-roll `.where(user_id == …)` instead of the seam | 2 flag-off tests |
| give `user_id` a default | 2 signature tests |

## The ownerless row

`user_id` is nullable on both tables, so a credential written before the stamp existed belongs to nobody: visible now, hidden the moment enforcement flips. That is **pinned in both flag states rather than fixed here**, because matching NULL as "mine" would hand every account the deployment's stored bot token. The fix is an owner backfill and it belongs to ticket 21 — which now finds a red test instead of an operator finding a publish that silently stopped.

## Verification

- New guard: 12 passed; each of the three mutations above confirmed red, then reverted.
- Full backend suite: **1698 passed, 2 skipped**.
- `mypy` strict clean; `ruff check` / `ruff format` clean; all pre-commit hooks pass.
- OpenAPI spec is **byte-identical** to the committed one, so the generated client needs no regeneration (the `generate-frontend-sdk` hook agrees).

`CLAUDE.md` had a sentence claiming these two reads were still unscoped. That is now false, so it is corrected rather than left to decay, and the new guard is added to the guards table.

Out of scope, per the ticket: `migrate_bot_credentials` and the `POST /data/import` importers for these families, both closed by ticket 31.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
