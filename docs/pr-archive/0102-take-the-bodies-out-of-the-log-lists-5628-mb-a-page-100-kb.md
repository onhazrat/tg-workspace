# #102 ⚡ Take the bodies out of the log lists (56.28 MB a page → ~100 kB)

**State:** merged 2026-08-19 · **Branch:** `fix/log-list-payload-split` into `main` · **Diff:** +1447 / -338 across 25 files · **Opened:** 2026-08-19

---

`GET /data/logs/sync` returned **56.28 MB for one page of 500 rows, 99.7% of it request/response bodies** — in 0.873 s of server time, so entirely transfer. Observed at 43 s from a browser. The first thing `backend/scripts/slow_endpoints.py` turned up.

Two independent wastes, neither visible from inside the container:

- the viewer shows 20 rows and the server ships 500 (`LogsView` slices a list it already fetched), and
- every row carried its bodies, though only an expanded row renders them, and only one row is expanded at a time.

Fixing the second makes the first harmless — 500 rows of metadata is ~100 kB — so no pagination refactor was needed.

`tg_sync_log_payloads` had existed since `y7z8a9b0c1d2`, split off so the bodies could be truncated to reclaim disk. **The list joined them straight back in.** Splitting a table does not help if the read path reassembles it.

## Scope: the family, not just sync

The same defect was in `publish` and `llm`, so the fix is generic: `LOG_HEAVY_COLUMNS` per type, one column-select path shared by all five (sync stops being the special one), and `GET /logs/{type}/{id}` for the row actually opened. Network was measured and left alone — its `telemetry` averages 174 bytes.

Columns are selected explicitly rather than deferred: `defer()` keeps the entity and `model_to_camel` calls `model_dump()`, which would fire one lazy SELECT per deferred column per row. A silent N+1 instead of a big payload is not a fix.

## The search had to move to SQL

The Logs view has a *search in details* checkbox that matched the bodies client-side. With the bodies gone there was nothing left to match, and silently dropping the feature would be worse than the payload. `?search=&searchInDetails=` now does it in Postgres, so `textSent` and the LLM prompt stay **searchable without being shipped** — and over the whole table rather than the page that happened to be fetched.

The client filters keep status, date and the dropdowns, and **must not re-apply the query**: the server matches `fields OR bodies`, so a second pass over fields alone would drop exactly the rows that toggle exists for. Asserted, not just commented.

## Guards

`backend/tests/services/test_log_list_payload_cost.py`, both directions after `client-split.conform.ts`:

- the list must not carry the heavy keys, and the detail route must;
- the sync list SQL must not mention the payload table **at all** — not shipping is not the same as not reading;
- `LOG_HEAVY_COLUMNS` entries must be real columns (a typo would quietly save nothing);
- the list schemas must declare exactly what the query selects, or a field is either fetched then discarded or serialised as an explicit `null`;
- the heavy sets must not be silently empty.

All 7 mutations were watched go red. 955 backend tests and 828 frontend tests pass; mypy, ty, ruff and biome clean.

## Note

Landing as a PR rather than a direct commit because local 1Password signing is failing (`error: 1Password: failed to fill whole buffer`). Squash-merge so GitHub signs the commit that lands on `main`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
