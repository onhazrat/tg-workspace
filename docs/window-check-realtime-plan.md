# Window check in near real time: plan

Status: decided in a grilling session, 2026-11-01. The rules are in
[ADR-044](adr/ADR-044-walked-ranges.md); this file holds the order of work and
the measurements behind it.

## Where it stands

Measured on staging (630k Posts, an Account with 349 Channels):

- `POST /posts/window-check` took 2 to 47 s, median 17 s, over 19 slow requests
  in 48 h. `_held` averaged 13.6 s (max 41.6 s): it reads all 1.1 GB of
  `tg_posts` through 128 MB of shared buffers. `_week_posts` averaged 1.6 s
  (max 14.9 s).
- 292 of 364 Channels showed holes, 21,593 missing-id runs. 98.4% had both
  neighbours stored by the same sync job: deleted Posts and album members,
  which the sync never confirms because it checks a page's gaps before storing
  the page.
- The gate re-runs the whole check every 2 s while it waits on syncs it joined.

No stopgap: the slow check stays until step 1 ships.

## 1. Walked ranges (ADR-044)

- A range table per Channel, written by the sync as pages land, merged when a
  walk reaches a Post inside a range; a walk cut short keeps what it applied.
- Backfill: consecutive held Posts share a range when one sync job stored both
  or every id between them is a confirmed gap. Junctions stay Holes.
- Drop `tg_post_sync_state` and its writers, including the CW-01 gap clearing.
- Retention raises a range's bottom and drops its first-Post claim with that
  Post.
- Posting pace stored on the Channel when the head-read moment is stamped.
- The check reads ranges, pace and Follows, plus an index-only count of held
  Posts in the window. It stays on the server.
- Repair jumps into each Hole and to the Start, replacing the walk back from
  the head; the scheduler's regular sync repairs Holes within the scrape cutoff
  after its head pass.
- A Hole reads "hole: up to N posts".

## 2. Push which Channels changed

- The worker sends `pg_notify` `channel_changed` `{name}` when a walk stores a
  page or reads a head, whichever Account's sync it is.
- The API forwards it (`core/pg_notify.py`, one connection) on one Account-wide
  SSE stream, filtered to the Account's Follows and batched per second.
- The browser re-checks only the named Channels and merges their verdicts; it
  sums the Scope totals itself. This replaces the gate's 2 s `landed` poll and
  the refetch after its wait.
- A notification is a hint to look, never the only copy: after a reconnect the
  browser runs one full check.
- A Live window's tick still asks the server again. The browser never computes
  a verdict.

## Left out

- A faster `_held` before ranges: throwaway code.
- Verdicts computed in the browser: a second copy of ADR-043's rules.
- WebSockets: SSE already runs here and the flow is one-way.
