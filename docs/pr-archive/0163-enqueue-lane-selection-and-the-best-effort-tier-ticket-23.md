# #163 🚦 Enqueue lane selection and the best-effort tier (ticket 23)

**State:** merged 2026-09-01 · **Branch:** `ticket-23-lane-selection` into `main` · **Diff:** +1593 / -82 across 15 files · **Opened:** 2026-09-01

---

Ticket 23. Ticket 08 built the measurement and said the numbers it needed were a guess until there was a week of them. There is now a week of them, so this is where the ledger becomes a decision.

An account inside its Budget enqueues onto that Budget's normal lane; over it, onto that Budget's best-effort lane. Its other two Budgets are untouched. Nothing is refused — the ceiling is ticket 24's.

## Shape

The seam is `enqueue_sync_job`, one function, because every path that *enqueues* a sync goes through it and guarding a caller leaves the next caller unguarded. `lane_for_job(job, user_id)` grew the ledger read; `sync_lanes.tier_for_spend` is the ladder and stays a pure transform; `quota.budget_allowance` owns the three limits.

**`spent >= allowance`, and the `>=` is load-bearing.** It makes an allowance of zero mean "always best-effort, never blocked" (decision 18) by arithmetic rather than by a special case, so ticket 24's fifth checkbox is already true. A `>` would hand a zero-Budget account one batch a day at normal priority. Negative means unlimited — the operator's escape hatch, and the one value that cannot collide with a real limit.

**The defaults are real numbers off this deployment's own ledger.** `auto_sync` 10,000, `manual_bulk` 3,000, `manual_single` 1,000, against observed daily spends of 22,500–33,700, 150–1,130 and 1–410. `auto_sync` sits *below* what the operator spends on purpose: an account following ~2,000 channels is the shape the best-effort tier exists for, and a default nobody crosses is a mechanism with no caller. They are `QUOTA_DEFAULT_*_REQUESTS` deployment configuration; the Admin-settable default and the per-User override are ticket 24's.

**The tier is chosen once per enqueue call, for the whole batch.** Choosing per message would mean projecting the spend of a sync that has not happened, and one sync is between one Request and fifty. So a batch enqueued while an account is inside its Budget runs entirely at normal priority however far past the line it goes, and the ladder meets it on the next enqueue. The ceiling bounding that is ticket 24's.

**Usage is read for the account that will be charged**, through the same `resolve_charge_owner` the charge uses. An ownerless enqueue and an id naming a deleted account both resolve to the operator; reading the raw id would let either run at normal priority for ever while the operator paid. **A failed ledger read picks the normal lane** — nothing is refused at this rung, so being wrong costs one batch at the wrong priority against taking the sync path down over a transient error.

## Two syncs the ladder cannot reach

`auto_summary._sync_stale_channels` and `bulk_follow.run_follow_job`'s probe phase call inline rather than enqueueing, so they are on no lane and there is no tier to give them. Both predate this ticket; both are declared in `RUN_SYNC_JOB_CALLERS` with reasons, and an undeclared third fails an AST guard. A ceiling can refuse either, because a refusal needs no lane — ticket 24's.

## The two questions ticket 08 left

- `charge_sync_job` keeps swallowing its failures, with the reasoning written down instead of flagged: it runs after the posts are committed, so raising would report an accounting problem by failing a sync that worked.
- **`jobs/discover_probe.py` stays uncharged**, and the question is closed. It enqueues onto no lane, so the ladder cannot deprioritize it, and the probe queue is corpus-scoped deployment background work — billing one account for it would make that account's Budget a proxy for deployment load, which is what decision 16 split the Budgets to stop.

## What code review changed

Four findings, all real, all fixed — the second is the expensive one:

1. The "all four paths" claim was false (`auto_summary` is a fifth), now documented and guarded from the AST.
2. **`run_auto_sync` gated its whole tick on the deployment-wide `has_active_sync_job()`.** Bounded before this ticket, because auto-sync always held weight 1 in the round-robin. Not bounded after it: an account over its Budget sits on a tier served only when every normal lane is empty, so its non-terminal job stopped *every* account's scheduler, and the daily reset was no rescue since a message's lane is fixed at enqueue. It is `active_sync_job_owners()` now, and it filters rather than returning.
3. `charge_sync_job` could raise from a `finally` — the Budget lookup is back inside the `try`.
4. `test_env_example_matches_defaults.py` compared booleans only, so a template shipping a different allowance would reconfigure every fresh install with the suite green. It compares integers too; all 47 already agreed.

## Guard

`backend/tests/services/test_lane_selection.py` — twenty-two mutations, twenty-two red. Two survived the first cut and are why the last two guards exist: a per-owner answer consumed as a boolean passed everything else in the file, and a name reference is not a call.

Full backend suite green (2014 passed, 3 skipped). Plan: `docs/quota-lane-selection-plan.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_012iMsKYpNFAnrLdXtqNfrR3
