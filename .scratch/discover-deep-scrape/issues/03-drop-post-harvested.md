# DDS-03: Drop `Post.harvested`

**Status:** resolved

## What to build

A migration dropping `Post.harvested` and its partial index, and the Post upsert's reset of it.
Nothing reads the flag once DDS-02 lands.

## Acceptance criteria

- [x] Staging shows the Directory kept growing after DDS-02 shipped (entry count and probe usage
      over at least a week). See "Staging evidence" below.
- [x] Column, index and every reference to the flag removed; autogenerate shows no drift.
      Revision `e4c7a2b9d1f0`. `alembic check` reports the same 14 pre-existing operations
      before and after, none of them on `harvested`. The upsert's reset had already gone with
      DDS-02.
- [x] Backend suite passes.

## Blocked by

- Nothing. DDS-02 shipped 2026-09-23 (#57) and the staging evidence is in.

## Staging evidence (read-only queries, 2026-10-10)

The Directory grew from 64,566 entries before DDS-02 went live to 843,221 (445,216 `ok`,
397,782 `unavailable`, 223 `unknown`). It adds 30k-60k entries a day, against 26-51 a day the
week before. Probe usage went from 27-1,231 Requests a day to 48k-66k and has held there for
17 days.

Sync never failed because of it. Every sync fetch since 2026-09-23 answered 200, with no 429,
no transport error and almost no retries. Two things did change, and neither one argues for
keeping the flag:

- The average sync request time in `tg_network_logs.duration` went from ~900 ms to 23-28 s on
  the day DDS-02 went live and stayed there. The worker log shows proxies parked in cooldown and
  pacing engaged after Telegram pushback, on proxies the probe lane shares with sync. That is a
  crawl-rate problem with its own fix, not a reason to keep a column nothing reads.
- Auto-sync stopped from the 2026-10-07 08:49Z deploy until the 2026-10-08 22:23Z deploy, and
  has run ~180 Channels an hour since, against ~330 before. Network logs show 200s right up to
  the stop, so Telegram did not cause it. The container's logs went with the redeploy, so the
  cause is unknown.

`DIRECTORY_FOLLOW_SAMPLE_REFERENCES` does not read `harvested`, so the drop does not take a
rollback path away.
