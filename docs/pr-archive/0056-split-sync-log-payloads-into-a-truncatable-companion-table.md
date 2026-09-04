# #56 ♻️ Split sync log payloads into a truncatable companion table

**State:** merged 2026-07-31 · **Branch:** `worktree-sync-log-payloads` into `main` · **Diff:** +784 / -34 across 25 files · **Opened:** 2026-07-31

---

## Why

`tg_sync_logs` is the heaviest table in the schema — `full_response` is ~17KB/row and up to 3MB. It has OOM-killed a staging worker (see the docstring on `backend/tests/api/test_sync_logs_pagination.py`) and it filled the operator box's disk, which is what prompted this.

**Retention could not recover from that.** `jobs/retention.py` issues a bulk `DELETE`, and in PostgreSQL `DELETE` only marks rows dead: autovacuum returns the space to the table's freelist for reuse but never to the operating system. Actually shrinking a table needs `VACUUM FULL`, which rewrites it into a new file and so requires free space roughly equal to the table being rewritten — precisely what is unavailable once logs have filled the disk. So retention bounded future growth while offering no way back from an already-full disk.

Holding the bodies in their own table changes that: `TRUNCATE tg_sync_log_payloads` unlinks the files outright — instant, needs no headroom, and every log row (status, error, counts, timestamps) survives.

## What changed

New `SyncLogPayload` → `tg_sync_log_payloads`, holding `full_request` / `full_response` keyed by the owning log id.

- **No foreign key, deliberately.** The table has to stay droppable and truncatable at any moment, so a missing row reads as "payload no longer retained" rather than a broken log, and the delete paths in `services/logs.py` clean up explicitly instead of via cascade.
- **`timestamp` is denormalised** onto the payload table so retention expires payloads with a single-table bulk `DELETE` instead of joining the whole log table — the same reasoning already documented in `retention.py`.
- **New `payloadRetentionDays`** (default 7) beside `logRetentionDays` (default 30). This is the main prize: a long audit trail stays cheap because the bulk is discarded early. The log sweep also clears payloads at the *log* cutoff, so disabling payload retention (`0` = never) with a finite log window cannot strand orphans.
- **API shape unchanged.** The list and export paths `LEFT JOIN` and re-emit `fullRequest`/`fullResponse`, so the frontend needs no data-shape edits. Payloads still ship inline with a list page, so the existing 500/5000 page caps remain load-bearing and are left alone.
- **Existing payloads are dropped, not migrated** — they are disposable by design, and copying them would need the very headroom this reclaims.

## Operator runbook

Emergency disk reclaim, safe at any time:

```sql
TRUNCATE tg_sync_log_payloads;
```

Sync logs remain fully listable; expanded rows show no request/response until new syncs repopulate them. Full rationale in `docs/sync-log-payload-split-plan.md`.

## Verification

Run locally — CI test workflows are billing-blocked and will not start on this PR.

**Automated**
- `uv run pytest tests/ -q` → **733 passed, 1 skipped** (11 new)
- `bun run --filter tg-summarizer-frontend test:unit` → **679 pass, 0 fail**
- `mypy app` clean · `ruff check` clean · `ruff format --check` clean · `ty check` at its unchanged 31-diagnostic baseline
- `bunx tsc -p tsconfig.build.json --noEmit` clean
- Migration round-trips: `alembic upgrade head` → `downgrade -1` → `upgrade head`
- Client regenerated via `scripts/generate-client.sh`

**End-to-end against local compose** (`docker compose up -d --build db prestart backend`)
- Live schema after prestart: `tg_sync_log_payloads` created with `timestamp bigint` + `ix_..._user_id`; `full_request`/`full_response` gone from `tg_sync_logs`
- Payload round-trips through `POST`/`GET /data/sync-logs`, and through `/data/export`
- **A real channel sync** (`POST /jobs/sync`, 263 posts fetched from t.me) completed `success` and wrote one log row plus a **596 kB** payload row — the exact path that broke originally
- `TRUNCATE tg_sync_log_payloads` → payload table **320 kB → 24 kB**, `tg_sync_logs` unchanged at 48 kB, log row still listing with `status=success posts=263` and null bodies; export still returns it (outer join, not inner)
- Retention job via `POST /jobs/retention/trigger` reported `deletedPayloads: 1` — aged payload reclaimed, its log row kept, fresh payload untouched
- `payloadRetentionDays` persists through `PUT /data/settings/retention` and surfaces in `GET /jobs/runtime-config`

## Note for deploy

`ALTER TABLE ... DROP COLUMN` is metadata-only in PostgreSQL, so the migration is instant, but the bytes of existing payloads stay inside current row versions of `tg_sync_logs` until those rows are rewritten or deleted. Staging's `tg_sync_logs` therefore will not shrink at deploy time — the win applies to new logs, plus the now-truncatable payload table. To reclaim the existing bulk, let retention age the old rows out, or run a `VACUUM FULL` when there is headroom.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
