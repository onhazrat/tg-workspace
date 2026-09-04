# #105 🐛 Close the auto-sync planning transaction before the sync runs

**State:** merged 2026-08-19 · **Branch:** `perf/auto-sync-session-scope` into `main` · **Diff:** +343 / -57 across 4 files · **Opened:** 2026-08-19

---

Follow-up to #104, which deliberately left the `tg_channels` UPDATEs undiagnosed. This is the answer, and it was neither of the obvious candidates.

## It is not a slow statement, and it is not a lock

**The distribution, not the mean.** `min_exec_time` is **0 ms** for every one of these and `max_exec_time` is 10–21 s, with stddev ~5× the mean. They are instant except for rare multi-second stalls. That also disposes of the "rarer statement, higher mean" pattern I flagged in #104 — a rare statement has fewer samples to dilute one 21-second outlier.

**Nothing is lock-blocked.** `pg_stat_activity` sampled every 2 s for two minutes: `pg_blocking_pids` empty on every row.

**Autovacuum is running constantly and reclaiming nothing:**

| table | live | dead | autovacuums | size |
|---|---:|---:|---:|---|
| `tg_sync_meta` | 10 | **4,743** | 1,062 | 1,360 kB |
| `tg_channels` | 2,077 | **4,498** | 619 | 19 MB |

A ten-row table with 4,743 dead tuples after a thousand autovacuums means the xmin horizon is pinned. It was:

```
age_s | state               | query
  283 | idle in transaction | SELECT wanted.name, newest.timestamp FROM ...
  283 | idle in transaction | SELECT wanted.name, newest.timestamp FROM ...
  283 | idle in transaction | SELECT wanted.name, newest.timestamp FROM ...
  283 | idle in transaction | SELECT wanted.name, newest.timestamp FROM ...
```

Four transactions open for minutes; every other connection under 2 s. `run_auto_sync` planned *and* synced inside one `with Session(engine)`. The UPDATEs were not waiting on anything — they were walking pages full of tuples that could not be reclaimed.

## The fix is scope, not SQL

Read what the decision needs, project it to plain values, close the session, then sync. Nothing after the block may hold an ORM row, so `entries` is `(id, name)` tuples rather than `Channel`s: a detached instance raises *inside the scheduler thread*, where the only symptom is "auto-sync quietly stopped".

Four guards, each mutation-tested until red:
1. no transaction open when the sync begins;
2. the planner really did query first — a `run_auto_sync` that opened no session would pass (1) perfectly, and does fail this;
3. the plan survives its session (names and `dueReason` still present);
4. a source-level check that `to_sync`/`due_channels`/`partial_batch` are unreachable after the block.

## Why *four*, and what is left for you

The image runs **`fastapi run --workers 4`** (`backend/Dockerfile:45`, inherited from the template and never revisited). Each worker runs its own in-process APScheduler, against `CLAUDE.md`/ADR-004:

> **Scheduler runs in-process, single replica.** Do **not** scale the backend horizontally without external job coordination.

Confirmed — four `Auto Sync (scheduler)` jobs created within 38 ms, every tick, as far back as the log goes:

```
10:42:26 | 4 | running
10:38:12 | 4 | running
10:31:12 | 3 | completed
10:31:11 | 1 | completed
```

This multiplied every number in #104 by four. `has_active_sync_job()` reads an in-process dict, so it cannot deduplicate across workers — all four scrape the same channels concurrently. It also explains 711 rows stranded in `running` (and 48 `pending`) since June: in-memory job state is lost on restart and nothing reconciles the rows.

**Left out deliberately** — one worker, a scheduler gated to one worker, or a separate single-replica scheduler service are materially different deployment shapes, and that is your call. Recorded in `CLAUDE.md` and `docs/scheduler-db-cost-plan.md`.

## Verification

980 passed, 2 skipped; mypy/ruff/ty clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
