# 13: One worker per proxy

**What to build:** Each worker owns one proxy and holds a long-lived connection to it, so the rate any one proxy sees is predictable and capacity honestly reflects available proxies.

**Blocked by:** 10

**Status:** done

- [x] Worker count derives from proxy count
- [x] A worker whose proxy is in cooldown parks until it recovers
- [x] The shared per-proxy concurrency gate is replaced by partitioning
- [x] The worker-count guard is updated to assert the reasons that remain, not deleted

## Comments

**Implemented.** Plan and full argument: `docs/one-worker-per-proxy-plan.md`.
Guards: `backend/tests/services/test_proxy_worker_partition.py` (new) and
`backend/tests/deployment/test_worker_count.py` (reason 3 reshaped, not
deleted). Sixteen mutations were applied and each watched going red.

Four decisions worth carrying forward, because a later ticket will want to
revisit them:

1. **"Worker" is an in-process scraping slot, not an OS process.** Compose
   replicas cannot derive from a database setting, and the reading that makes
   the ticket's other three checkboxes cohere is the partition — `sync_queue`'s
   own docstring already named this ticket as what makes
   `auto_summary._sync_channels_for_summary`'s separate semaphore stop
   mattering, which only happens if the cap is a process-wide structure both
   paths go through.
2. **The gate that was replaced is `sync_queue._concurrency_gate`**, the single
   `syncConcurrency` semaphore. The per-lane semaphores in `proxy_pool` stay:
   they bound *all* proxied traffic, including publish, thumbnails and the
   probe sweep, none of which has a worker.
3. **The sync tier is still one replica.** The partition is per-process, so
   the third reason for the pin survives with a different shape. Step 3 of
   `docs/scaling-to-multiple-workers.md` is now partly done, and the natural
   seam if it ever has to finish is a *claim* on which proxies a process owns,
   in ticket 11's shape, rather than a shared token bucket.
4. **No fallback when a bound proxy fails.** Argued in the plan: hopping is
   what turns one bad proxy into several, and honest capacity means throughput
   drops when a proxy dies. Ticket 14 (adaptive per-proxy wait) inherits a
   world where a walk stays on one proxy, which is what makes per-proxy wait
   state meaningful in the first place.

**One thing ticket 14 should know:** `_NO_HEALTHY_WORKER_WAIT_SECONDS` (5s) is
how long a drain waits before concluding every proxy is parked. If ticket 14
introduces longer deliberate waits per proxy, that constant is the one to
re-derive rather than leave as a literal.
