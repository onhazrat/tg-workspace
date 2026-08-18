# Channels tab is slow on staging — investigation

**Date:** 2026-08-18
**Target:** `https://dashboard.staging.tgs.onhazrat.ir/summarizer?tab=channels`
**Environment:** staging VM (`root@staging-vm`), 2,068 channels, 4.1 M rows in `tg_posts` (5.9 GB)
**Status:** **fixed** — see "Resolution" below. Investigation measurements were read-only;
nothing on staging was changed while diagnosing.

## Verdict

`GET /api/v1/data/channels?includeStats=true` takes **~30 s**, and **~93 % of that is
filesystem globbing, not SQL**. For every channel it serialises, the backend scans the
entire channel-photo directory (16,276 entries) to answer "does this channel have a
cached avatar?".

Cost is `O(channels × files-in-photo-dir)`. Both terms grow together, so this degrades
**quadratically** as the operator follows more channels. It is invisible on a dev box
with 20 channels and a near-empty photo dir.

## Measurements

Service-level, on the staging box, against the live DB:

| What | Time |
|---|---|
| `list_channels(include_stats=True)` — 3 runs | **30.5 / 30.7 / 32.4 s** |
| `list_channels(include_stats=False)` | **31.1 s** ← stats are *not* the problem |
| Response payload | 3.59 MB, 2,068 channels |
| `POST /data/posts/counts` (7-day window) | 0.12 s |
| `POST /data/posts/counts` (no window) | 1.52 s |
| `GET /telegram/channel-photo/{id}` — per avatar | ~16 ms of pure globbing |

`includeStats=true` adds only ~2.7 s. Everything else the tab fires is sub-second.

## Where the time goes

cProfile of one `list_channels(include_stats=True)` call (42.6 s under the profiler):

```
   ncalls  tottime  cumtime  function
        1    0.020   42.566  services/channels.py:240(list_channels)
     2068    0.082   39.484  services/serialization.py:112(channel_to_camel)
     2068    0.013   39.242  services/channel_photos.py:53(has_cached_photo)
     2068    2.104   39.230  services/channel_photos.py:74(_find_image_path)
     4745    7.459   35.641  glob.py:452(select_wildcard)
     2068   18.358   18.405  glob.py:551(scandir)
 19414136    6.357    6.357  {method 'match' of 're.Pattern' objects}
        1    0.017    2.868  services/channels.py:170(compute_channel_stats_batch)
```

The chain:

- `channels.py:240 list_channels` → `serialization.py:118 channel_to_camel` calls
  `has_cached_photo(ch.id)` **once per channel**.
- `channel_photos.py:74 _find_image_path` implements that as
  `directory.glob(f"{safe}.*")`.
- A wildcard `glob` **lists the whole directory and regex-matches every entry**. One
  listing costs ~7 ms; doing it 2,068 times costs ~19 ms each once matching is included.
- 19.4 M regex matches ≈ `1777 × 8138/2` (channels with a photo, found on average
  halfway) `+ 291 × 16276` (channels with none, full scan). The arithmetic matches the
  profile exactly, which confirms the model.

Minor, same file: `_photo_dir()` calls `mkdir(parents=True, exist_ok=True)` on **every**
invocation — 2,068 needless syscalls per request.

## Aggravating factor: the photo directory is 78 % garbage

```
image files: 8138   live channels: 2068   matched: 1777   orphaned: 6361
```

6,361 cached avatars belong to channels that no longer exist. Nothing prunes them, and
every one of them is scanned 2,068 times per request. Pruning alone would cut the glob
cost ~4.6×, but it treats the symptom.

## Proof of diagnosis

Same call, with the directory listed **once** into a set of stems instead of globbed per
channel:

```
baseline           :  30.45s  rows=2068
one-listdir patched:   2.65s  rows=2068
stat-per-ext       :   2.65s
channels resolved to a cached photo: 1777   (identical to baseline)
```

**11.5× faster, byte-identical output.**

## What is left after the fix: ~2.7 s of SQL

`compute_channel_stats_batch` runs two queries over `tg_posts`, `EXPLAIN ANALYZE`d on
staging:

| Query | Time | Note |
|---|---|---|
| `_fetch_channel_aggregates` — `count/min/max GROUP BY channel_name` | **1.04 s** | parallel seq scan |
| `_fetch_recent_timestamps_by_channel` — `row_number() OVER (PARTITION BY channel_name ORDER BY timestamp DESC)`, keep `rn <= 100` | **1.56 s** | walks **4.52 M** index rows via `ix_tg_posts_channel_name_timestamp` to keep at most 206 k |

The window query's whole output feeds `_velocity_from_timestamps`, which then uses only
the last 100 timestamps per channel. It is a top-N-per-group scan of the entire table.

## Frontend factors

- `DataContext` (`contexts/DataContext.tsx:48`) runs `useChannelsQuery()` for the **whole
  `/summarizer` page**, not just the Channels tab — every tab pays the 30 s on first
  load. The Channels tab is simply where the emptiness is most visible.
- `useChannelsQuery` sets `refetchOnWindowFocus: true` with `staleTime` = 30 s
  (`VITE_QUERY_STALE_TIME_MS`). Refocusing the tab after 30 s re-fires a 30 s / 3.6 MB
  request.
- Avatars are session-cached in memory only (`lib/channels/channel-photo-cache.ts`), so
  each page load re-fetches every visible avatar — each paying the same ~16 ms glob
  server-side.

## Recommended fix, in order

1. **`channel_photos.py:74 _find_image_path` — stop globbing.** Stat the known
   extensions instead (`_EXT_BY_CONTENT_TYPE.values()` → `.jpg/.png/.webp/.gif`; all
   8,138 files on disk today are `.jpg`). Four `is_file()` calls replace a 16 k-entry
   scan. Measured 30.45 s → 2.65 s, and it fixes the per-avatar endpoint at the same
   time. Also hoist the `mkdir` out of `_photo_dir()`.
2. **Prune the 6,361 orphaned photos** with a `backend/scripts/` maintenance script
   (`--dry-run` first, per repo convention), and delete the photo when a channel is
   unfollowed.
3. **Optional, ~2.7 s more:** bound `_fetch_recent_timestamps_by_channel` — velocity only
   needs recent history, so a `timestamp > now - N days` predicate would cut the 4.5 M-row
   walk sharply. Or compute stats lazily/cached rather than on every channel list.
4. **Consider** dropping `refetchOnWindowFocus` for a 3.6 MB payload.

Item 1 alone takes the tab from ~30 s to ~3 s.

## Method notes

- Timed the service function in-process inside the backend container
  (`docker exec … python`), not over HTTP: the route requires a JWT
  (`CurrentUser`), and minting one means handling the `.env` superuser secret.
  The numbers therefore exclude FastAPI and network overhead — which for a 3.6 MB
  response adds tens of milliseconds, not seconds.
- `EXPLAIN ANALYZE` run via `docker exec … psql -U postgres -d app`, read-only.
- Probe scripts were removed from the VM and the container afterwards.

## Resolution

Fixed in the commit that carries this doc.

- `_find_image_path` now probes `_IMAGE_EXTS` instead of globbing, matching
  `post_thumbnails.py`. The tuple is *derived* from `_EXT_BY_CONTENT_TYPE` plus the
  fallback, so it cannot drift from the write path. The same treatment went to
  `delete_cached_photo` and to `cache_channel_photo`'s pre-write unlink, and `_photo_dir`
  memoises its `mkdir` per path.
- `prune_orphaned_photos` sweeps avatars no channel references, wired into
  `run_retention_cleanup`. Orphans are pruned, not size-capped: a cap would evict live
  avatars and leave the garbage. The `CHANNEL_PHOTO_ORPHAN_MAX_AGE_DAYS` floor (30)
  exists because Discover caches avatars for candidates that are not channel rows yet.
- `tests/services/test_photo_cache_lookup_cost.py` guards it, parametrised over both twin
  modules. Mutation-tested: reverting `_find_image_path` to the glob turns the
  anti-divergence test red at `assert 4 == 0` and the scaling test at `assert 20 == 200`
  — 10 channels cost 20 directory scans, 100 cost 200, which is the quadratic in a
  single line of output.
- `tests/conftest.py` now points both image caches at a scratch dir for the whole suite.
  Without it, any test exercising `run_retention_cleanup` sweeps the developer's real
  `data/` caches — verified by planting a 400-day-old file and watching it die.

The existing orphans on staging were deliberately left in place: after the glob is gone,
directory size no longer affects lookup cost. Measured after deploy, all 12,714 orphaned
files (6,357 avatars plus their sidecars) are 16.2–20.1 days old — one Discover probe
campaign about three weeks ago — so the hourly sweep reclaims them in roughly ten days,
as they cross the 30-day floor, not immediately. That is the age floor working: pruning
on "unreferenced" alone would have taken all of them today, including any still shown in
a saved report. `backend/scripts/prune_channel_photos.py --dry-run` reports the backlog
and how much of it is currently eligible.

### Follow-up: the velocity query

`_fetch_recent_timestamps_by_channel` was the other 1.56 s. It was a top-N-per-group
written as a window function, so it read every row of every channel before discarding
all but 100 of each — 4.52 M index rows to return 129,980.

Rewritten as a LATERAL, which lets `ix_tg_posts_channel_name_timestamp` stop after 100
entries per channel. `EXPLAIN ANALYZE` on staging: **1,556 ms → 106 ms**, reading 129,980
rows instead of 4.52 M. End to end from Python, **1.50 s → 0.39 s**, and the two queries
were run side by side against the live database to confirm **identical output** — same
1,809 keys, same 129,980 timestamps.

The channel names travel as one array parameter (`unnest`) rather than a 2,068-row
`VALUES` clause, which keeps the SQL text constant so SQLAlchemy's compiled-statement
cache hits: 0.39 s versus 0.55 s for the same rows.

`_fetch_channel_aggregates` was left alone on evidence, not by omission: the same LATERAL
treatment measured 1,117 ms against its current 1,035 ms. An exact per-channel `count(*)`
has to touch every row however it is written.

Guarded by four tests in `test_channel_stats.py`. The per-channel cap had no coverage at
all before — count, min/max and velocity all survive one channel starving another, so a
single global `LIMIT` would have passed the entire existing suite. Mutation-tested:
moving the `LIMIT` outside the LATERAL fails exactly one test, the new one.

Still open, deliberately: `serialization.py` is declared `PURE_TRANSFORM` but
`channel_to_camel` touches the filesystem.

## Round three: the bottleneck moved off the backend

After the two server-side fixes, the Channels tab still felt slow, so it was measured
from the operator's own browser rather than from inside the container. That changed the
picture completely:

| | measured |
|---|---|
| `/data/channels?includeStats=true`, from the browser | **6–10 s** |
| same request, server-side | 1.95 s |
| payload | **3.39 MB**, `content-encoding: null` |
| gzipped | 0.53 MB (6.4×), 76 ms CPU |
| effective throughput to the box | **0.33–0.75 MB/s** |
| latency floor (3 KB response) | ~1.7 s |
| JSON parse in the browser | 30 ms |

**Nothing on the deployment was compressed** — not the API and not the frontend, whose
`summarizer-*.js` is 1,039 KB served raw. Traefik had middlewares defined but no
`compress`, and `app/main.py` adds only CORS and the API-key middleware. So roughly 5
of the ~7 seconds was transferring uncompressed bytes over a slow link: more than the
entire backend cost, and invisible to every measurement taken inside the datacentre.

Fixed by enabling Traefik compression — see **Response compression** in `deployment.md`
for the configuration, the reasoning about where it lives, and how to verify it.

One assumption worth recording as *wrong*: the exclusion of `text/event-stream` is
usually justified with "compression breaks SSE". Measured against traefik:3.6, it does
not — events still flush per write, arriving at t=0,1,2,3 s with and without gzip. The
exclusion is still correct, for a different reason: these events are ~14 bytes and gzip
framing takes each to ~24, so compressing a long-lived stream costs CPU to send ~70%
more bytes. Traefik does **not** exclude SSE by default, so the entry is load-bearing
either way.

### What is left after compression

### Rounds four and five: splitting the list, and conditional requests

Three more changes, all against transfer rather than compute.

| | before | after |
|---|---|---|
| grid's blocking call, server | 3.13 s | **0.35 s** |
| grid's blocking call, from the browser | 3.3–4.3 s | **~1.5 s** |
| its payload, gzipped | 536 KB | **298 KB** |

- **Stats split off** into `GET /data/channels/stats`. They were 2.36 s of a 3.13 s
  response for 46 KB of payload, and only `activity_rate` and `total_posts` — two of
  eleven sort options, and not the default — read them.
- **Bios split off** into `GET /data/channels/bios`, 196 KB of 494 KB. Truncating was
  measured first and rejected: bios cap at 255 characters (mean 145), so cutting at
  300 saves nothing. `DataContext` merges them back onto the channel objects so
  `channel.bio` keeps working — a `channelBios` map read directly would have let a
  prompt built before it arrived quietly lose its bios.
- **ETag/304** on all three channel reads, hashing the body rather than reading
  `tg_sync_meta` (whose `channels` etag does not move when a *setting group* changes,
  and the payload merges that group's fields in). Verified through Traefik that
  compression preserves the validator: a conditional request returns 304 with 0 bytes.
  Channel rows are quiet minute to minute — 0 changed in the last minute on staging,
  1 in five — so `refetchOnWindowFocus` mostly costs nothing now.

### What is left

1. **`/data/summaries` — 2.69 s for 49 rows.** `select(Summary)` pulls **26 MB** of the
   `extra` column per page to return 1.15 MB. It loads on *every* tab, because
   `ChatContext` and `AIContext` are always mounted. Split the heavy fields into a
   companion table the way `y7z8a9b0c1d2_split_sync_log_payloads.py` already did for
   sync logs.
2. **Denormalise the post counts** onto `tg_channels` to remove the ~1.1 s exact
   `count(*)`. That cost is off the critical path now, so this is no longer urgent.
   `oldest_stored_post_timestamp` and `anchor_post_id` are precedent for derived
   columns there.
3. **Server-side pagination and faceting** — the real fix and the largest change. The
   grid shows 20 of 2,068. Blocked on the tag chips needing global counts.

**Measure from a browser, not from inside the container.** Every number that mattered
in rounds four and five was invisible to server-side measurement.
