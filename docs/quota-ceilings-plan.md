# Ceilings, Admin overrides, and the usage warning (ticket 24)

Ticket 08 built the ledger, ticket 23 turned it into a lane. This is the ticket
that turns it into a refusal, and the one that lets an Admin set the numbers
without a redeploy.

Five checkboxes, and the fifth exists because the other four make it easy to
get wrong: **a Budget of zero means always best-effort, never blocked.**

## Three numbers, three layers

Each Budget has an **allowance** (past it, best-effort — ticket 23's ladder) and
a **ceiling** (past it, nothing runs). Both resolve through the same three
layers, most specific first:

1. `tg_quota_limits`, the per-User override an Admin sets for one account.
2. `tg_app_settings["quota"]`, the deployment default an Admin sets for
   everybody.
3. `QUOTA_DEFAULT_*_REQUESTS` / `QUOTA_DEFAULT_*_CEILING_REQUESTS`, the shipped
   defaults in `config.py`.

Layer 3 stays because layers 1 and 2 are rows: a database with no `quota` row
and no override — every database, on the deploy that introduces this — has to
resolve to the numbers ticket 23 measured, not to zero.

**The ceiling is an absolute number, not a multiple of the allowance** (decision
18). Its *default* is ten times the allowance default, which is where the
multiple lives and where it stops living: a multiple evaluated at resolution
time makes a zero allowance a zero ceiling, and a zero allowance must mean
"always best-effort" rather than "blocked". So the three ceiling defaults are
three more settings holding 100,000 / 30,000 / 10,000, and nothing anywhere
multiplies.

`UNLIMITED` (negative) keeps its ticket 23 meaning on both numbers. A ceiling of
**zero** is therefore expressible and means "this account runs nothing on this
Budget", which is a real thing an Admin may want and is not reachable any other
way — it is the one place zero and negative genuinely differ.

## The lift is a day, so it lives on the day's row

`tg_quota_usage` gains `ceiling_lifted_at`. The ledger row is already keyed
`(user_id, day, budget)`, which is exactly the key a lift needs, and it already
has the lifetime a lift needs: tomorrow is a different row, so "auto-lifts at
the daily reset" is arithmetic rather than a job that has to run.

The alternative — an Admin raises the ceiling override — is not the same thing
and is worse at the thing it would be used for: it lifts tomorrow too, silently,
at 3 a.m. when somebody wanted one batch through.

A lift may create a row with `requests = 0`, which the ledger otherwise refuses
to write (a row of zero is indistinguishable from a real quiet day). A row
carrying a lift is distinguishable, and it is the record of an administrative
act on a table that is kept forever, so it is written.

## Where the refusal lands

Two places, and both are needed for different reasons.

**`enqueue_sync_job`** refuses before it sends anything, so `POST /jobs/sync`
answers 429 rather than creating a job whose fifty Channels each fail
separately. It marks the job row terminal first, so the SSE stream and the row
tell the same story to a caller that catches the exception and one that does
not.

**`sync_single_channel`** refuses per Channel, and this is the half that
actually bounds anything. Ticket 23 chose the tier once per enqueue call for the
whole batch and named the ceiling as what bounds the resulting overshoot — a
ceiling checked only at enqueue bounds nothing, because the 2,000-Channel batch
that crossed it was enqueued while the account was still at zero. It is also the
function `auto_summary._sync_stale_channels` and the legacy `_run_whole_job`
path reach, so one check covers the two syncs ticket 23 documented as outside
the ladder. Same argument its own docstring already makes for the claim living
there: guarding a caller leaves the next caller unguarded.

**`bulk_follow.run_follow_job`'s probe phase** is the third, and it is checked
once at the top rather than per handle: it is one metered block charged to
`manual_bulk`, on no lane, and a batch of hundreds of probes is exactly the
runaway the ceiling exists for.

## Fail closed, deliberately unlike the lane read

`lane_for_job` fails **open** on a database error, and ticket 23 wrote down why:
nothing is refused at that rung, so being wrong costs one batch at the wrong
priority. It also wrote down that this ticket "may want the other answer", and
it does. A rung whose only job is refusal must not become a no-op exactly when
the deployment is unhealthy — that is a guard that cannot fail, which this
programme has rejected six times. So an unreadable ledger refuses.

The cost is bounded and worth stating: the sync writes its Posts to the same
database, so a database that cannot answer the ceiling read is one where the
sync was going to fail anyway; what fail-closed adds is that the Requests to
Telegram are not made first.

## What a User sees

`GET /quota/me` answers for the caller: spend, allowance, ceiling, and a state
per Budget — `normal`, `degraded` (at or past the allowance, running
best-effort) or `blocked` (at or past the ceiling). The browser renders it as a
persistent banner, not a toast: "runs out" is a condition that lasts until UTC
midnight, and a toast is gone before the next click.

The banner distinguishes the two states in the one way that matters to somebody
looking at a slow app: degraded means *still running, behind everything else*,
blocked means *not running until midnight*. Reporting them alike would make the
ladder look like an outage.

## Guard

`backend/tests/services/test_quota_ceilings.py`, each assertion with the
mutation that turns it red:

| Asserts | Mutation |
|---|---|
| a zero allowance is best-effort and **not** blocked | derive the ceiling as a multiple of the allowance |
| a zero ceiling blocks | treat zero like `UNLIMITED` |
| a negative ceiling never blocks | treat it as a limit of zero |
| the per-User override beats the deployment default | read the default only |
| the deployment default beats the shipped one | read `settings` only |
| the three Budgets resolve three independent pairs | resolve one Budget's limits for all three |
| a lift stops the refusal for that account, Budget and day only | ignore `ceiling_lifted_at` |
| a lift does not reach tomorrow | key the lift by account alone |
| an unreadable ledger refuses | fail open, as `lane_for_job` does |
| `enqueue_sync_job` refuses past the ceiling and marks the job | let it enqueue |
| `sync_single_channel` refuses past the ceiling mid-batch | check only at enqueue |
| the probe phase refuses past the `manual_bulk` ceiling | check only the chained sync |
| an account under its ceiling is untouched | refuse unconditionally |
