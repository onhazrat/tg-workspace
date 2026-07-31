# Sync log payload split

Move `full_request` / `full_response` off `tg_sync_logs` into a companion table
that can be truncated at any time to reclaim disk without losing the log rows.

## Why

`tg_sync_logs` is the heaviest table in the schema — `full_response` is
~17 KB/row and up to 3 MB. It has already OOM-killed a staging worker (see the
docstring on `backend/tests/api/test_sync_logs_pagination.py`) and has filled
the disk on the operator box.

The existing retention job does not solve this. It issues a bulk `DELETE`, and
in PostgreSQL `DELETE` only marks rows dead: autovacuum returns the space to
the table's freelist for reuse but **never returns it to the operating
system**. Reclaiming actual disk requires `VACUUM FULL`, which rewrites the
table into a new file and therefore needs free space roughly equal to the table
being rewritten — exactly what is missing once logs have filled the disk. So
retention bounds future growth but cannot recover from an already-full disk.

A separate table changes that. `TRUNCATE tg_sync_log_payloads` unlinks the
files outright: instant, needs no headroom, and leaves every log row (status,
error, counts, timestamps) intact. Payloads become the disposable half of a
sync log, and the audit trail survives.

## Decisions (confirmed with the operator)

| Decision | Choice |
| --- | --- |
| Scope | **Sync logs only.** publish/llm/embedding/network keep their inline columns for now. |
| Existing payload data | **Dropped, not migrated.** Payloads are disposable by design and copying needs the disk headroom that is missing. |
| Retention | **Separate, shorter horizon** — new `payloadRetentionDays` (default 7) alongside `logRetentionDays` (default 30). |
| Read path | **LEFT JOIN, API shape unchanged.** `fullRequest`/`fullResponse` stay on the list response; no frontend change. |

The read-path choice means payloads still ship inline with a list page, so the
existing `DEFAULT_LOG_PAGE_SIZE` / `MAX_LOG_PAGE_SIZE` caps in
`app/services/logs.py` remain load-bearing and are deliberately left alone.

## Design

New `SyncLogPayload` (`tg_sync_log_payloads`):

- `sync_log_id` — primary key, the owning `tg_sync_logs.id`.
- `user_id` — indexed, mirrors the sibling log tables for operator scoping.
- `timestamp` — **denormalised** ms epoch. Retention expires payloads on their
  own horizon; carrying the age here keeps that a single-table bulk `DELETE`
  instead of a join against the full log table.
- `full_request`, `full_response` — the JSON bodies.
- `updated_at`.

**No foreign key, deliberately.** The table has to stay droppable and
truncatable at any moment; a missing row means "payload no longer retained",
not a broken log. Cleanup on the delete paths is therefore explicit, in code.

## Work

1. `models_tg.py` — add `SyncLogPayload`; drop the two columns from `SyncLog`.
2. Alembic revision — create the table, drop the two columns.
3. `services/logs.py` — `upsert_sync_log` splits the write; `list_sync_logs`
   outer-joins; `delete_log_by_id` / `clear_logs` / `delete_old_logs` clean up
   payloads for the `sync` type.
4. `services/serialization.py` — `sync_log_to_camel` takes an optional payload
   and re-emits `fullRequest` / `fullResponse` so the API shape is unchanged.
5. `services/data_import_export.py` — export streams the join; import routes
   payload fields back through `upsert_sync_log` (unchanged call shape).
6. `jobs/retention.py` — expire payloads on `payloadRetentionDays`, and also
   sweep payloads at the log cutoff so no orphans survive if the operator sets
   `payloadRetentionDays = 0` (never) with a finite `logRetentionDays`.
7. Settings surface — `RETENTION_PAYLOAD_DAYS_DEFAULT`, `_default_retention`,
   runtime-config schema + service, `env.ts`, `constants.ts`, settings
   `schema.ts`, `SettingsContext`, `RetentionPanel`, `DatabaseManagement`,
   `.env.example`.
8. Tests — payload round-trip through the API, truncate-safety (logs still
   list with null payloads), and the two retention horizons.

## Operator runbook

Emergency disk reclaim, safe at any time:

```sql
TRUNCATE tg_sync_log_payloads;
```

Sync logs remain fully listable; expanded rows show no request/response until
new syncs repopulate them.
