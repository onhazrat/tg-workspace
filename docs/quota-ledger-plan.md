# Quota ledger, Request counting, observe only (ticket 08)

**Shipped.** What follows is what was built, not what was proposed; the two
diverged in one place, noted under "What counts as a Request" — a rate-limited
fetch followed by a retry is two Requests, because both reached Telegram.

Measurement before enforcement. Nothing is throttled here — tickets 23 and 24 read
this table to pick a lane and to refuse at the ceiling. What ships now is the row
those tickets will read, and the counting that makes it true.

## What a Request is

Decision 15 of `docs/multi-user-tenancy-plan.md`: **one HTTP Request to `t.me`,
excluding retries**. Counting channel-syncs instead would make a limit meaningless
as a load control, because one sync is somewhere between one request and fifty.

That maps onto exactly one function. `services/network.py::fetch_with_retry` is the
single outbound chokepoint, and one call to it is one Request no matter how many
times it retried inside — which is the same thing `NetworkLog.attempts` already
records, one row per call with the attempt count beside it.

**Charged when Telegram answered, at all.** A 404, a 429, and a soft-blocked web
view are all responses Telegram spent resources producing, so all three count
(decision 20). A connect timeout or a dead proxy is not the caller's doing and
counts nothing. The rule inside the fetch is therefore "did any attempt come back
with an HTTP response", not "did the call succeed" — a fetch that got a 429 and then
lost its proxy still reached Telegram once.

Only `t.me` (and the configured mirror, and `telegram.me`) counts. The Bot API,
thumbnail CDNs, and proxy health checks go through the same function and are not
what the budget is measuring, so `is_telegram_web_url` is the test.

**The unit is an answered attempt, not a call — and getting this wrong was the
one real defect review caught.** The first version charged once per
`fetch_with_retry` call, on the assumption that an HTTP error ends the call.
It does not: `httpx.HTTPStatusError` subclasses `httpx.HTTPError`, so `is_network`
is true for a 404 and the retry branch takes it round again, up to
`NETWORK_FETCH_RETRIES` — **8** in production. A permanently-404 channel made
eight round trips and was billed one Request, and the undercount was worst for
the accounts under the most rate-limit pressure, which are exactly the accounts
generating the most load. Every guard passed because every guard used
`retries=1`.

So the charge happens per attempt, at the two points where the outcome is known:

* an attempt Telegram answered — any status code, or a soft-blocked page — is
  **one Request**;
* an attempt that died in transport is **free**, and so is the retry it forces.

Both decisions survive intact. "Excluding retries" (15) excludes the retries a
dead proxy forces; "error responses included" (20) charges every round trip
Telegram actually served. A rate-limited page that succeeds on the second
attempt costs two, inside one call.

## How the count reaches the ledger

The fetch does not know whose sync it is, and threading a user id from
`run_sync_job` through the orchestrator, the scraper, and into the HTTP client would
touch a dozen signatures for a number nobody on that path reads.

So: a `contextvars` meter in `app/core/request_meter.py`. `run_sync_job` opens one
for the job, every fetch underneath increments it, and completion reads the total.
`asyncio` copies the context into each task at creation, so the per-channel tasks
`run_sync_job` gathers share the job's meter, and two jobs running at once each
increment their own. No meter active means no counting, which is what every non-sync
caller of `fetch_with_retry` gets.

This lives in `core/`, not `services/`, for the same reason `async_db.py` is a
declared exception in `test_service_kinds.py`: it is infrastructure with no domain
in it, and calling it one of the five service kinds would be filing it under the
nearer wrong heading.

## Three Budgets from one field

`SyncJobState.sync_mode` already distinguishes every way a sync starts:

| `sync_mode` | Budget | Who sets it |
|---|---|---|
| `auto` | `auto_sync` | the scheduler (`jobs/auto_sync.py`, `jobs/auto_summary.py`) |
| `individual` | `manual_single` | one channel, from the UI |
| `bulk`, `sync_all`, `recheck_restricted` | `manual_bulk` | bulk follow, reset & sync, sync-all |

A total function over the five values, so a sixth mode is a compile-time decision
rather than a row quietly filed under the wrong budget.

## The table

`tg_quota_usage`, PK `(user_id, day, budget)` — decision 19, and the shape ticket 23
needs for "what has this User spent today". `day` is a UTC date, because the reset is
UTC midnight; storing a timestamp would put the reset boundary in the reader.

**Never pruned.** A few hundred rows per user per year, and it is the only record an
Admin has to set a limit from. Retention's model list and `stats.clear_table`'s
export sections both work from explicit inventories, so the ledger is out of reach of
both by construction — the guard asserts that rather than trusting it. The `user_id`
foreign key still cascades: deleting an account takes its ledger with it, which is
that account ceasing to exist, not a prune.

## Charging at completion

Decision 19 again: enforce at enqueue, account at completion. `run_sync_job` charges
once, after the gather, with the actual count. Charging per channel would multiply
the writes by the fan-out for a number nobody reads mid-job; charging at enqueue
would charge a guess.

A cancelled job is charged for what it spent before the cancel. The requests were
made.

## Reading it

`GET /api/v1/quota/usage` — one day, every User, per Budget. Gated on a new
`QUOTA_READ_ANY` permission held by Admin and Owner, never on a role name. The
admin page gets a usage panel beside the user table.

The route crosses accounts on purpose, so it reads through `unscoped_select` with a
reason, the escape hatch `services/tenancy.py` exists to make greppable.

## Files

- `app/models_tg.py` — `QuotaUsage`
- `app/alembic/versions/*_quota_ledger_ticket_08.py`
- `app/core/request_meter.py` — the contextvar meter
- `app/services/quota.py` — aggregate, sole writer, `Budget`, `budget_for_sync_mode`
- `app/services/network.py` — count at the two terminal points of `fetch_with_retry`
- `app/services/sync_orchestrator.py` — open the meter, charge at completion
- `app/services/tenancy.py` — classify `QuotaUsage` as user-owned
- `app/core/permissions.py` — `QUOTA_READ_ANY` on Admin and Owner
- `app/api/routes/quota.py`, `app/schemas/quota.py`, `app/api/main.py`
- `backend/tests/services/test_quota_ledger.py` — the guard
- `frontend/src/routes/_layout/admin.tsx` + a usage component

## Guard

`test_quota_ledger.py` asserts, each with a mutation that turns it red:

| Asserts | Mutation |
|---|---|
| a fetch that reached Telegram counts once however many attempts it took | count `len(attempts)` |
| a fetch where every attempt failed at the transport level counts nothing | count on the failure path unconditionally |
| an HTTP error response and a soft-blocked web view both count | count only on success |
| a non-`t.me` URL never counts | drop the `is_telegram_web_url` test |
| two concurrent jobs do not share a meter | hoist the meter to module scope |
| every `sync_mode` maps to a Budget | add a mode without a mapping |
| the ledger accumulates rather than overwrites on the second charge of a day | `DO UPDATE SET requests = excluded.requests` |
| retention and `clear_table` cannot reach the table | add `QuotaUsage` to either inventory |
| a crashed job is still charged | move the charge out of the `finally` |
| an ownerless job lands on the operator | pass `user_id` straight to `charge_requests` |

All thirteen were watched to fail. Two more live in
`tests/api/test_quota_usage_route.py`: an ordinary account is refused with 403,
and a malformed `day` is 422 rather than silently meaning today.

## What ticket 23 has to revisit

- `charge_sync_job` swallows and logs its own failures. Correct while nothing
  reads the ledger; **wrong once a charge gates work**, because a silently
  failed charge is then free.
- **`jobs/discover_probe.py` is uncounted, and it is a scheduled job hitting the
  web view every tick** — exactly the background load the `auto_sync` Budget
  exists to throttle. It is uncharged because `DiscoverHandleProbe` is
  corpus-scoped: the probe queue is deployment-wide and no account owns an
  entry, so there is nobody to charge without inventing an owner. Deciding
  whether the operator wears it is 23's call, not something to guess here.
- The handle probes in `routes/telegram.py` are likewise unmetered.
- **`/admin` still gates on `is_superuser` in `beforeLoad`**, so an account
  holding the `admin` role with `is_superuser=False` passes `QUOTA_READ_ANY` at
  the endpoint and can never reach the page. Pre-existing template code that
  ticket 07 did not reach, and a real contradiction of its "name a permission,
  never a flag" rule — but fixing it needs `/users/me` to expose permissions,
  which is a contract change affecting the whole admin surface rather than this
  panel. It bites nobody today, because the only Admin is also the superuser.
- `usage_for_user` already returns every Budget at zero rather than omitting it,
  so the enqueue check cannot `KeyError` on an account that has not synced yet.
