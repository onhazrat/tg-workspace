# #107 🐛 Run one worker, and record what has to change before that can rise

**State:** merged 2026-08-19 · **Branch:** `perf/single-worker` into `main` · **Diff:** +261 / -2 across 4 files · **Opened:** 2026-08-19

---

Closes the deviation found in #105. The image ran `fastapi run --workers 4` — the FastAPI template default, never reconciled with the in-process scheduler added later — so four APSchedulers ticked in parallel: four `Auto Sync (scheduler)` jobs per tick, four workers scraping the same channels, 4× every scheduled job, and 711 job rows stranded in `running`.

## The guard asserts the reason, not the number

The plan is to serve many users, so "keep this at 1" would rot the first time someone needs capacity. `tests/deployment/test_worker_count.py` pins the count **and** the three pieces of per-process state that make >1 wrong:

| state | what breaks with N workers |
|---|---|
| job registry (`scraper_jobs`) | `has_active_sync_job()` sees 1/N of reality; SSE progress only live on the owning worker |
| proxy semaphores (`proxy_pool`) | **N × the intended request rate at Telegram** |
| the scheduler | every scheduled job fires N times |

Externalise any of them and the guard fails **deliberately** — the message names which step is done and points at the plan. Five mutations watched go red, two of them in the "step completed" direction rather than the regression direction:

- `--workers 4` → red
- `--workers` flag removed entirely → **green** (still one worker; correct)
- plan doc missing → red
- proxy semaphore externalised → red, *"step 3 is done"*
- scheduler moved out of the API process → red, *"revisit this guard and the Dockerfile together"*

## The way out: two tiers, opposite scaling rules

`docs/scaling-to-multiple-workers.md`. The key insight is that the two halves of this system scale differently:

- **API tier** — N replicas, stateless, grows with users.
- **Sync tier** — 1 replica, because it is bounded by how fast we may politely hit `t.me` through a fixed proxy set. **That budget does not grow with user count.**

Sequence, each step independently shippable and leaving the system correct:

1. **Progress fan-out over Postgres `LISTEN`/`NOTIFY`** — no new infrastructure; keep the in-memory path as the same-process fast path so nothing regresses while it lands.
2. **Database-backed job claim** (`FOR UPDATE SKIP LOCKED` or advisory locks per channel) — also fixes the 711 stranded rows, since a claim that can expire is one that can be reconciled.
3. **Share or single-own the proxy budget** — recommendation is single-own: a distributed rate limiter is a problem you don't have to have.
4. **Split the tiers, scale the API.** By then a compose change rather than a redesign.

Explicitly warned against in the doc: raising `--workers` for capacity before step 3 (adds duplicate work and quadruples the request rate at Telegram, not throughput), and adding a distributed lock so one of N API workers owns the scheduler (fixes only the tick, leaves SSE and dedup broken, and adds a "lock holder died, nothing is scheduled" failure mode).

## Verification

987 passed, 2 skipped; mypy/ruff/ty clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
