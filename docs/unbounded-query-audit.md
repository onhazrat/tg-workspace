# Unbounded query audit

**Date:** 2026-07-21
**Scope:** every `.all()` in `backend/app/services/`, plus every `GET` route.

Satisfies acceptance criteria 1 and 2 of `docs/architecture-remediation-plan.md`
§12. Re-run the sweep with:

```bash
grep -rn "\.all()" backend/app/services/
```

Any new hit must be added here with a justification, or bounded.

---

## 1. Fixed as part of this audit

Four sites loaded every matching row into Python before deleting or counting it
— the same shape that drove worker RSS to 3.09 GB on staging. **None of them
had any test coverage**, which is why converting them did not move the suite;
`backend/tests/services/test_bulk_deletes.py` now covers them.

| Site | Was | Now |
|---|---|---|
| `channels.py::delete_channel` | `select(Post).where(channel)` → ORM-delete per row | single `sa_delete` |
| `post_sync_state.py::clear_channel_sync_state` | same shape | `sa_delete` + `rowcount` |
| `post_sync_state.py::prune_sync_state_below` | same shape | `sa_delete` + `rowcount` |
| `bulk_channels.py::_clear_channel_posts` | loaded every post only to `len()` it; deletes were already bulk | `SELECT count(*)` |

---

## 2. Remaining `.all()` hits — all justified

### Bounded by an explicit LIMIT

These sit on a statement that already carries `.limit()`, so the `.all()` can
only ever materialise one page.

| Site | Bound |
|---|---|
| `posts.py::list_posts` | `MAX_POST_PAGE_SIZE` (5000) |
| `posts.py::lookup_posts` | `MAX_POST_LOOKUP_BATCH` (200), enforced in the request model |
| `logs.py::_list_logs_page` | `MAX_LOG_PAGE_SIZE` (5000) |
| `summaries.py::list_summaries` | `MAX_SUMMARY_PAGE_SIZE` (2000) |
| `tag_runs.py::list_tag_runs` | `MAX_TAG_RUN_PAGE_SIZE` (1000) |
| `data_vectors.py::list_translations` | `MAX_VECTOR_PAGE_SIZE` (5000) |
| `embeddings.py` backfill | caller-supplied `limit` |
| `sync_orchestrator.py:742` | `.limit(20)` — language sample |
| `sync_orchestrator.py:779` | `.limit(100)` — velocity window |

### Bounded by channel count

Roughly 962 rows on staging, growing only when an operator follows a channel —
orders of magnitude below post/log scale. Acceptable today; revisit if the
channel list reaches five figures.

`channels.py::list_channels`, `channels.py::update_channel_coverage` (anchors
for one channel), `discover.py` followed-set, `operator.py` channel scoping,
`sync_orchestrator.py:670`, `data_import_export.py:350`,
`channel_setting_groups.py` (several — group membership).

### Genuinely small config tables

One row per configured item; these are settings, not data.

`credentials.py::list_bot_credentials`, `credentials.py::list_chat_destinations`,
`sync_meta.py` (one row per resource name),
`channel_setting_groups.py::load_groups_by_id`.

### Aggregates, not row fetches

`channels.py::_fetch_channel_aggregates` and
`_fetch_recent_timestamps_by_channel` return `GROUP BY` / windowed results, one
row per channel, not the underlying posts. Called out as an already-correct
precedent in `docs/frontend-backend-boundary-audit.md`.

### Bounded by an IN list the caller controls

`post_sync_state.py::_stored_post_ids` and
`prune_sync_state_for_post_ids` take an explicit `post_ids` list, sized by the
page being processed.

---

## 3. `GET` routes: bounded?

| Route | Bound |
|---|---|
| `/data/posts` | `limit`/`offset`, default 500, cap 5000 |
| `/data/summaries` | `limit`/`offset`, default 200, cap 2000, light projection |
| `/data/tag-runs` | `limit`/`offset`, default 100, cap 1000, light projection |
| `/data/translations` | `limit`/`offset`, default 500, cap 5000 |
| `/data/publish-logs`, `/sync-logs`, `/llm-logs`, `/embedding-logs`, `/network-logs` | `limit`/`offset`, default 500, cap 5000 |
| `/data/discover/candidates` | aggregate only; rows streamed with `yield_per` |
| `/data/channels/{id}/stats`, `/data/stats`, `/data/table-sizes` | aggregates |
| `/data/summaries/{id}`, `/data/tag-runs/{id}`, `/data/translations/one` | single row |

### Documented exceptions

- **`GET /data/export`** — deliberately unbounded and **streamed**
  (`stream_export_data`). This is the one endpoint where "give me everything"
  is the point; it never materialises the full set.
- **`GET /data/channels`** — unbounded, ~962 rows. Bounded by channel count
  rather than data growth. `docs/architecture-remediation-plan.md` T4.3 calls
  server-side channel filtering the least urgent item in its phase and asks for
  a measurement first. Left as-is deliberately.
- **`GET /data/bot-credentials`, `GET /data/chat-destinations`** — unbounded,
  but one row per configured bot/destination. Config tables.

---

## 4. Related follow-ups

- `IDEA-010` — a shared paginated-list helper. The pattern is now written out
  five times; this duplication is why the `stats.py` bulk-delete fix never
  reached `logs.py`, and why the four sites in §1 stayed unconverted.
- `IDEA-009` — pgvector, which would remove the RAG scan cap entirely.
