# Enqueue lane selection and the best-effort tier (ticket 23)

Ticket 08 built the measurement and said the defaults it needed were a guess
until there was a week of real numbers. There is now a week of real numbers, so
this is the ticket that turns the ledger into a decision.

**The shape.** An account inside its Budget enqueues onto the normal lane for
that Budget. An account over it enqueues onto the best-effort lane for **that
Budget only** — its other two are untouched, because the three Budgets are three
independent allowances read independently. Nothing is refused; the ceiling is
ticket 24's.

## Where the choice is made

`enqueue_sync_job` — one place, and every path that *enqueues* a sync goes
through it: `POST /jobs/sync`, `run_auto_sync` (one job per owner since ticket
21), bulk follow's chained sync, and `bulk_reset_and_queue_sync`. Ticket 33's
rule: guard the function that does the thing, not each of its callers, because
the next caller is the one that forgets.

**Two syncs do not enqueue at all, and the ladder therefore cannot see them.**
They are on no lane, so there is no tier to choose and no drain to deprioritise
them — they run at full speed, charging the Budget they may already be over.
Both predate this ticket and both are declared, with their reasons, in
`RUN_SYNC_JOB_CALLERS`; an undeclared third fails the guard.

- `auto_summary._sync_stale_channels` calls `run_sync_job` directly because it
  needs the sync *finished* before it can summarise. Ticket 10 declined to build
  the probe-shaped message that inverting its control flow would take, and
  ticket 13's docstring still carries the forward reference. It is charged to
  `auto_sync` like the scheduler's own work and never deprioritised with it.
- `bulk_follow.run_follow_job`'s probe phase is metered and charged to
  `manual_bulk`, and runs inline for the same reason. An account over its bulk
  Budget still probes at full speed; only the sync it chains is deprioritized.

A ceiling can refuse either of them, because a refusal needs no lane. That is
ticket 24's.

Decision 19 puts enforcement at enqueue and accounting at completion, and the
consequence is worth stating rather than discovering: **the tier is chosen once
per enqueue call, for the whole batch.** An account at zero that enqueues a
2,000-Channel `sync_all` runs all 2,000 at normal priority and only meets the
ladder on its *next* enqueue. Choosing per message would mean projecting the
spend of a sync that has not happened, and one sync is anywhere between one
Request and fifty — which is the guess decision 19 refuses on the charging side
for the same reason. What bounds the overshoot is the ceiling, in ticket 24.

## The allowance

`spent < allowance` is normal; `spent >= allowance` is best-effort. That
boundary is not arbitrary: it makes **an allowance of zero mean "always
best-effort"** by arithmetic rather than by a special case, which is decision
18's rule and ticket 24's fifth checkbox. A negative allowance means unlimited,
which is the escape hatch an operator needs when a default turns out wrong at
3 a.m., and is the one value that cannot collide with a real limit.

The defaults ship as deployment configuration (`QUOTA_DEFAULT_*_REQUESTS`), not
as an Admin setting and not as a per-User override — both of those are ticket
24's first checkbox. Numbers chosen from staging's own ledger, which is what
ticket 08 was built to produce:

| Budget | staging, per day | default |
|---|---|---|
| `auto_sync` | 22,528 – 33,700 | 10,000 |
| `manual_bulk` | 152 – 1,129 | 3,000 |
| `manual_single` | 1 – 409 | 1,000 |

`auto_sync` is deliberately below what the operator spends. That account follows
~2,000 Channels, which is exactly the shape the ladder exists for: its scheduled
backlog drops to best-effort part way through the day and keeps running,
because the normal tier on a quiet deployment is empty almost all the time — but
a Channel somebody clicks now preempts it. A default nobody ever crosses is a
mechanism with no caller, which this series has refused before.

The two manual defaults sit *above* observed usage on purpose. They bound a
runaway (a bulk follow of every handle in a Discover report), not ordinary work,
and a person waiting in front of the screen is the last traffic that should be
deprioritized.

## Reading the ledger

The tier is decided for the account that will be **charged**, not for the id the
caller passed. Those differ: `run_auto_sync` before ticket 21 and every legacy
message on a lane across a deploy carry no owner, and `charge_sync_job` resolves
those to the operator through `resolve_charge_owner`. Reading usage for `None`
and charging the operator would let ownerless work run at normal priority
forever while the operator paid for it. So lane selection calls
`resolve_charge_owner` too — the same function, not a second copy of the rule.

**A ledger read that fails picks the normal lane.** Fail open, and it is the
narrower of the two answers: at this rung nothing is refused, so the cost of
being wrong is one batch at the wrong priority, against degrading somebody's
foreground sync because Postgres hiccuped for a second. Ticket 24's ceiling is
where the answer may legitimately differ, because there the cost of being wrong
is unbounded work rather than a priority.

## The two questions ticket 08 left for this one

**`charge_sync_job` swallows its own failures.** Ticket 08 called that right
while nothing read the ledger and "wrong once a charge gates work, because a
silently failed charge is then free". Revisited, and the answer is unchanged,
with the reasoning now written down: the charge runs in a `finally` after the
Posts are committed, so raising would turn a completed sync into a failed one to
report an accounting problem. The cost of the swallow is bounded — one message's
Requests go unbilled, the account stays on the normal tier marginally longer
than it earned, and the next charge succeeds. It is not free work in any
accumulating sense, because the only way to under-bill repeatedly is for the
database to be persistently unreachable, and then the enqueue read, the lane
read and the sync itself have all already stopped. What changed is the log line,
which now names the Budget as well as the count, so the unbilled work is
attributable rather than merely noticed.

**`jobs/discover_probe.py` stays uncharged.** Ticket 08 said the operator
wearing it was 23's call. It is not charged, for two reasons that point the same
way. It does not enqueue onto a lane at all, so there is nothing for the ladder
to deprioritize — charging it would take Budget away from the operator's own
syncs and change nothing about the probe sweep. And the probe queue is
corpus-scoped: it is deployment background work every account benefits from, so
billing one account for it makes that account's Budget a proxy for deployment
load, which is precisely what decision 16 split the three Budgets to stop. What
bounds deployment-wide load is the proxy partition and the adaptive wait
(tickets 13 and 14), which is the tier that owns it. The handle probes in
`routes/telegram.py` are unmetered for the same reason. The question is closed,
not deferred.

`bulk_follow.run_follow_job`'s **probe phase** is the one metered block the
ladder cannot reach either — it is charged to `manual_bulk` but runs inline
rather than through a queue, so an account over its bulk Budget still probes at
full speed and only the sync it chains is deprioritized. Moving it needs a queue
message shaped like a probe rather than like a Channel sync, which ticket 10
already declined to build and this ticket does not need.

## The gate the ladder made per-account

Found by `/code-review`, and the most expensive thing in this ticket if it had
shipped. `run_auto_sync` skipped its whole tick on `has_active_sync_job()`,
which answers **deployment-wide**. Since ticket 21 a tick creates one job *per
owner*, so that already meant every account waited for the slowest one — untidy,
but bounded, because auto-sync always held weight 1 in the round-robin and made
steady progress whatever else was queued.

This ticket removes that floor. An account over its `auto_sync` Budget enqueues
onto the best-effort tier, which is served **only** when every normal lane is
empty, so its job can stay non-terminal for as long as manual work keeps
arriving — and under the old gate that one account's backlog silently stopped
*every* account's scheduler. The daily reset would not have rescued it either: a
message's lane is fixed at enqueue, and no new job can be created while the old
one is pending.

So the gate is `active_sync_job_owners()` and it **filters** rather than
returning. All owners busy still answers `sync_job_active`, which is the reason
the Jobs panel has always shown for a tick that did nothing. `run_auto_summary`
keeps the deployment-wide check: what it gates is the stale-channel pre-sync
inside regeneration, not regeneration itself, so a stall there costs slightly
staler input rather than a stopped scheduler.

The guard for this is behavioural, through the real `run_auto_sync` with two
accounts, because a per-owner *answer* consumed as a boolean is the
deployment-wide gate with extra steps — and that mutation passed every other
assertion in the file.

## What code review changed

Four findings, all real, all fixed:

1. **The claim "all four paths" was false.** `auto_summary` is a fifth, and
   deliberately outside the ladder. Documented above, and
   `test_no_new_path_starts_a_sync_outside_the_ladder` walks the AST so a sixth
   is a red test rather than a discovery.
2. **The deployment-wide scheduler gate**, above.
3. **`charge_sync_job` could raise from a `finally`.** Resolving the Budget
   before the `try` — done so the log line could name it — put
   `budget_for_sync_mode`'s `ValueError` outside the swallow, in a function
   called from `sync_queue._process_message`'s `finally`, where it would have
   replaced whatever outcome the sync produced. The lookup is back inside the
   `try` and the log names `sync_mode` instead, which names the Budget just as
   precisely from one line away.
4. **The three new tunables lived in two files with nothing binding them.**
   `test_env_example_matches_defaults.py` compared booleans only, so
   `.env.example` shipping a different allowance would have put every fresh
   install on a different ladder from the code with the suite green — the same
   class as the `TENANCY_ENFORCED=false` template divergence that guard was
   written for. It now compares integers too. All 47 already agreed, so the
   extension cost nothing and closed the gap in one go. Strings stay out:
   `SECRET_KEY=changethis` is *supposed* to disagree.

## Files

- `app/core/config.py` — the three `QUOTA_DEFAULT_*_REQUESTS` settings
- `.env.example` — documents them
- `app/services/quota.py` — `budget_allowance`, `UNLIMITED`
- `app/services/sync_lanes.py` — `tier_for_spend`, `lane_for_spend` (pure)
- `app/jobs/sync_queue.py` — `lane_for_job(job, user_id)` reads the ledger
- `app/services/scraper_jobs.py` — `active_sync_job_owners`
- `app/jobs/auto_sync.py` — the tick's gate becomes per-owner
- `backend/tests/services/test_lane_selection.py` — the guard
- `backend/tests/deployment/test_env_example_matches_defaults.py` — integers too

## Guard

`test_lane_selection.py`, each assertion with the mutation that turns it red:

| Asserts | Mutation |
|---|---|
| an account inside its Budget enqueues onto the normal lane | route everything to best-effort |
| an account over its Budget enqueues onto the best-effort lane | drop the ledger read and always answer normal |
| exhausting one Budget leaves the other two on the normal tier | read the day's total instead of the Budget's row |
| the boundary is `spent >= allowance`, both sides of it | `>` instead of `>=` |
| an allowance of zero is always best-effort and never refuses | treat zero as unlimited |
| a negative allowance is unlimited | treat it as a limit of zero |
| the usage read resolves the same owner the charge does | read for the raw `user_id` |
| a ledger read that fails picks the normal lane | let the exception out |
| every lane the selector can name was created by a migration | return a lane name it composes itself |
| the two allowances read two settings | point two Budgets at one setting |
| one account's spend never deprioritises another's | read the day across accounts |
| the read and the charge land on the same ledger row | charge a different day or Budget |
| the shipped defaults are real limits | set one to `UNLIMITED` |
| over-Budget work is **degraded, not dropped** — the real drain runs it | make the drain skip the best-effort tier |
| no new path starts a sync outside the ladder, from the AST | add a `run_sync_job` call anywhere else |
| the exclusivity walk can actually see call sites | the four enqueueing modules, as a control |
| one account's queued backlog leaves another's tick alone | gate `run_auto_sync` deployment-wide again |
| the tick still refuses to stack a second batch on a busy account | drop the gate entirely |

Twenty-two mutations, twenty-two red.

`test_sync_lanes.py`'s strict-tier assertions and `test_lane_draining.py`'s
real-load ones already cover checkbox 3 ("best-effort runs only when normal work
is idle"); this ticket adds the selector in front of them, not a second copy of
the drain policy. The one thing it does add on that side is the *composition* —
the real drain over a real best-effort message — because "degraded" and
"silently discarded" look identical from the enqueue side and only one of them
is what the ticket promised.

The ticket's other sentence, that an account over its Budget still receives
Posts from Channels other people sync, needs no code and no new assertion:
`Post` is follow-scoped corpus, so a Channel synced by anyone is readable by
everyone who follows it, and `test_post_tenancy_scoping.py` is where that is
enforced. Lane selection does not touch it.
