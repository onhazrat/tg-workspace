# Directory: Priority boost, and sort and filter on every column

Settled in a grilling session on 2026-10-17. Terms are in `CONTEXT.md`:
**Priority boost**, **Time bound**.

## Priority boost

- New column `tg_channel_directory.priority_boost`, integer, default `0` for
  every row, `NOT NULL`.
- It moves **probe order only**. It never ranks, sorts or hides anything in the
  Directory list.
- Positive means sooner. Effective priority is `priority - priority_boost`, and
  `dequeue_handles` orders by it (then `handle`).
- Plain arithmetic, no special case: a large enough boost can beat
  `RECHECK_PRIORITY`. The common use is reordering inside one band (e.g. `+1` on
  some `REFRESH` rows puts their refresh ahead of every other refresh and still
  behind every never-probed handle).
- Permanent. No writer touches it: probes, refreshes, rechecks and
  `record_sync_metadata` rewrite `priority` and leave the boost alone. That is
  the reason it is a separate column rather than an edit to `priority`.
- Range `±1,000,000,000`. An `add` that would cross it is refused with 422,
  never clamped. (`priority` is int4, so the difference cannot overflow.)
- Stored generated column `effective_priority = priority - priority_boost`,
  indexed on `(status, effective_priority)` **in place of**
  `ix_tg_channel_directory_queue`. It is also a visible, sortable internal
  column.
- Gated by `DATA_ADMIN`. `priority_boost` and `effective_priority` are internal
  columns, like `priority`.
- Set from the Directory tab two ways: a bulk action over Ticked entries
  offering **Set to N** and **Add N**, and a field in the entry panel. No inline
  cell editing.
- No attribution (`boosted_by`/`boosted_at`). Add it when a second `DATA_ADMIN`
  holder needs to ask who set one.
- Not carried by export or import, like the rest of `DirectoryEntry` (corpus).

## What the Operator sees

- `DATA_ADMIN` callers drop the `kind = 'channel'` restriction (`_listed()`), so
  bots, groups, users and unprobed handles appear. Everyone else keeps it.
- The opening filter stays `not is:followed and not is:dismissed and
  is:followable`, so the default view is `status = ok` as today.
- The search box (`tg_channel_directory_search`) stays channel-only. Unlisted
  rows are found by the Name Condition, not by bio or sample-post search.

## Sort and filter on every column

The set is the DCOL catalogue plus `kind`, `priority_boost` and
`effective_priority`. Internal columns are refused (422) as a sort or a
Condition to a caller without `DATA_ADMIN`, and the UI never offers them.

| Column type | Columns | Condition | Sort |
|---|---|---|---|
| Numbers | the 12 existing measures, `sample_count`, `attempts`, `latest_id`, `telegram_chat_id`, `priority`, `priority_boost`, `effective_priority` | existing numeric bound (`min = max` for an exact id) | numeric |
| Enums | `status`, `kind` | new "is" Condition, OR through the grammar | alphabetical |
| Language | `language` | existing Language Condition | by code (new) |
| Text | `bio` | existing search `bio` field, no new Condition | alphabetical |
| Text | `last_error` | new case-insensitive "contains" | alphabetical |
| Moments | `last_post_at`, `created_at`, `checked_at`, `attempted_at`, `retry_after`, `refresh_due_at` | **Time bound** | by timestamp |

## Time bound

- A Condition on one of the six moments. **Live** (ends are offsets from now)
  or **Fixed** (ends are exact instants), toggled like the Posts tab's Analysis
  window. Either end may be open.
- Live offsets are signed ms from now: each end reads "N ago" or "in N", so
  `refresh_due_at` can ask "due within the next 2 days".
- `[start, end)`, exact to the minute, as the Analysis window.
- Stored and computed in UTC. Shown and picked in the viewer's time zone; a
  Fixed end is sent and written into the URL as an ISO UTC instant
  (`checked_at 2026-10-01T00:00Z..`).
- Live bounds resolve on the **server's** clock at query time, so a shared link
  means the same to every viewer.
- An entry with no value fails the bound; the existing "has no value" switch
  still asks for those rows.
- Every Time bound editor draws a histogram; `/directory/distribution` learns to
  bucket a timestamp.

## Breaking changes, deliberately

- `last_post_days` and `found_days` are **renamed** to `last_post_at` and
  `created_at` everywhere: filter syntax, DCOL column ids, `?dirSort=`. The old
  filter syntax stops parsing. The migration rewrites the stored column-defaults
  row so the Operator's choice survives.
- When `?dirFilter=` does not parse, the tab opens on the opening filter **and
  shows a dismissible notice** ("This link's filter could not be read and was
  reset") instead of resetting silently as `useDirectory.ts` does today.

## Open measurement

- No indexes beyond `effective_priority`'s. Measure the new sorts on the staging
  copy and index only what proves slow (staging disk is at 91%).
