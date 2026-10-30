# CW-02: The gate and the Artifact's record

**What to build:** Every Action-tab button that freezes a Scope (Generate
summary, Copy summary prompt, Start a chat, Generate tags, Copy tag prompt,
Generate report) goes through the gate first. The gate lists the Incomplete
Channels, grouped by what a sync fixes, and every control does one visible
thing. The action always runs, and its Artifact keeps for good which Channels
were Incomplete and why, which were Left out, and its Unproven Posts. History
marks it ("~6 Posts unproven"); its page shows the same banner checked again
now, with Regenerate.

Spec: `.scratch/complete-window/spec.md` (Routes, The record, The gate,
Surfaces). ADR-043. Reference: `prototype/complete-window`; the spec wins where
they differ (the prototype keeps its record in a scratch table and sends it from
the client).

**Blocked by:** CW-01.

**Status:** ready-for-agent

## The gate

- [x] Opens at once on the cached live check, marked "refreshing", then swaps in
  the check frozen at the click unless the person already chose.
- [x] Title "23 Channels need attention, 150 just behind"; the sentence "the
  window ends …, with ~6 Posts (67%) unproven"; groups "A sync can fix these",
  a folded "Just behind · 150, up to 18 h", "No sync can fix these".
- [x] Enter syncs and continues; untouched, the gate does it by itself after
  30 s, shown filling the Sync button. Any edit (Unfreeze, Leave out, Leave all
  out) stops the countdown for good.
- [x] Continue without syncing (fixable Channels recorded skipped); continue
  with the Complete Channels only (Left out, selection narrowed with Undo,
  hidden at 0); cancel makes no Artifact.
- [x] Leave out per row no sync can fix, Leave all out on that group. Unfreeze
  on a frozen row only moves it into the Account's default group (toast names
  it); the row moves into the fixable group and Sync's count rises. Unavailable
  Channels offer Leave out only.
- [x] With nothing fixable it shows nothing, runs, and records "nothing to
  sync". It always shows its review otherwise, whatever was clicked before.
- [x] Sync joins a sync in flight (rows a banner sync is still syncing say
  "syncing, started 2 min ago"), queues the rest, and queues another for a
  Channel whose in-flight sync read its head before E; per-row progress,
  "Continue now", a 5 minute deadline marking unfinished Channels timed out,
  and a toast "Synced 165: 160 now complete, 5 still not".
- [x] Main's pre-Summary and pre-Chat syncs are gone; a Chat's later turns never
  sync.

## The record

- [x] The four creation paths take the gate's outcome (choice, skipped, timed
  out, Left out); the server runs the check at freeze, overlays them, and
  stores the completeness block in the frozen Scope. A skip writes no shared
  row.
- [x] An Artifact read returns the record; absent reads "not checked". History's
  list carries only the pill's fields.
- [x] A re-check-now route checks an Artifact's frozen Channels and window at the
  current moment.

## After the fact

- [x] Each Artifact kind's page shows the banner for its window, with "now …"
  (or "complete now") and Regenerate, which restores its Scope, opens the
  Action tab and runs the same action through the gate, making a new
  Artifact. Hidden for Chats and when no sync can change anything. A
  complete-only Artifact names its Left out Channels.
- [x] History's pill: "~6 Posts unproven", amber when a sync could have fixed
  some, slate when none; its breakdown in a popover, by hover for a mouse and
  by tap otherwise, kept on screen.

## Tests

- [x] HTTP API: each Artifact kind created with each choice, read back; server
  reasons, not the client's; a skip touched no shared row; an old Artifact
  reads not checked; History's list fields.
- [x] Mocked Playwright (workers=1, mutation-tested): review, countdown, an edit
  stopping it, Enter, without syncing, complete only with Undo, Leave out,
  Unfreeze moving its row, nothing to sync, a banner sync joined; the Artifact
  banner and Regenerate; the History pill and its popover by tap at 375 px.
- [x] Route mocks in existing specs match the new response shapes; new
  branching components get render tests.
