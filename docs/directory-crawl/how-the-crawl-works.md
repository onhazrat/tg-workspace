# How the Directory crawl works

Traced 2026-10-14 against `main` at `acd8be5b`. Function names are the stable
anchors; line numbers are left out because they drift.

The Directory (`tg_channel_directory`, model `DirectoryEntry`) is one row per
Telegram handle anybody's Posts have referenced. The crawl that fills it is a
breadth-first walk over the reference graph with no depth limit. Two scheduled
jobs and one queue lane run it, and the Directory table is its own queue.

## The pipeline

```
followed Posts ──┐
                 ├─► tg_post_references ──► unknown targets ──► DirectoryEntry(status=unknown)
probe samples ───┘          ▲                                          │
                            │                                          ▼
                            └──── samples mined ◄── verdict ◄── probe lane fetch t.me/s/<handle>
```

### 1. Extract References (every 300 s)

`jobs/directory_harvest.py::run_directory_harvest_sweep` first calls
`services/post_references.py::extract_batch`. It reads up to
`POST_REFERENCE_SCAN_LIMIT` (10,000) Posts with `references_extracted = false`,
newest first, and `references_for` pulls out four kinds of Reference.

| Kind | Where it comes from |
|---|---|
| `forward` | `Post.forwarded_from` (plus `forwarded_from_post_id`) |
| `mention` | `@handle` in the text (`discover.extract_mentions`) |
| `link` | `t.me/<handle>` links, minus links that are only a mention's anchor (`discover.is_the_mention`) |
| `reply` | a cross-channel `reply_to.channel` |

Self-references are dropped. `write_references` inserts with
`ON CONFLICT DO NOTHING` and folds new pairs into `tg_citation_pairs` and
`tg_citation_counts` (`cited_by`, `cites`) in the same transaction.

A Reference is keyed by the source Channel's chat id. A Post whose Channel has
no single chat id is not selected until the id lands or
`POST_REFERENCE_CHAT_ID_GRACE_DAYS` (7) expires (`_eligible`). ADR-019 and
ADR-020 explain why.

### 2. Queue the targets nobody has seen (same tick)

`unknown_targets` is an anti-join. It selects distinct `target_handle`s with no
Directory row that no Account follows, newest Reference first. The budget is
`DIRECTORY_HARVEST_BACKLOG_CEILING` (3000) minus the current pending count, and
the tick skips entirely once pending reaches the ceiling.
`channel_directory.py::enqueue_handles` inserts each one as
`status='unknown'` with `priority = HARVEST_PRIORITY` (1,500,000).

`DIRECTORY_FOLLOW_SAMPLE_REFERENCES` (default on) is the depth switch. Off, only
References whose source is followed are considered, which is one hop from the
follows. On, sample References count too, and the crawl recurses (DDS-02,
ADR-020).

### 3. Dispatch (every 30 s)

`jobs/discover_probe.py::run_discover_probe_sweep` does nothing while the
`discover_probe_background` lane holds any message. Once it is empty,
`dequeue_handles` takes `DISCOVER_PROBE_BATCH_SIZE` (600) rows, ordered by
`(priority, handle)`, from two legs:

- pending: `status='unknown'` and the backoff `retry_after` has passed
- stale: `refresh_due_at <= now()`

They go onto the lane through `sync_queue.enqueue_channel_directory`. Every
priority is a constant chosen by whoever enqueued the row.

| Constant | Value | Who sets it |
|---|---|---|
| `RECHECK_PRIORITY` | -1 | manual recheck or refresh (`POST /data/discover/probe/recheck`, `/refresh`) |
| report rank | 0..n | Discover report candidates, strongest first (`discover_reports`) |
| `DEFAULT_PROBE_PRIORITY` | 1,000,000 | unranked enqueue |
| `HARVEST_PRIORITY` | 1,500,000 | the harvest sweep |
| `REFRESH_PRIORITY` | 2,000,000 | any row that already holds a verdict (`_schedule_refresh`) |

So a harvested handle always sorts ahead of every refresh. While the frontier
is non-empty, refreshes only get the leftovers. That is the starvation the
measurements show (123k overdue).

### 4. Fetch (worker, behind every sync lane)

`LaneScheduler` serves `discover_probe_background` strictly after the six sync
lanes (`sync_lanes.NON_SYNC_LANES`). The consumer runs
`probe_one_handle` → `scraper.get_channel_info(with_samples=True)`. That is
one `fetch_with_retry` of `t.me/s/<handle>` plus, through
`channel_photos.resolve_cached_photo_url`, an avatar download unless a cached
copy with the same source URL exists. Both requests are metered into
`tg_directory_probe_usage` (`directory_probe_usage.py`), which is a tally,
charged to no Account, with no ceiling.

Sharing the proxies is the cost that matters. The probe lane only takes a slot
when no sync wants one, but its requests still feed the per-proxy pacing
(`proxy_pacing.py`). Since DDS-02 the average sync fetch went from about 0.9 s
to 23-28 s.

### 5. Record the verdict

`channel_directory.py::record_probe_result`:

- `ok` or `unavailable` is written only when a Telegram page actually parsed. A
  failure stays `unknown`, bumps `attempts`, and backs off 15 min doubling to
  24 h (`_retry_deadline`). A failure on a row that already holds a verdict
  keeps the verdict.
- Overturning a live `ok` with `unavailable` takes two consecutive answers.
- `samples` (the preview page's Posts, about 13 to 20) replace the stored
  snapshot (`channel_directory_samples.replace_samples`).
- `extract_sample_references` mines those samples into `tg_post_references`.
  This is the recursion: the next harvest tick queues what they name.
- Sample statistics (`last_post_at`, `posts_per_week`, `forward_share`,
  `language`) and Reach are computed, and the search document is rebuilt.
- `_schedule_refresh` sets `priority = REFRESH_PRIORITY` and
  `refresh_due_at = now + directoryRefreshDays` (7) for live kinds.
  `DEAD_KINDS` (bot, group, user) and `unavailable` never come due again.

### Other writers

- `record_sync_metadata` updates a followed Channel's entry from the page sync
  already fetched, at no extra request. It never writes samples.
- `discover_reports` enqueues a report's candidates with their rank.
- `refresh_entries` and `requeue_probes` (manual refresh and recheck) take
  `RECHECK_PRIORITY`. Neither route checks a Permission.

## Knobs

| Setting | Default | What it bounds |
|---|---|---|
| `DIRECTORY_HARVEST_INTERVAL_SECONDS` | 300 | harvest tick |
| `DISCOVER_PROBE_JOB_INTERVAL_SECONDS` | 30 | dispatch tick |
| `DISCOVER_PROBE_BATCH_SIZE` | 600 | messages per dispatch |
| `DIRECTORY_HARVEST_BACKLOG_CEILING` | 3000 | pending handles |
| `DIRECTORY_FOLLOW_SAMPLE_REFERENCES` | true | recursion past one hop |
| `POST_REFERENCE_SCAN_LIMIT` | 10000 | Posts per extraction tick |
| `POST_REFERENCE_CHAT_ID_GRACE_DAYS` | 7 | wait for a source chat id |
| `directoryRefreshDays` (settings row) | 7 | refresh window, 0 disables |
| `RETENTION_DIRECTORY_SAMPLE_DAYS_DEFAULT` | 30 | sample retention |
| `CHANNEL_PHOTO_ORPHAN_MAX_AGE_DAYS` | 30 | avatars of unfollowed handles |
| jobs `directory_harvest` / `discover_probe` | enabled | the whole crawl |

## What nothing bounds

- **Depth.** The only cap is the switch above, which gives a depth of one.
- **Total size.** Directory rows are never deleted, and every live row costs a
  refresh every 7 days, forever.
- **Daily requests.** `tg_directory_probe_usage` counts but never refuses.
- **Relevance.** Nothing looks at language or at who follows what, so the crawl
  goes wherever the graph is densest.
- **Disk.** Samples, the search index, References and avatars all grow with the
  Directory. The avatar cache keeps unfollowed handles' files for 30 days, then
  the next refresh downloads them again.

## Related records

- `docs/migration/ADR-014-channel-directory.md`, ADR-019 (reference graph), ADR-020 (References feed the Directory)
- `.scratch/discover-deep-scrape/spec.md` (DDS), `.scratch/channel-directory/`, `.scratch/channel-reference-graph/`
- `docs/discover-probe-queue-plan.md` (why probing is a server-owned queue)
