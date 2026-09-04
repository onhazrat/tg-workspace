# #164 🚧 Ceilings, Admin overrides, and the usage warning (ticket 24)

**State:** merged 2026-09-01 · **Branch:** `worktree-ticket-24-quota-ceilings` into `main` · **Diff:** +3882 / -87 across 39 files · **Opened:** 2026-09-01

---

Closes ticket 24. Ticket 23 made the ledger choose a priority; this is where it can say no.

## The shape

Each Budget now has **two** numbers. The allowance degrades work to the best-effort tier (ticket 23); the **ceiling** stops it until UTC midnight. Both resolve through three layers, most specific first:

1. `tg_quota_limits` — the per-account override an Admin sets (new table, PK `(user_id, budget)`, both columns nullable)
2. `tg_app_settings["quota"]` — the deployment-wide default an Admin sets
3. `QUOTA_DEFAULT_*_REQUESTS` / `QUOTA_DEFAULT_*_CEILING_REQUESTS` in `config.py`

Each *half* resolves independently, so capping one account's ceiling does not freeze its allowance at whatever the default happened to be that afternoon.

## Why the ceiling is not a multiple

Decision 18 spells it as an absolute daily count, and the reason is the zero case: a ceiling derived as `10 x allowance` turns an allowance of zero — which **must** mean "always best-effort" — into a ceiling of zero, which means blocked. The ten-times relationship survives only as three literals in `config.py`. Nothing in the code multiplies, and the guard's first mutation is exactly that derivation (14 red).

Zero and negative therefore differ on this rung and only on this rung: a ceiling of zero blocks outright, which is a thing an Admin may want and is not otherwise sayable.

## The lift

`tg_quota_usage` gains `ceiling_lifted_at`. That row is already keyed `(user_id, day, budget)` — exactly "this account, this Budget, today" — so decision 18's "auto-lifts at the daily reset" costs no code: tomorrow is a different row. Raising the override instead would lift tomorrow too, silently.

## Where the refusal lands

**`sync_single_channel`**, per Channel, is the half that bounds anything. `enqueue_sync_job` also refuses so `POST /jobs/sync` answers 429 rather than creating a job whose fifty Channels each fail a minute later — but it reads the ledger once for the whole batch, so the 2,000-Channel `sync_all` that crosses the ceiling was enqueued while the account was still under it. Ticket 23 named that overshoot and handed it here.

Per Channel also reaches the two syncs that never enqueue (`auto_summary._sync_stale_channels`, the legacy `_run_whole_job`), and `bulk_follow`'s probe phase is checked once at the top. A refused Channel is **skipped, not failed**.

It **fails closed**, deliberately unlike `lane_for_job`: a rung whose only job is refusal must not become a no-op exactly when the deployment is unhealthy.

## What a User sees

`GET /quota/me` answers `normal` / `degraded` / `blocked` per Budget, with **no** pydantic default on `status` — OpenAPI marks a defaulted field optional, and the only fallback a browser could invent is `"normal"`, shown to an account whose work has stopped. `client-split.conform.ts` asserts it stayed required.

- Persistent banner in the app shell (not a toast: running out lasts until UTC midnight)
- Settings → Usage, the numbers behind it
- Admin: deployment defaults, per-account overrides, and a lift button

## Verification

- `tests/services/test_quota_ceilings.py` — 26 tests, **mutation-tested: 8 mutations, 8 red**
- Full backend suite: **2042 passed, 3 skipped**
- Frontend unit: **882 passed**
- `mypy` / `ty` / `ruff` / `tsc` all clean
- Migration `c2d3e4f5a6b7` applies from empty

New route probes added to `test_account_isolation.py` (`GET /quota/me` probed live with two accounts; the four `QUOTA_MANAGE` routes excused as deployment-wide).

Plan: `docs/quota-ceilings-plan.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01UjSxKYuXGHBDkxqQPnZacD



## Comments

### onhazrat on 2026-09-01

## Code review round applied

`/code-review high` found nine issues; eight were real and are fixed in `be2910a`.

**Medium:**
1. `run_auto_sync` refused at enqueue rather than before `create_job` — a blocked account would file ~1,400 `failed` job rows a day, one per tick, and paint the Jobs panel red for a condition that is not a failure. Check moved ahead of `create_job`; the enqueue check stays for the window between them.
2. The Admin form seeded from *resolved* defaults, so every box arrived pre-filled with the shipped value and the first save wrote all six into the settings row — killing `QUOTA_DEFAULT_*` in `.env` for that deployment and making "leave it empty to inherit" unreachable. `GET /quota/limits` now sends `storedDefaults` beside `defaults`; resolved is placeholder, stored is value.
3. No UI path to *create* a per-account override — the ticket's first checkbox was reachable only by curl. Added an account picker and a per-account limits form.
4. `set_quota_limits_for_user` validated inside the write loop, so a partly-misspelled body wrote half and then answered 422.

**Low:** `bulk_follow` logged a traceback for an expected refusal; `usage_by_account`'s "spent nothing means absent" now states its one exception (a lift writes a zero row deliberately); `assert_within_ceiling` lost a `session` keyword no caller passed; the lift table is driven by the account list rather than the ledger, so an account blocked by a ceiling of zero — which has no ledger row — is liftable.

**Found separately while re-reading:** `tg_quota_limits` was missing from the test-truncation inventory, so override rows leaked between tests. That list has now been wrong three times, so `test_tg_cleanup_inventory.py` derives its coverage — the failure it prevents is a *green* test in an unrelated module. And `account_budget_states` did nine queries where three do, on an endpoint every browser polls every 60s.

Two new guards, both mutation-tested red. Full backend suite **2049 passed**, frontend **882 passed**, mypy/ty/ruff/tsc clean, migration re-verified against a clone of a real 556-channel database.
