# #147 🔀 One worker per proxy, bound dispatch, parking (ticket 13)

**State:** merged 2026-08-27 · **Branch:** `worktree-ticket-13-one-worker-per-proxy` into `main` · **Diff:** +1639 / -163 across 13 files · **Opened:** 2026-08-27

---

Closes ticket 13 (`.scratch/multi-user-tenancy/issues/13-one-worker-per-proxy.md`). Step 3 of `docs/scaling-to-multiple-workers.md`, partly.

## What changed

The queue consumer held one `asyncio.Semaphore` sized `min(syncConcurrency, total lane slots)`. It said how many Channels could be walked at once and **nothing about which proxy any of them used** — so a Channel's backward walk hopped proxies page by page, and a burst of syncs piled onto whichever lane happened to be least loaded at that instant.

It is now a partition: one worker per proxy lane slot, pinned to its proxy for the whole of one message, dealt **round-robin across lanes** so `syncConcurrency` below capacity spreads over distinct proxies instead of stacking three workers on the first one. With no proxies configured the partition is `syncConcurrency` direct workers — the old behaviour exactly, so a proxy-less deployment notices nothing.

The proxy reaches the HTTP client by `contextvar`, for `core/request_meter.py`'s reason: `sync_orchestrator` and `scraper` sit in between and read neither. It binds the **slot**, not the worker — a coalesced waiter puts its worker down and may take a different one back, and a captured worker would leave the walk fetching through a proxy that by then belongs to another message.

## Decisions worth reviewing

**"Worker" is an in-process scraping slot, not an OS process.** Compose replicas cannot derive from a database setting, and the reading that makes the other three checkboxes cohere is the partition.

**A bound worker never hops, not even on retry.** Hopping moves a dead proxy's load onto the healthy ones exactly when Telegram is already pushing back — that is how one rate-limited egress becomes a rate-limited set. "Capacity honestly reflects available proxies" requires throughput to *drop* when a proxy dies. The Channel is not lost: it fails this pass, and the next sweep hands it to a worker whose proxy works.

**The sync tier is still one replica.** The partition is built from process-local state, so two replicas would each own every proxy. Reason 3 in `test_worker_count.py` survives with a different shape, and the assertion that no longer holds is inverted rather than deleted — ticket 11's rule.

**No runtime-config `parked` field.** Cooldown lives in `network._bad_proxies`, which is process-local, and `/jobs/runtime-config` is served by the API — so that flag could never be true. `effectiveProxyCapacity` and `allowedConcurrency` already carry the width. Parking is logged where it is true.

## Guards

New: `backend/tests/services/test_proxy_worker_partition.py` (18 tests). Reshaped: `test_worker_count.py`. Ticket 12's 21 draining guards pass against the partition unchanged in intent.

**19 mutations were applied and each watched going red.** The first pass had four guards that could not fail — the contextvar test had its two tasks overlapping the wrong way round, the slot-swap test asserted nothing about the call site the mutation changes, one asserted an ordering that is unobservable on a single-threaded loop, and the all-parked drain path had no guard at all. A `test_worker_count` assertion also passed on its own docstring, which is the substring trap that file documents.

## Review round

`/code-review high` found six issues; four were real and are fixed here: an unbounded lane-permit wait in `hold()` (now bounded like `acquire()`), a misfiring "all proxies parked" diagnostic (now reports the busy/parked breakdown), a units bug counting parked *proxies* as parked *workers* in the capacity log line, and a claim that this ticket closed `auto_summary`'s separate semaphore — it does not, and that is now corrected in all four places I had written it. The fifth was CLAUDE.md nesting, fixed. The sixth (a 404 arming a proxy cooldown) is pre-existing and handed to ticket 14 with the analysis.

## Verification

mypy, `ty`, ruff clean. Full backend suite: **1799 passed, 2 skipped**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V9riPSB6h5MZiobAecDx1Z
