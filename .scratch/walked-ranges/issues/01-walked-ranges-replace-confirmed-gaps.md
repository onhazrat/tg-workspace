# WR-01: Walked ranges replace confirmed gaps, and the check reads them

**What to build:** The workspace remembers, for each Channel, the Walked ranges
its syncs read, and the window check proves a Channel Complete when one Walked
range spans the window (ADR-044). A Channel walked in one piece reads Complete
even with deleted Posts and albums inside it; a Hole is only the ids between
two ranges. The check answers in milliseconds because it reads ranges and a
stored posting pace instead of every Post. Ranges are built for the Posts
already held, so most false holes vanish on upgrade. Repair reads only what is
missing: the gate's sync jumps into each Hole and to the Start, and the
scheduler's regular sync repairs Holes within the scrape cutoff after its head
pass. Retention trims ranges. The UI says "hole: up to N posts".

Spec: `.scratch/walked-ranges/spec.md`, user stories 1 to 38 and 53 to 55, and
every Implementation Decision except Live updates.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A corpus-shared, follow-scoped Walked range table with one aggregate module as its sole writer; the sync records each applied page's range in the page's own transaction and merges ranges that touch or overlap.
- [x] A walk cut short (iteration limit, failure, cancel) keeps the range of the pages it applied.
- [x] Posts stored by bulk upsert or import write no range and prove nothing beyond themselves, while still counting as held Posts.
- [x] Each Channel stores its posting pace where the sync stamps the head-read moment; the check reads it.
- [x] The check reads ranges, stored pace, Follows, sync logs, syncs in flight and one index-only count of held Posts in the window; reasons, their order, Behind, Overdue and the overlays behave as ADR-043 says; request and response shapes are unchanged.
- [x] A test fails if the check's query plan scans the Posts table sequentially.
- [x] The gate's sync jumps into each Hole inside the window and walks from the lowest range to the Start, stopping when a page reaches the range below; the walk back from the head is gone.
- [x] The scheduler's regular sync repairs a Channel's Holes within the scrape cutoff after its head pass, newest first, under the usual lanes, Budget and ceilings; a repair cut short leaves a smaller Hole.
- [x] Retention raises or removes ranges below a Channel's lowest remaining Post and drops the first-Post claim with that Post.
- [x] A migration builds ranges from held Posts (same sync job, or all ids between are confirmed gaps), places the top-read moment and first-Post claim, works one Channel at a time with its own frozen logic, and drops the confirmed-gap table.
- [x] Confirmed gaps are gone everywhere: the sync's gap recording, the Post writer's gap clearing, retention's gap pruning, stats, channel deletion and export; import accepts documents that still carry a confirmed-gap section.
- [x] The gate and Details word a Hole as "hole: up to N posts".
- [x] Tests drive "sync in, check out": faked Telegram pages through one Channel's sync, then the check route's verdict; repair tests also assert the page ids asked for. The migration and retention have their own tests. Each guard is mutation-checked and its docstring names the mutation.
- [x] Measured on staging after deploy: the check's median and the count of holed Channels, recorded under Comments.

## Comments

- 2026-11-01: two departures from the spec, both recorded in ADR-044. A Hole's
  missing ids no longer subtract Posts an import stored inside it: that count
  planned as a read bounded by Channel alone, and the Hole already reads "up
  to N". Every sync repairs Holes above its floor, not only the scheduler's
  regular sync and the gate, so a person's own Sync closes a Hole too.
- 2026-11-01: implemented on `claude/window-completeness-perf-3d0cbe` and merged into main in 610ec184 (#255). Measured on staging after deploy: the check takes 240 to 411 ms for an Account's 349 Channels (1 to 30 day windows), against a median of 17 s before. 61 Channels hold a Hole (292 showed one before); for a 7 day window ending now, 313 Channels are Behind, 29 hold a Hole, the rest are frozen, unavailable or failed. Open: none.
