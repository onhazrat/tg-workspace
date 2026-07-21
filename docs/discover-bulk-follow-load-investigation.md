# Bulk-follow RAM/CPU investigation on staging

**Date:** 2026-07-20
**Status:** Root-caused for RAM; CPU contributor identified. No fix implemented — findings only, pending a decision on scope.
**Trigger:** reported symptom — "bulk following the channels is very expensive on both RAM and CPU" on staging, observed shortly after the Discover mentions/links feature shipped.
**Environment:** staging VM (`root@staging-vm`), 4 vCPU / 7GB RAM, Docker Compose stack (`tg-summarizer-staging-*`). Backend runs `fastapi run --workers 4 app/main.py`.

## Methodology

- `py-spy` is not installed anywhere in the image or the repo. Ran it via `uvx py-spy` (downloads and caches on first use, no image change needed).
- `docker exec ... uvx py-spy dump --pid <pid>` fails with `Permission denied (os error 13)` — the backend container has no `SYS_PTRACE` capability and isn't privileged (`docker inspect` confirms `CapAdd: [] privileged=false`), and Docker's default seccomp profile blocks `ptrace` regardless of in-container root.
- Workaround: run `py-spy` from the **host** as root, targeting the **host-visible PID** (`ps aux` on the host sees container process PIDs directly, since this Docker setup doesn't isolate the host PID namespace view from root). Host has `uv`/`uvx` at `/root/.local/bin/`. This worked without any container restart or capability change.
- Workers are short-lived relative to the container lifetime — several `dump` attempts hit "Failed to get process executable name" because the targeted PID had already exited between listing and attaching. Listing PID and dumping in the same SSH round-trip reduced (but didn't eliminate) the race.

```bash
ssh root@staging-vm bash -c '
  pid=$(ps aux --sort=-%mem | grep multiprocessing-fork | grep -v grep | head -1 | awk "{print \$2}")
  /root/.local/bin/uvx py-spy dump --pid $pid --locals
'
```

## Finding 1 — RAM: `GET /posts` has no LIMIT and optional date bounds

**Root cause**, in `backend/app/services/posts.py`:

```python
def list_posts(
    session: Session,
    *,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
) -> list[dict[str, Any]]:
    stmt = select(Post)
    if channel_names:
        stmt = stmt.where(col(Post.channel_name).in_(channel_names))
    if start_date is not None:
        stmt = stmt.where(Post.timestamp >= start_date)
    if end_date is not None:
        stmt = stmt.where(Post.timestamp <= end_date)
    return [post_to_camel(p) for p in session.exec(stmt).all()]
```

No `LIMIT` anywhere. The route (`backend/app/api/routes/data.py`, `GET /posts`) makes `startDate`/`endDate` fully optional query params with no server-side default — omitting them (or passing a very wide range) returns every row matching `channel_names`, fully materialized as ORM objects, then serialized to camelCase dicts for every row via `post_to_camel`.

### Live evidence on staging

- **962 followed channels**, **2,976,944 total rows** in `tg_posts` (`select count(*) from tg_posts`).
- `pg_stat_activity` snapshot showed multiple connections against `tg_posts` with an `IN (...)` list running into the hundreds of channel names:

  ```
    pid  |        state        |    xact_age     |    query_age
  -------+---------------------+-----------------+------------------
   65647 | idle in transaction | 00:02:11.72     | 00:02:11.67
   65755 | idle in transaction | 00:01:04.82     | 00:01:04.72
   65793 | active               | 00:00:43.62     | 00:00:43.53
   65741 | idle in transaction | 00:00:33.74     | 00:00:33.71
  ```

  Query text (truncated by Postgres — `track_activity_query_size` only tracks the first 1024 bytes, which the `IN` placeholder list alone exhausts):

  ```sql
  SELECT tg_posts.id, tg_posts.user_id, tg_posts.channel_name, tg_posts.post_id,
         tg_posts.text, tg_posts.date, tg_posts.timestamp, tg_posts.forwarded_from,
         tg_posts.forwarded_from_name, tg_posts.is_anchor, tg_posts.retrieved_at,
         tg_posts.retrieval_job_id, tg_posts.retrieval_pass, tg_posts.retrieval_source,
         tg_posts.media, tg_posts.links, tg_posts.updated_at
  FROM tg_posts
  WHERE tg_posts.channel_name IN ($1::VARCHAR, $2::VARCHAR, ..., $N::VARCHAR)
  -- LIMIT/date-range clause, if any, is beyond the 1024-byte tracked window
  ```

- `py-spy` caught a worker mid-execution of exactly this query:

  ```
  Thread 0x702D83D32380 (active): "MainThread"
      _maybe_prepare_gen (psycopg/_cursor_base.py:311)
      _execute_gen (psycopg/_cursor_base.py:206)
          Locals: params: {"timestamp_1": 0, "rn_1": 100,
                            "channel_name_1_1": "TelegramTips",
                            "channel_name_1_2": "arash_vpn", ...}
      wait (psycopg/connection.py:483)
      execute (psycopg/cursor.py:113)
      do_execute (sqlalchemy/engine/default.py:952)
      _exec_single_context (sqlalchemy/engine/base.py:1971)
      _execute_context (sqlalchemy/engine/base.py:1846)
      _execute_clauseelement (sqlalchemy/engine/base.py:1641)
      _execute_on_connection (sqlalchemy/sql/elements.py:527)
      execute (sqlalchemy/engine/base.py:1419)
  ```

- Backend worker RSS observed as high as **3.09GB / 38.9% of the 7GB host** on a single `--workers 4` child process (`ps aux --sort=-%mem`).
- Container logs (15-minute window) show workers being killed and respawned repeatedly:

  ```
  INFO   Started server process [15165]
  INFO   Started server process [15191]
  ```

  `docker inspect` reports `RestartCount=0 OOMKilled=false` — that field only tracks the container's PID 1 (`fastapi run`), not its `--workers 4` children, so a child being reaped by the kernel OOM killer wouldn't necessarily show there. `dmesg` returned no OOM lines on this host (ring buffer may be cleared or inaccessible via this SSH session), so the exact killer (kernel OOM vs. an internal recycling policy) is not confirmed — only the respawn pattern is.

### Relationship to bulk-follow and to the Discover feature

Not caused by bulk-follow directly — it's triggered by fetching posts for a large `channelNames` list with a wide/absent date range, which is a **downstream consequence** of bulk-follow: following many channels at once grows the channel set that the next post-fetch requests. Logs from the same window confirm bulk-follow activity was in fact happening concurrently (12 `bulk-follow` and 8 `follow_job` log lines in 15 minutes).

Two ways this session's Discover work touches the same nerve, worth naming honestly:

1. The new `Post.links` JSON column (and the pre-existing `media` column) adds bytes to every one of the ~3M rows this query can return. Not the cause, but it makes an already-unbounded worst case marginally heavier per row.
2. Discover's empty-state guidance actively suggests widening the date range ("Show all posts", "widen the date range") to find more candidates — which is exactly the input shape that removes the one filter (`start_date`/`end_date`) currently limiting `list_posts`' worst case.

## Finding 2 — CPU: thumbnail cache size enforcement walks the whole cache directory per channel

**Tracked separately for a fix session:** [`docs/ideas-log/ideas/IDEA-008-thumbnail-cache-walk-per-channel.md`](ideas-log/ideas/IDEA-008-thumbnail-cache-walk-per-channel.md).

Caught live via `py-spy` on a worker's MainThread:

```
Thread (active): "MainThread"
    stat (pathlib.py:1097)
    _directory_size_bytes (app/services/post_thumbnails.py:133)
    enforce_thumb_cache_size_limit (app/services/post_thumbnails.py:146)
```

`_directory_size_bytes` calls `pathlib.Path.stat()` on every file under the thumbnail cache directory to sum total size, for enforcement against `thumbCacheMaxSizeMb`. This runs via `_cache_scraped_post_thumbs` → `enforce_thumb_cache_size_limit_throttled` in `sync_orchestrator.py`, invoked **after each channel's page scrape**. A bulk-follow's chained sync job scrapes many newly-added channels in sequence, so this full-directory stat-walk runs repeatedly in a short window — once per channel synced, not once per bulk-follow job.

Not independently confirmed how large the thumbnail cache directory is on staging, or whether `thumbCacheOnSync` is enabled there — only that this code path was caught executing live during the same investigation window.

## Summary

| | RAM | CPU |
|---|---|---|
| Confirmed root cause | Yes — unbounded `list_posts`, no LIMIT, optional date filter | Partial — one confirmed hot path (thumb cache walk); did not isolate scrape-parsing (BeautifulSoup/httpx) cost separately |
| Pre-existing vs. new | Pre-existing (whole app fetches-all/filters-client-side by design) | Pre-existing |
| Touched by this session's Discover work | Marginally (extra bytes/row via `links`; UX nudges wider date ranges) | No |
| Directly triggered by bulk-follow | Indirectly (larger channel set → bigger next fetch) | Yes (once per channel in the chained sync) |

## Open questions (not yet decided)

- Whether to add a required/defaulted date bound and/or a hard row cap to `list_posts` — a real behavior change to an endpoint the whole app's client-side-filter architecture depends on, not a local fix.
- Whether to throttle or move the thumbnail cache size check off the per-channel sync hot path (e.g., time-based instead of every-channel).
- Whether `dmesg`/kernel OOM logs are recoverable on this host to confirm the worker-restart mechanism definitively.
