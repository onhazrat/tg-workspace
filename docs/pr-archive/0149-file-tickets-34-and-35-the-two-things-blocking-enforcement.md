# #149 📋 File tickets 34 and 35: the two things blocking enforcement

**State:** merged 2026-08-28 · **Branch:** `worktree-tickets-34-35` into `main` · **Diff:** +196 / -1 across 4 files · **Opened:** 2026-08-28

---

Files the two requirements that actually block ticket 21. Documentation only — no code, no tests, no migration.

## Why

Ticket 21's eight declared blockers (15, 16, 17, 18, 19, 20, 30, 32) are all `done`, so its file reads unblocked. It is not. Two requirements were discovered by tickets that landed *after* 21 was written, and neither had a ticket number — they existed only as notes in a session tracker, which is not somewhere the next person looks.

## 34 — Backfill owners before enforcement

Reached independently by three tickets, each of which deliberately left it for 21:

- **31** — under enforcement `assert_owner_on_write` refuses an `owner_id is None` row, and an import is one transaction, so the *first* ownerless row aborts a whole restore. Any pre-stamp backup, or one containing a log row a background job wrote, stops restoring.
- **32** — `user_id` is nullable on `tg_bot_credentials` and `tg_chat_destinations`. An ownerless credential is visible today and invisible after the flip; treating NULL as "mine" instead would hand every account the deployment's stored bot token.
- **33** — a NULL on either side of the auto-publish check is unanswerable, permitted while off and refused under enforcement. `run_auto_summary` deliberately picks up ownerless Summaries, so the actor half is not hypothetical.

**`backend/scripts/backfill_user_id.py` already exists and is not the answer.** Verified before filing: nothing runs it (it is a manual one-off; `prestart.sh` runs only `alembic upgrade head`), and its table list predates `SCOPES` — five of its thirteen models (`Channel`, `Post`, `PostEmbedding`, `PostTranslation`, `SyncLog`) are now follow-scoped or corpus, whose `user_id` ticket 22 *drops*, while ten `USER_OWNED` tables added since are missing. The ticket asks for the inventory to be derived from `SCOPES`, the way `SHARED_LOG_TYPES` and `IMPORT_WRITES` are.

It also carries ticket 06's false-idempotency claim as an explicit don't-repeat: alembic stamps a revision and never re-runs it, so a migration deferring work to "the next deploy" defers it for ever.

## 35 — Scope setting groups and sync jobs

Ticket 32's file claimed it closed "the last unscoped read family in `app/`". That was wrong; its author corrected it in four places and flagged that 21 must not treat 32 as an all-clear. Three `USER_OWNED` reads remain, none going through the seam:

- `list_setting_groups` hand-rolls `user_id == me OR user_id IS NULL` over `ChannelSettingGroup` — and **that filter narrows in both flag states**, which is precisely the changed-response-while-off failure every other adoption in this programme was built to avoid. Spot-checked and confirmed: `_operator_group_scope_filter(operator_id)`, plus an orphan branch re-reading the table filtered by id alone.
- `load_groups_by_id` reads the same table with no filter at all.
- `_running_job_from_row` reads `SyncJob` across accounts to serve `GET /jobs/runtime-config`.

The ticket flags that a naive `scoped_select` swap here **widens** the flag-off response, since the seam is a no-op while off and today's filter is not — so that decision has to be taken deliberately, with ticket 17's `/data/artifacts` precedent available but not automatic.

## Effect

Ticket 21's `Blocked by` becomes `15, 16, 17, 18, 19, 20, 30, 32, 34, 35`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
