# ADR-044: Continuity is a Walked range

**Status:** Accepted (2026-11-01). Decided in a grilling session. Supersedes
ADR-043's three tests and its walk-back repair; the rest of ADR-043 stands.
Plan: `docs/window-check-realtime-plan.md`.

## Context

ADR-043 proves a Channel's window with three tests, the third being that every
post id between the Post at the Start and the head is held or a confirmed gap.
On staging (2026-11-01) 292 of 364 Channels failed it, with 21,593 runs of
missing ids. 85% of the runs were 1 to 3 ids wide and spread at random, and
21,246 of them (98.4%) had both neighbours stored by the same sync job. They
were deleted Posts and album members, ids `t.me/s` never shows, not stretches
nobody read. The sync confirms a gap only when both neighbours are already
stored, and it checks before storing the page, so a page read for the first
time never confirms its gaps.

The check was also slow: a median of 17 s per request on staging, because
finding holes meant reading every held id of every selected Channel.

## Decision

A sync records, for each Channel, the **Walked ranges** it read: the id range
of one walk, page to page without a break. A walk's pages chain through the
page's own next id, and backfill restarts at the lowest stored Post, so a walk
is always one range. A walk that reaches a Post inside an existing range merges
with it. A walk cut short (iteration limit, failure, cancel) keeps the range
of the pages it applied. Ids missing inside a range need no record. A **Hole**
is the ids between two ranges. Walked ranges replace confirmed gaps
(`tg_post_sync_state`), whose only logic reader was the check.

A Channel is Complete when **one Walked range spans the window**: its top was
read at or after E, or holds a Post published after E; its bottom holds a Post
at or before the Start, or reached the Channel's first Post. The end stretch
runs from the top range's newest Post to E, a Hole is any space between ranges
inside the window, and the start stretch runs from the Start to the lowest
range's bottom. A Hole's Unproven Posts stay its missing ids exactly, now an
upper bound, and the UI says "hole: up to 4 posts".

A Post stored without a walk (bulk upsert, import) is held but belongs to no
range, so an imported Channel stays Incomplete until a walk reads it.

A sync repairs by jumping: it starts a walk at a Hole's upper range and stops
when a page reaches the range below, and it reaches the Start the same way
from the lowest range. The walk back from the head is gone. The scheduler's
regular sync repairs the Channel's Holes within the scrape cutoff after its
head pass, under the usual lanes and Budget, so a scheduled successor does not
carry a Hole forever.

Retention raises a range's bottom to its lowest remaining Post and drops its
claim to the Channel's first Post once that Post is deleted.

The sync stores each Channel's posting pace when it stamps the head-read
moment, the only input that changes it. The check reads ranges, pace and the
Account's Follows, plus an index-only count of held Posts in the window, and
stays on the server: the frozen record is the server's, and a browser copy
would be a second implementation of these rules.

For the Posts already held, two consecutive Posts share a range when one sync
job stored both or every id between them is a confirmed gap. The 307 junctions
between jobs (none over 10 ids) stay Holes for the repair to close.

## Considered options

- **Fix the order and keep confirmed gaps.** Record a page's gaps after
  storing it, and backfill gap rows from the retrieval job. Smaller, but one
  row per missing id (about 82,000 after backfill), and the check still reads
  ids to find holes. Rejected: it records what is absent, one id at a time,
  when what a walk proves is a range.
- **Keep the walk back from the head, merging as it goes.** Rejected: it
  re-reads every held page down to the Start, hundreds of Requests for a
  30-day window, where a jump reads one or two pages per Hole.
- **Bridge junctions of a page or less in the backfill.** Rejected: a guess,
  where not guessing costs about 307 one-page repairs the scheduler does by
  itself.
- **Compute verdicts in the browser from the ranges.** Rejected for now: one
  implementation of the rules, and the server query costs milliseconds.
- **Ship a faster `_held` first.** Rejected: throwaway code, since ranges
  delete it. The slow check stays until ranges ship.

## Consequences

- `tg_post_sync_state`, its writers and the CW-01 gap-clearing on store go;
  a range table replaces them, with a backfill.
- The gate's `walk_back_to` sync becomes jumps into Holes, and the scheduler
  gains a Hole repair after its head pass.
- Each Channel gains a stored posting pace.
- Most Channels on staging turn Complete on the backfill alone; about 307
  small Holes remain until repaired.
- A Hole now reads "up to N posts".
