# #161 🗑️ Drop the superseded owner and per-User columns (ticket 22)

**State:** merged 2026-08-31 · **Branch:** `worktree-ticket-22-drop-superseded-columns` into `main` · **Diff:** +2760 / -880 across 61 files · **Opened:** 2026-08-30

---

Closes ticket 22 (`.scratch/multi-user-tenancy/issues/22-drop-the-superseded-columns.md`).

## What it drops

**Eight owner stamps** — `Channel`, `Post`, `PostSyncState`, `PostEmbedding`, `PostTranslation`, `SyncLog`, `SyncLogPayload` (all `FOLLOW_SCOPED`, so visibility is answered by `tg_channel_follows`) plus `AppSetting`, which ticket 06 made deployment-wide with `key` as its whole primary key.

**Six per-User columns on `Channel`** — `setting_group_id`, `followed_at`, `tags`, `start_id`, `start_time`, `discovered_via` — which ticket 04 copied to `ChannelFollow`.

The four sync cursors stay on `tg_channels`: they describe the shared backward walk over one handle's history, which is the same walk however many people follow it.

## Why it is bigger than the ticket file suggests

Dropping columns was the small half. `MIRRORED_CHANNEL_FIELDS` existed only to copy `Channel`'s values onto the follow after an edit, so removing the source removed its reason to exist. `sync_follow_settings` and `ensure_follow_for_channel` now take the values the caller means to write, and `follow_values_from_body` is where a body's `tags`/`startTime` land — `key in Channel.model_fields` is false for them now, so the old path would have **silently discarded** the edit rather than failing it.

That reaches the whole setting-group subsystem: `get_group_for_channel`, `channel_is_frozen`, `apply_group_to_channel`, both restricted-group moves, and four membership queries all changed shape.

## Three findings worth reviewing closely

**Reading the group off the Channel was a bug.** `ensure_follow_for_channel` copied `setting_group_id` across, so the second follower of a handle inherited whichever group the first one picked — including one belonging to another account, which ticket 21's cascading key then deletes out from under them.

**`PUT /data/channels/{id}` is also how a second account follows an existing Channel.** The first cut resolved the group before writing the follow, so an account with no follow yet got a 500 instead of following the handle. `test_account_isolation.py` caught it; it now resolves their own default group, as the create path does.

**The chat-id unique index widened**, from `(user_id, telegram_chat_id)` to `telegram_chat_id` alone. A chat id belongs to the handle, so the per-account version could only catch a collision inside one account's channels. The migration clears duplicate bindings *before* creating the index — a failing `CREATE UNIQUE INDEX` takes the revision with it, and `prestart.sh` runs under `set -e` with the backend gated on it, so that would stop the deploy. (Ticket 34's lesson, one ticket later.)

## Also in here

- `upsert_sync_log` loses the `user_id` it was handed and ignored, as ticket 19 said this ticket would do. The two dispatch tables name the asymmetry in a visible branch rather than hiding it behind a signature that lies.
- `ownerUserId` leaves the network-settings payload rather than being repointed at the caller. It reported the dropped stamp, and nothing read it — no frontend, no test, checked rather than assumed.
- **Ticket 06's migration docstring is corrected.** It claimed to be "idempotent, because it runs on every deploy" and that "the next deploy" completes its no-account case. Alembic stamps a revision once. The stranded preference fields stay readable (`load_sync_settings` merges the global row first) and are adopted by the first save, which the docstring now says.
- `stream_export_data` takes the caller's id, so an export still carries per-User channel fields and stays round-trippable. Deliberately *not* ticket 28's admin-scoped export — this exports your own view and nobody else's.

## Not in scope

`is_superuser`. The ticket file never names it, and ticket 07's guard already proves nothing reads it for access. Dropping it should be a deliberate separate change.

## Verification

- **1980 passed, 3 skipped, 0 failed** (baseline on `main` was 1961/3 — the delta is the new guard).
- `mypy`, `ty`, `ruff check`, `ruff format` all clean.
- Migration applies, **downgrades and re-upgrades**, and migrates a fresh database from empty.
- New guard `tests/services/test_superseded_columns.py` derives its inventory from `SCOPES` rather than listing it, and **all five assertions were watched red under mutation** — one of which caught a table name that had been guessed wrong.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V894TUeFfo2AMDNVzPfJYq

---

## Review round (`/code-review high`)

Nine findings, all real. Two were live `TypeError`s.

**Two stale `run_db` call sites.** `_finalize_channel_error` and `_load_sync_job_concurrency` each dropped a `user_id` they no longer used while their callers kept passing one. `run_db` was typed `Callable[..., T]`, so mypy saw neither — the suite was green and both would have raised in production, the first from inside the handler for an unexpected sync exception, taking the failed sync log and the auto-sync backoff with it. It is `ParamSpec`-typed now, and **that retyping is what found the second one**; review had only found the first. The quota ledger's stub was `lambda _uid:`, which is how the broken signature stayed pinned.

**A group-less follow is silently unschedulable, and four doors could write one.** Dropping `Channel.setting_group_id` removed `schedule_group_id`'s fallback. `run_auto_sync` skips such a channel for ever with nothing in the log; `get_group_for_channel` answers 500. Closed in the migration (it rescues follows still holding NULL before the source is dropped), in `backfill_channel_follows.py`, in the import's existing-Channel branch, and in `_prepare_channel_sync` — which took the *raising* lookup before its own `try`, so the exception escaped into the queue consumer rather than failing one channel. `find_group_for_channel` is the non-raising half.

**A chat-id collision freezes every follower now**, each in their own Frozen group. It used to be automatic: one Channel column froze the handle for everybody. Freezing only the resolved owner left every other follower syncing a channel the scraper had just declared unsafe — and froze nobody at all when that owner had no follow, because `apply_group_to_channel` moves nothing in that case.

**`scripts/` is type-checked** (`lint.sh` now covers `app scripts`). Three scripts were broken: `backfill_user_id.py` named five models whose `user_id` this ticket drops, `cleanup_auto_follow_channels.py` treated the `(Channel, follow)` pairs `select_bulk_channels` returns as bare Channels, and `backfill_post_media.py` had been reading `is_unavailable_on_web_view` — a `ChannelSettingGroup` column — off `Channel` since long before this ticket. That last one is the argument for the change: a script nothing checks breaks silently and an operator finds out. The same pass found `--freeze` assigning `Channel.is_frozen`, an attribute that has never existed, so that command was a no-op.

**The dropped-column guard matches constructor keywords too.** It matched `<Class>.<attr>`, which is how a *query* names a column. SQLModel accepts an unknown keyword and drops it silently, so `Channel(user_id=...)` survived, writing nothing and reading as though it wrote an owner. Adding the `ast.Call` half immediately found `PostSyncState(user_id=...)` and the four signatures threading a `user_id` to it.

### Verification after the round

- **1988 passed, 3 skipped, 0 failed.**
- `mypy`, `ty`, `ruff check`, `ruff format` clean over **`app` and `scripts`**.
- Migration applies, downgrades, re-upgrades, and migrates a fresh database from empty.
- New guard `tests/services/test_follow_always_has_a_group.py`, every assertion watched red — including **one false pass**: the migration test calls `rescue_null_follow_fields` directly, so it survived the call being deleted from `upgrade` entirely. Wiring is now its own assertion.
