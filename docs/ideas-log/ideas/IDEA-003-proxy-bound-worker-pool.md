# IDEA-003: Proxy-bound worker pool

| Field | Value |
|-------|-------|
| **Id** | IDEA-003 |
| **Status** | done |
| **Added** | 2026-06-22 |
| **Completed** | 2026-06-22 |
| **Priority** | high |
| **Area** | backend / network |

## Problem

Proxied HTTP traffic used random per-attempt proxy selection. Multiple concurrent sync channels could hit the same proxy IP at once, increasing rate-limit risk and making operator tuning (`syncConcurrency` vs proxy count) opaque.

## Solution

Per-proxy **lane pool** in `backend/app/services/proxy_pool.py`: each resolved proxy gets an `asyncio.Semaphore` with configurable slots (default 1) and a **reused `httpx.AsyncClient`** (connection limits aligned to slot count). All proxied `fetch_with_retry` calls acquire a lane before HTTP and release after. Dispatch picks the least-loaded healthy lane; cooldown proxies are skipped.

Inspired by [Hex Proxies — Python async proxy rotation with httpx](https://hexproxies.com/blog/python-async-proxy-rotation-httpx): one long-lived client per proxy plus semaphore gating, rather than a new client per request.

## Configuration

- `proxyDefaultConcurrency` — network AppSetting + `PROXY_DEFAULT_CONCURRENCY_DEFAULT` env (default 1, clamp 1–20)
- `proxyConcurrencyOverrides` — map of normalized proxy URL → slots
- `syncConcurrency` capped by `compute_proxy_pool_capacity()` when proxies are active
- Runtime diagnostics: `effectiveProxyCapacity`, `proxyLanes` on `GET /jobs/runtime-config`
- Settings UI: default slots + per-proxy override table (Network, advanced)

## Out of scope (follow-ups)

- AIMD dynamic shrink/grow on 429
- Job chunking / Postgres queue
- **Circuit-breaker / weighted proxy pick** (Hex Proxies article) — richer failure scoring beyond per-lane cooldown

## Success criteria

- [x] Lane pool gates all proxied `fetch_with_retry`; direct and `test_proxy` bypass pool
- [x] Sync job concurrency capped by pool capacity
- [x] Settings + runtime-config expose capacity and lane snapshot
- [x] Tests for pool, settings merge, runtime-config fields
