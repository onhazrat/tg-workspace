# 08: Quota ledger, Request counting, observe only

**What to build:** An Admin can see how many Requests each User consumed today, per Budget. Nothing is throttled; this is measurement before enforcement.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The ledger records one row per User, per day, per Budget
- [x] Requests reaching Telegram are counted, including error responses; retries and transport failures are not
- [x] Counting happens at sync completion, charging the actual Request count
- [x] Ledger rows are never pruned
- [x] An Admin view shows per-User usage

`tg_quota_usage`, PK `(user_id, day, budget)`, cascading FK to `user.id`.
`services/quota.py` is the aggregate and sole writer; `core/request_meter.py`
does the counting through a `contextvars` meter that `run_sync_job` opens and
reads once at completion.

One Request is **one attempt Telegram answered** — any status code, or a
soft-blocked page. An attempt that died in transport is free, and so is the
retry it forces, which is decision 15's "a flaky proxy is not the User's doing".

That is charged per attempt, not per call, and the per-call version is what
review caught: `httpx.HTTPStatusError` subclasses `httpx.HTTPError`, so a 404
re-enters the retry branch up to `NETWORK_FETCH_RETRIES` (8) times, and one
charge per call billed eight real round trips as one — worst for the accounts
under the most rate-limit pressure. Every guard had passed because every guard
used `retries=1`; one is now pinned to the production default.

`bulk_follow.run_follow_job` is metered too, to `manual_bulk`. Its probe phase is
one `t.me` fetch per handle and a batch runs to hundreds, so leaving it out would
have hidden the largest manual source of Requests from the view that reports what
each account consumed. Meters nest, so the sync it chains is charged separately
and not twice.

Three Budgets from `SyncJobState.sync_mode`, which already tells the five ways a
sync starts apart: `auto` → `auto_sync`, `individual` → `manual_single`, and
`bulk`/`sync_all`/`recheck_restricted` → `manual_bulk`.

`GET /api/v1/quota/usage` reads it, gated on the new `Permission.QUOTA_READ_ANY`
(Admin and Owner), with a usage panel on `/admin`.

Guards: `tests/services/test_quota_ledger.py`,
`tests/api/test_quota_usage_route.py`. Eighteen mutations were watched to fail,
including a revert to the per-call charging that review caught.

Notes for tickets 23 and 24, which read this table:

- `usage_for_user` returns every Budget present, at zero if there is no row, so
  "is this account over" is never a `KeyError`.
- `charge_sync_job` swallows and logs its own failures. That is right while
  nothing reads the ledger and **wrong once enforcement lands** — a charge that
  silently fails is then free work. Revisit it in 23.
- `jobs/discover_probe.py` is a **scheduled** job fetching the web view every
  tick and is uncounted, because `DiscoverHandleProbe` is corpus-scoped and no
  account owns a queue entry. That is background load the `auto_sync` Budget
  exists to throttle; whether the operator wears it is 23's call. The
  `routes/telegram.py` probes are unmetered for the same reason.
- `/admin` still gates on `is_superuser`, so a non-superuser holding the `admin`
  role passes `QUOTA_READ_ANY` server-side and cannot reach the page. Needs
  `/users/me` to expose permissions; affects the whole admin surface, not this
  panel.
