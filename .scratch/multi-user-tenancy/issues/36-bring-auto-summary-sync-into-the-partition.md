# 36. One concurrency owner: fan `run_sync_job` out over the partition

**Status:** ready-for-agent
**Blocked by:** None (can start immediately)

**What to build:** The proxy partition is the only thing that decides how many
Channels this process scrapes at once, so `syncConcurrency` describes the whole
of the worker's outbound load rather than one half of it.

## What is open

There are **two independent answers** to "how many Channels may this process
scrape at once", they read the same setting, and they add.

- **The drain loop** takes a bound worker from the partition per message
  (`sync_queue.py:1264`, `partition.acquire(...)`) and runs one
  `sync_single_channel` under it. Ticket 13's design: one worker per proxy lane
  slot, pinned for the whole message, so a walk never hops proxies.
- **`run_sync_job`** opens its own `asyncio.Semaphore(concurrency)`
  (`sync_orchestrator.py:2127`) and `gather`s every Channel in the job under it.
  Those fetches are dealt no worker, so each one picks a lane freely, page by
  page — the hopping ticket 13 removed, still live on this path.

`sync_queue.py:25` already states the rule this ticket enforces: *"Concurrency
belongs to the worker, not to the job."* It was applied to the queue path and not
to `run_sync_job`, which still sizes a semaphore per job.

**The codebase already documents the consequence.** `_run_whole_job`'s docstring
(`sync_queue.py:977`) says it holds its partition permit while `run_sync_job`
opens a semaphore "sized to the same `syncConcurrency` and so is not limited by
ours", so the worker runs **`2N` scrapes against Telegram instead of `2N - 1`** —
and adds, correctly, *"Neither number is good."* That note is the bug report; this
ticket is the fix.

## Three callers, one defect

`RUN_SYNC_JOB_CALLERS` in `tests/services/test_lane_selection.py` declares every
path that starts a sync outside `enqueue_sync_job`. All three have this defect,
and the first cut of this ticket named only the second:

1. **`sync_queue._run_whole_job`** — the pre-ticket-10 message shape, holding a
   permit around a job that ignores it. Its own docstring calls it "live only for
   the messages in flight across one deploy". Many deploys have passed.
2. **`auto_summary._sync_channels_for_summary`** (`auto_summary.py:167`) — needs
   the sync finished before it can summarise.
3. **`bulk_follow.run_follow_job`**'s probe phase — the same exception in the
   same words, metered and charged to `manual_bulk`.

Fixing `auto_summary` alone leaves two paths doing the identical thing.

## The design, and it is decided

**`run_sync_job` stops owning concurrency.** It keeps what only it can do — open
the quota meter and charge once at completion (decision 19) — and its fan-out
becomes the same acquire-a-worker-per-Channel loop the drain uses, so
`sync_single_channel` always runs under a bound worker whatever started it. The
`asyncio.Semaphore` goes away, because the partition is then the single gate and
a second one can only disagree with it.

Consequences to expect rather than discover:

- **Throughput on these paths becomes honest.** With no proxies configured the
  partition is `syncConcurrency` direct workers, which is what the semaphore was
  approximating. With proxies, a path that used to run `N` unbound scrapes now
  competes for the same `N` workers as lane traffic — a **reduction** in peak
  concurrency, and the point rather than a regression. Ticket 13: "capacity
  honestly reflects available proxies."
- **`_run_whole_job` should go rather than be converted.** It exists for messages
  written before ticket 10 deployed. If the ticket keeps it, its permit-holding
  docstring has to be rewritten; deleting it is cleaner and needs an argument
  that no such message can still be queued.
- **No deadlock.** These callers acquire workers and hold nothing the drain
  needs, so a full partition means waiting, not a cycle. `partition.acquire`
  already takes a timeout and answers `None`; the parked-versus-busy distinction
  in `capacity_report()` is the existing vocabulary for reporting it.

## The option that lost, and why

**Enqueue onto a lane and await the job's completion.** It is the tidier story —
one path for everything, and the machinery exists (`_finalize_if_complete`,
`pg_notify`). It is rejected for a reason that is about behaviour, not effort:

**A lane subjects the work to the tier ladder.** Ticket 23 puts an over-Budget
account's syncs on a best-effort lane, served only when every normal lane is
empty. `auto_summary`'s sync is a *prerequisite* for a scheduled summary, so
deprioritising it means the summary regenerates on stale input or the job waits
indefinitely — a behaviour change nobody asked for, introduced while fixing a
concurrency-accounting bug. The same applies to bulk follow's probe phase, whose
whole purpose is resolving handles the person is waiting on.

The secondary reason is the shape ticket 11 already paid for: a waiter that holds
what the drain needs is a deadlock, and `SyncSlot.released()` exists because that
was got wrong once. Awaiting job completion from inside the worker process
reintroduces exactly that question.

Ticket 24's per-Channel `assert_within_ceiling` already reaches all three paths,
so they are bounded in *volume* today. This ticket is about which worker performs
the work, which the ceiling says nothing about.

## Checkboxes

- [ ] `run_sync_job` fans out by acquiring a partition worker per Channel; the `asyncio.Semaphore` is gone
- [ ] All three declared callers run under bound workers, not just `auto_summary`
- [ ] `_run_whole_job` is deleted, or kept with a written argument for why a pre-ticket-10 message can still be queued
- [ ] A guard proves the process's total Channel concurrency is the partition's width — asserted with a non-lane path running, since that is the case that used to add
- [ ] A bound walk started by `auto_summary` does not hop proxies, the property `test_proxy_worker_partition.py` already asserts for lane work
- [ ] `sync_queue.py:47` no longer claims ticket 13 made this stop mattering, and is deleted rather than re-pointed at a future ticket
- [ ] `sync_queue.py:977`'s `2N` note goes with the behaviour it describes
- [ ] `RUN_SYNC_JOB_CALLERS` reasons are rewritten or the guard is retired, whichever the new shape makes true
- [ ] `test_worker_count.py` and `test_proxy_worker_partition.py` stay green

## Not in scope

The quota ladder still cannot see these paths, and that stays true: they are on
no lane, so there is no tier to choose. This ticket makes them share the worker
budget, not the ladder. Lane selection is ticket 23's and is done.
