# CW-01: The live check on the Action and Posts tabs

**What to build:** Before any action, the Action and Posts tabs tell the truth
about the window. One line says what is unproven ("Unproven through 09:07 AM:
~185 Posts (4%) · 8 frozen · 13 holes · last 18 h on 149"), or "Complete
window: all 349 Channels proven through 09:07". A Sync button syncs every
Channel a sync can fix. Details shows the coverage bar with toggling legend,
the rows grouped by what a sync fixes, and Visualize's timeline. The check
reads data, never syncs, and its numbers are honest: a confirmed gap stops
counting once its Post is stored, and the head test reads when a sync read the
newest page, not when it finished.

Spec: `.scratch/complete-window/spec.md` (Gap hygiene, The head-read moment,
The check, Routes: the live check, Surfaces). ADR-043. Reference:
`prototype/complete-window`, whose differences from the spec are listed in the
spec's Prototype reference section.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## Prefactor first

- [ ] The kept-Partial-response state formerly called Incomplete is Cut short
  everywhere (code, API fields, copy, tests), so "incomplete" means only an
  Incomplete Channel. About 21 files; regenerate the client.
- [ ] Storing a Post for a confirmed gap's id clears that gap in the same
  write, and a migration deletes every existing confirmed gap whose id is a
  stored Post.

## The check

- [ ] Each Channel records the moment a sync last read its newest page, set
  when the page is read; a walk stopped at the iteration limit still sets it.
  Last sync keeps its meaning.
- [ ] One read model answers, for an Account, Channel names, a window and a
  frozen moment, each Channel's verdict: reasons from the closed set (in the
  spec's order, including "unavailable" for a group marked so or a last sync
  failing with the web-view-unavailable error), the one shown, Last sync, the
  head-read moment, the failed sync's error, the unproven stretches (end, hole,
  start), missing ids, whether a sync can fix it, posting pace and held Posts;
  plus the window's held total. It reads through the Follow-scoped seam.
- [ ] Behind: the only reason (skipped aside) is "not synced to the end", a
  sync can fix it, and its next scheduled sync is not past due; otherwise
  Overdue.
- [ ] Unproven Posts per the spec's formula; "~40+" when any pace is unknown;
  "no Posts expected" only at 0 with every pace known.
- [ ] A live check route answers it for a Scope's Channels and window, and joins
  the route inventories.

## The banner

- [ ] The Action tab (under its header) and the Posts tab show the one line,
  dimmed with "Updating…" only on an edit, not when a Live window's minute
  rolls.
- [ ] "Sync N" syncs every fixable Channel, shows "Syncing N…", and toasts when
  it ends.
- [ ] Details: the bar (gap kinds in the spec's colours, no-sync-can-fix
  hatched, Complete last), a legend whose items toggle their rows,
  double-click isolates and again restores; Behind switched off at first when
  anything else is there; Visualize; Hide rows; rows in words ("31 h behind,
  ~114 posts", "hole: 4 posts, 7:13 PM to 7:30 PM", "history starts 2 h late"),
  sorted by Unproven Posts.
- [ ] At 375 px nothing scrolls sideways: rows stack name over why, each
  timeline bar gets its own line.

## Tests

- [ ] HTTP API: each of the three tests failing alone; every reason, including
  unavailable both ways; Behind against Overdue; Unproven Posts exact for
  holes, paced for lag, the floor, and "no Posts expected"; Follow-scoped
  isolation.
- [ ] Sync orchestrator: a stored Post clears its gap; the head-read moment is
  set on a capped walk. The backfill migration is tested against the unique
  indexes.
- [ ] Mocked Playwright (workers=1, mutation-tested): the line, Sync, Details
  toggles and isolate, Visualize, and phone width.
