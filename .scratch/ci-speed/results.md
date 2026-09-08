# CI speed results

Record wall-clock after each workstream. Do not invent stretch work once S1–S5 in `plan.md` are met.

## Baseline (2026-09-08, before A)

| Signal | Value |
|---|---|
| Green PR wall-clock | ~12 min |
| Backend | ~9.5 min (2391 passed in 503s) |
| Playwright warm | ~12 min (build ~3 min ×2 + tests 6–8 min) |
| Playwright cold build | 18–20 min on one shard |

## After A (quick wins)

| Signal | Value | Notes |
|---|---|---|
| Backend path filters | shipped | skips docs/frontend-only PRs |
| Coverage `dynamic_context` | removed | HTML artifact main-only |
| Playwright build scope | `backend playwright` only | no host uv/bun/generate-client |
| Measured green wall-clock | _pending CI_ | |

## After B (shared build)

| Signal | Value | Notes |
|---|---|---|
| Measured green wall-clock | _pending_ | |
| Shard build time | _pending_ | expect ~0 |

## After C (4 shards)

| Signal | Value | Notes |
|---|---|---|
| Slowest shard tests | _pending_ | |
| Measured green wall-clock | _pending_ | |

## After D / E

| Signal | Value | Notes |
|---|---|---|
| Backend matrix | _pending / deferred_ | only if backend still > ~6 min |
| Flake inventory | _pending_ | after B removes build noise |
