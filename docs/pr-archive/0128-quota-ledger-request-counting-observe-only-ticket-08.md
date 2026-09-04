# #128 🔒 Quota ledger, Request counting, observe only (ticket 08)

**State:** merged 2026-08-25 · **Branch:** `worktree-ticket-08-quota-ledger` into `main` · **Diff:** +2351 / -79 across 27 files · **Opened:** 2026-08-25

---

An Admin can now see how many Requests each account consumed today, per Budget. Nothing is throttled — tickets 23 and 24 read these numbers to pick a lane and to refuse at the ceiling, and their defaults are a guess until there is a week of real ones.

`tg_quota_usage`, PK `(user_id, day, budget)`, cascading FK. `services/quota.py` is the aggregate and sole writer; `core/request_meter.py` counts through a `contextvars` meter that `run_sync_job` opens and reads once at completion. `day` is a DATE because the reset is UTC midnight — a timestamp puts that boundary in every reader, where they eventually disagree about it.

## One Request is one attempt Telegram answered

Not one `fetch_with_retry` call. That distinction is the whole ticket, and the per-call version I wrote first was wrong: `httpx.HTTPStatusError` subclasses `httpx.HTTPError`, so a 404 satisfies `is_network` and re-enters the retry branch up to `NETWORK_FETCH_RETRIES` — **8** in production. Charging once per call billed eight real round trips as one, and undercounted worst for the accounts under the most rate-limit pressure, which are exactly the ones generating the most load.

Both plan decisions survive the fix intact. Transport failures and the retries they force are free (decision 15, "a flaky proxy is not the User's doing"); every round trip Telegram served is charged, error responses included (decision 20).

Three Budgets come off `SyncJobState.sync_mode`, which already tells the five ways a sync starts apart — a total function over that Literal rather than a field somebody has to remember to set.

`bulk_follow.run_follow_job` is metered too, to `manual_bulk`. Its probe phase is one t.me fetch per handle and a batch runs to hundreds, so leaving it out would have hidden the largest manual source of Requests from the view whose whole job is reporting what each account consumed. Meters nest, so the sync it chains is charged separately and not twice.

## Reading it

`GET /api/v1/quota/usage` behind a new `QUOTA_READ_ANY` permission on Admin and Owner, with a usage panel on `/admin`. The read crosses accounts through `unscoped_select` with the reason written.

Never pruned: retention and `stats.clear_table` both work from explicit inventories, and the guard asserts the ledger is on neither rather than trusting nobody adds it.

## Deliberately left, recorded in `docs/quota-ledger-plan.md`

- **`jobs/discover_probe.py` is uncounted** — a scheduled job hitting the web view every tick, which is what the `auto_sync` Budget exists to throttle. The probe queue is corpus-scoped, so no account owns an entry to charge. Ticket 23 decides whether the operator wears it; guessing here would invent an owner.
- **`/admin` still gates on `is_superuser`**, so a non-superuser Admin passes `QUOTA_READ_ANY` server-side and cannot reach the page. Pre-existing template code; fixing it needs `/users/me` to expose permissions, a contract change across the whole admin surface. Bites nobody today, since the only Admin is also the superuser.
- **`charge_sync_job` swallows its own failures**, which is right while nothing reads the ledger and wrong the moment a charge gates work.

Also corrected three stale counts in `CLAUDE.md`: `SCOPES` classifies 27 tables not 26, 20 are user-owned not 19, and `app/services/` has 52 modules not 44.

## Verification

1325 backend tests, mypy/ty/ruff clean, frontend typecheck and 873 unit tests clean, migration run up/down/up, generated client regenerated and its closedness asserted in `client-split.conform.ts`.

**Eighteen mutations were watched to fail**, including a revert to the per-call charging. Worth noting how the bug got through: the first thirteen mutations all passed against the buggy version, because every counting test used `retries=1` and so never entered the retry branch. One test is now pinned to `settings.NETWORK_FETCH_RETRIES` with an assertion that fails loudly if the default moves.

CI is billing-blocked, so expect no checks; everything above was run locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
