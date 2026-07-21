# IDEA-008: Thumbnail cache size enforcement walks the whole cache dir per channel

| Field | Value |
|-------|-------|
| **Id** | IDEA-008 |
| **Status** | backlog |
| **Added** | 2026-07-20 |
| **Priority** | medium |
| **Area** | backend |

## Problem

`enforce_thumb_cache_size_limit` → `_directory_size_bytes` in
`backend/app/services/post_thumbnails.py:133-146` computes total thumbnail cache size by
calling `pathlib.Path.stat()` on **every file** under the cache directory, synchronously.

This runs after **every channel's page scrape**, via `_cache_scraped_post_thumbs` in
`backend/app/services/sync_orchestrator.py` (wrapped in `asyncio.to_thread`, but still a
full O(n) directory walk per invocation, n = total cached thumbnail count, not per-channel).
A bulk-follow's chained sync scrapes many newly-added channels in sequence, so this full
walk repeats once per channel synced in a short window, not once per bulk-follow job.

Caught live via `py-spy` on staging during a bulk-follow-driven sync burst (see
`docs/discover-bulk-follow-load-investigation.md`, Finding 2):

```
Thread (active): "MainThread"
    stat (pathlib.py:1097)
    _directory_size_bytes (app/services/post_thumbnails.py:133)
    enforce_thumb_cache_size_limit (app/services/post_thumbnails.py:146)
```

Not yet measured: how large the thumbnail cache directory is on staging, or whether
`thumbCacheOnSync` is enabled there — only that this code path was observed executing live
during the investigation window. A fresh session should re-measure before choosing a fix,
since the right option depends on how bad `n` actually is in practice.

## Proposed direction

Three options, not mutually exclusive with each other or with the broader RAM/CPU work in
the sibling investigation doc:

1. **Time-based throttle** — only run the enforcement walk at most once per N minutes,
   regardless of how many channels synced in that window. Smallest change; `..._throttled`
   wrapper already exists in the codebase (`enforce_thumb_cache_size_limit_throttled`) so
   check whether it already does this and just needs its window widened, or whether it
   throttles on a different axis.
2. **Maintain a running total** instead of re-walking the directory tree every time —
   increment/decrement a persisted counter on thumbnail write/delete. Correct fix, more
   invasive: the counter needs to stay durable and correct across restarts and any
   out-of-band file changes (manual cleanup, failed writes, etc.).
3. **Move enforcement off the per-channel sync hot path entirely** — a separate periodic
   job (same pattern as the existing retention scheduler in `app/jobs/retention.py` /
   `app/jobs/scheduler.py`) rather than something triggered inline after every scrape.

## Success criteria

- [ ] Thumbnail cache enforcement no longer does a full directory stat-walk once per
      channel during a multi-channel sync burst (e.g., bulk-follow's chained sync).
- [ ] Re-measured (via py-spy or logging) that this is no longer a top CPU contributor
      during a bulk-follow on a realistic channel count.

## Non-goals

- Not fixing the RAM side of the bulk-follow load issue (unbounded `list_posts`,
  frontend fetch thundering herd) — tracked separately, see References.
- Not redesigning the thumbnail cache eviction policy itself, only how/when its size is
  measured.

## Open questions

- Does `enforce_thumb_cache_size_limit_throttled` already throttle, and on what interval?
  (Not confirmed — name suggests yes, but the live py-spy catch means whatever throttling
  exists wasn't preventing this from running during the observed window.)
- How large is the thumbnail cache directory in practice (file count) on staging/prod?
  Determines whether option 1 alone is sufficient or option 2 is warranted.
- Is `thumbCacheOnSync` enabled on staging? If not, this may be lower priority than it
  appears from the single live capture.

## References

- `docs/discover-bulk-follow-load-investigation.md` — full investigation, Finding 2, incl.
  py-spy methodology (workaround for missing SYS_PTRACE in the container).
- `backend/app/services/post_thumbnails.py:133-146`
- `backend/app/services/sync_orchestrator.py` — `_cache_scraped_post_thumbs`

## Session log

| Date | Notes |
|------|-------|
| 2026-07-20 | Created from live py-spy findings during bulk-follow RAM/CPU investigation |
