# #173 📐 Design the egress seam and rewrite ticket 36 (ADR-012)

**State:** merged 2026-09-03 · **Branch:** `ticket-36-egress-seam-design` into `main` · **Diff:** +547 / -107 across 4 files · **Opened:** 2026-09-03

---

Ticket 36 was "one concurrency owner: fan `run_sync_job` out over the partition". Reading the code found three of its claims wrong: there are two `run_sync_job` callers rather than three, the legacy path does not hop proxies, and double-counted concurrency and proxy hopping are two defects with different victims rather than one.

The real problem is wider and simpler to state. Eleven code paths reach Telegram or a proxy; `bound_to` appears in exactly one place. Three separate defects come out of that: the avatar cache fetched over the real IP on Tor deployments while its twin routed through the lane pool and said why, three routes let the request body name its own egress, and `run_sync_job` opened a semaphore beside the partition so the worker ran 2N scrapes.

ADR-012 records the decision: every request to Telegram leaves through an acquired Lane, enforced by a runtime raise plus an inventory of exemptions with reasons. The seam is the Lane, not the queue, so interactive routes stay synchronous. `syncConcurrency` is deleted, since Telegram meters the unauthenticated web view by IP and a hand-set ceiling of 3 threw away most of a proxy fleet; the database pool now derives from the partition width instead of silently capping it.

The plan doc carries fifteen decisions, each with the alternative that lost. `CONTEXT.md` gains Lane, Slot, Partition and Sync worker, because unqualified "worker" meant both a process and a scraping permit.

Staging verified for the `_run_whole_job` deletion: `pgmq.meta` dates ticket 09's lane 8.6 hours before ticket 10's migration, all six live lanes are empty, and 229,759 archived messages contain none with a null `channelId`.

Docs only. No code changes.


Claude-Session: https://claude.ai/code/session_01HshgQsaoT1mCRB2A77MM6e
