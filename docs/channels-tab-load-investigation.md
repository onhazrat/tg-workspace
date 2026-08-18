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

The 6,361 existing orphans on staging were deliberately left in place: after the glob is
gone, directory size no longer affects lookup cost, and the scheduled sweep takes them
once deployed. `backend/scripts/prune_channel_photos.py --dry-run` reports the backlog.

Still open, deliberately: `serialization.py` is declared `PURE_TRANSFORM` but
`channel_to_camel` touches the filesystem, and `_fetch_recent_timestamps_by_channel`
still walks 4.52 M index rows for `velocity`.
