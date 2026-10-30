# Spec: Complete window (ADR-043)

**Status:** ready-for-agent

Decided in ADR-043, prototyped as variant D, and grilled on 2026-10-30; the
grilling decisions are folded into ADR-043. Terms are the glossary's: Incomplete Channel,
Complete window, Incomplete window, Behind, Overdue, Unproven Posts, Left out,
Cut short.

## Problem Statement

When I generate a Summary, start a Chat, run Tags or make a Discovery report,
I cannot tell whether the workspace held every Post my Channels published in
the window. Generate and Chat sync stale Channels first and go ahead whatever
the sync answered; the scheduler skips its sync entirely while any other sync
runs on the deployment; frozen Channels drop out without a word. A sync that
stopped at the walk limit counts as a success while leaving a hole, and
nothing checks that a Channel's history reaches the window's Start. So a
Summary written from a window with missing Posts looks exactly like one that
had them all, and I find out, if ever, by noticing something absent from the
prose.

I also cannot tell how much it matters. "6 Channels not synced" might be 3
Posts or 300. And when something can never be fixed by a sync (a frozen
Channel, one Telegram will not serve), I see it every time with nothing to do
about it.

## Solution

Every action that freezes a Scope checks its window first, from data, and
either makes the window Complete or records why not.

Before I act, the Action and Posts tabs show the live check as one line:
"Unproven through 09:07 AM: ~185 Posts (4%) · 8 frozen · 13 holes · last 18 h
on 149", with a Sync button for what a sync can fix and Details for the rest.
When I click an action, a dialog (the gate) lists the Incomplete Channels,
grouped by whether a sync can fix them, with Behind ones folded into one line.
Enter syncs; after 30 s it syncs by itself unless I have touched anything. I
can also continue without syncing, continue with only the Complete Channels
(the rest are Left out), leave out single Channels, unfreeze a frozen one, or
cancel. With nothing a sync could fix, the gate asks nothing.

The action always runs. Its Artifact keeps, for good, which Channels were
Incomplete and why, which were Left out, and about how many Posts were
unproven. History marks it ("~6 Posts unproven"), its page shows the same
banner checked again now, and Regenerate runs the same action on the same
Scope through the gate. A scheduled successor does the same unattended, with
a 5 minute deadline, and its auto-published post carries one line saying what
it lacked.

## User Stories

### Seeing the window before acting

1. As a person on the Action tab, I want one line saying how many Posts my window cannot vouch for, so that I know whether it matters before I spend an AI Key.
2. As a person, I want that line to say "~185 Posts (4%)" rather than a Channel count, so that I can weigh the gap against the window's size.
3. As a person, I want the line to name the kinds of problem ("8 frozen · 13 holes"), so that I know what is wrong without opening anything.
4. As a person, I want routine lag said as one phrase ("last 18 h on 149"), so that ordinary Behind Channels do not drown the real problems.
5. As a person, I want the same line on the Posts tab, so that I see it while reading the Posts it is about.
6. As a person, I want the line to read "Complete window: all 349 Channels proven through 09:07" when nothing is missing, so that I know I can trust the result.
7. As a person, I want the live line to dim with "Updating…" only when I change the selection or window, not when a Live window's minute rolls, so that it does not flicker.
8. As a person, I want a Sync button on that line for every Channel a sync can fix, so that the sync runs while I still pick a model and language.
9. As a person, I want the Sync button to show "Syncing 162…" while it runs and a toast when it ends, so that I know when the window is ready.
10. As a person, I want Details to show a bar of what is missing by kind, a legend with counts, and the Channels as rows, so that I can see which Channels and why.
11. As a person, I want each legend item to toggle its rows, and a double-click to show only that kind (again to show all), so that I can focus on one problem.
12. As a person, I want Details to open with Behind Channels switched off when there is anything else, so that the list starts with what needs a look.
13. As a person, I want a Visualize chart of each Channel's window as a bar with the unproven stretch coloured by kind, so that I can see where in time the gaps are.
14. As a person, I want each row to say how far short it is in words ("31 h behind, ~114 posts", "hole: 4 posts, 7:13 PM to 7:30 PM", "history starts 2 h late"), so that I do not have to decode chips.
15. As a person, I want rows sorted by Unproven Posts, most first, so that a frozen Channel that never posts sinks to the bottom.
16. As a person with colour vision deficiency, I want what no sync can fix hatched and every colour paired with a label, so that nothing depends on hue alone.

### The gate

17. As a person, I want every Action button that freezes a Scope (Generate summary, Copy summary prompt, Start a chat, Generate tags, Copy tag prompt, Generate report) to go through the gate, so that no Artifact skips the check.
18. As a person, I want the gate to open at once on the live check I already saw, marked "refreshing", and swap in the check frozen at my click when it lands, so that I never wait to see the list.
19. As a person, I want the gate's title to say "23 Channels need attention, 150 just behind", so that I know the size of the problem at a glance.
20. As a person, I want the gate to say "the window ends Oct 30, 08:43 AM, with ~6 Posts (67%) unproven", so that I know what I am deciding about.
21. As a person, I want rows grouped as "A sync can fix these", a folded "Just behind · 150, up to 18 h", and "No sync can fix these", so that I see what a sync changes.
22. As a person, I want Enter to sync and continue, so that the usual choice is one key.
23. As a person who walked away, I want the gate to sync and continue by itself after 30 s, so that the default I get is a synced window, not a stalled dialog.
24. As a person, I want the countdown shown filling the Sync button ("Sync 165 · 28s"), so that I know it will act.
25. As a person, I want any edit in the gate (Unfreeze, Leave out, Leave all out) to stop the countdown, so that nothing runs on a list I am still changing.
26. As a person, I want to continue without syncing, so that I can accept a known gap when I am in a hurry.
27. As a person, I want to continue with only the Complete Channels, so that the Artifact's window is Complete and says what was Left out.
28. As a person, I want Undo on the toast after "complete only" narrows my selection, so that I can get my selection back.
29. As a person, I want "Leave out" on each row no sync can fix and "Leave all out" on that group, so that I can drop what will never be complete.
30. As a person, I want "Unfreeze" on a frozen row that only unfreezes it (moves it into my default group, toast names the group) and moves the row into "A sync can fix these", so that I see exactly what it did and sync it with Sync.
31. As a person, I want Channels Telegram will not serve to offer Leave out only, so that I am not offered a fix that cannot work.
32. As a person, I want to cancel, so that I can back out without an Artifact.
33. As a person, I want the gate to ask nothing when no Incomplete Channel can be fixed by a sync, so that I am not interrupted for nothing; the Artifact still records it.
34. As a person, I want rows that a banner sync is still syncing to say "syncing, started 2 min ago", and the gate's Sync to join that sync rather than queue it again, so that nothing runs twice and nothing happens unseen.
35. As a person, I want the gate to always show its review even after I synced from the banner, so that its behaviour does not depend on what I clicked minutes ago.
36. As a person, I want progress per row while the gate syncs and "Continue now" to stop waiting early, so that I control how long I wait.
37. As a person, I want the gate to stop waiting after 5 minutes and continue, marking unfinished Channels timed out, so that a stuck sync never blocks me.
38. As a person, I want a toast after the sync saying "Synced 165: 160 now complete, 5 still not", so that I know what the sync achieved.
39. As a person, I want a failed sync's row to show the error on hover or tap, so that I know why.

### The Artifact's record

40. As a person, I want every Summary, Chat, Tag run and Discovery report to keep its Incomplete Channels, each with one reason and its Last sync at the time, so that I can judge it later.
41. As a person, I want it to keep the Left out Channels separately, so that a Complete window made by leaving Channels out says so.
42. As a person, I want it to keep Unproven Posts as it was at the action, so that History does not drift as paces change.
43. As a person, I want a skip to be my choice for this Artifact only, touching no shared Channel state or failure count, so that other Followers see nothing of it.
44. As a person, I want the record never to clear when the Channel syncs later, so that it says what the Artifact was made from.
45. As a person, I want an Artifact made before this record existed to read "not checked", so that it is never mistaken for Complete.
46. As a person, I want a Retry, a later Chat turn or a pasted response never to sync or check again, so that every prompt reads the same Covered Posts.

### After the fact

47. As a person in History, I want a pill on each Artifact made on an Incomplete window saying "~6 Posts unproven", amber when a sync could have fixed some of it and slate when none, so that I can scan for doubtful ones.
48. As a person in History, I want the pill to open its breakdown on hover with a mouse and on tap on a phone, staying on screen, so that it works on any device.
49. As a person on an Artifact's page, I want the same one-line banner for its window, so that I know what it lacked.
50. As a person, I want that banner to check the Artifact's Channels and window again now ("now 2 holes", or "complete now"), so that I know whether a Regenerate would do better.
51. As a person, I want "Regenerate" on that banner to restore the Artifact's Scope, open the Action tab and run the same action through the gate, making a new Artifact, so that I can redo it on a Complete window.
52. As a person, I want Regenerate hidden when no sync can change anything and on Chats, so that it never promises what it cannot do.

### Unattended

53. As an Operator, I want a scheduled successor to sync its Incomplete Channels even while other syncs run, joining one in flight and queueing another when that one read its head before E, so that busy deployments still produce Complete windows.
54. As an Operator, I want the successor to wait at most 5 minutes and then freeze, so that a schedule never stalls.
55. As a subscriber of an auto-published channel, I want one metadata line "~40 Posts unproven (2%): @a, @b +3", naming only Channels that are not Behind and omitted when only Behind ones remain, so that I know the post's limits without noise.
56. As a person, I want the prompt never to mention Incomplete Channels, so that a Retry sends its original's prompt.

### Trusting the numbers

57. As a person, I want a confirmed gap to stop counting once its Post is stored, so that hole counts are true.
58. As a person, I want Unproven Posts to read "~40+" when any Channel's posting pace is unknown, and "no Posts expected" only when every pace is known, so that the estimate never claims more than the data shows.
59. As a person, I want a Channel only Behind until its scheduled sync is past due, and Overdue after, so that "behind" means the scheduler will get to it.
60. As a person, I want the whole thing to work at phone width with no sideways scroll, so that I can check a window from my phone.

## Implementation Decisions

### Gap hygiene (first)

- Storing a Post for a confirmed gap's id clears that gap, in the same write.
- A migration deletes every existing confirmed gap whose id is a stored Post
  (2,955 of 36,013 on one deployment). Test 3 depends on this; nothing that shows hole
  counts ships before it.

### The head-read moment

- Each Channel gains the moment a sync last read its newest page, beside Last
  sync, which keeps meaning when a sync finished. A sync sets it when it reads
  the newest page, not when it finishes. A walk stopped at the iteration limit
  still read its head, and test 3 catches what it left.

### The check (a read model)

- One read model answers, for an Account, a list of Channel names, a window
  and a frozen moment, each Channel's verdict. E is the earlier of the window's
  End and the frozen moment. A Channel is Incomplete unless head, start and
  continuity hold (ADR-043). It reads the corpus through the Follow-scoped seam
  and the Account's own Follows for frozen and group settings.
- Each verdict carries: the reasons (closed set, below), the one reason shown,
  Last sync, the head-read moment, the error of a failed last sync, the
  unproven stretches (end, hole, start, each from and to), the missing id
  count, whether a sync can fix it, the Channel's posting pace, and the Posts it
  holds inside the window. The check also answers the window's total held Posts.
- Reasons, closed, in the order shown when several apply (the prototype's
  order, extended with "unavailable" from grilling):

  ```
  skipped, failed, timed_out, refused,     # a person can act on these
  end, hole, start,                          # a sync can repair these
  retention, frozen, unavailable             # no sync can
  ```

  "Unavailable" is a Channel Telegram will not serve publicly (private,
  deleted, restricted, or a last sync failing with the web-view-unavailable
  error); it replaces "sync failed" for those, and it is never syncable.
  Frozen and retention are never syncable either.
- **Behind**: the only reason (ignoring skipped) is end, a sync can fix it, and
  the scheduler's next due sync for it is not past due. Otherwise a lagging
  Channel is **Overdue**. Both keep the reason "not synced to the end"; Behind
  and Overdue are groupings, not reasons.
- **Unproven Posts**, from the prototype:

  ```
  lacks(c)   = c.missingIds + c.pacePerHour * hours(non-hole stretches of c)
  unproven   = round(sum of lacks over the Incomplete Channels)
  share      = unproven / (window's held Posts + unproven)
  pacePerHour: Posts in the week before the Channel's head-read moment
               (no earlier than its first Post or the retention cutoff),
               per hour; unknown when that span is under an hour
  ```

  Any unknown pace makes it a floor, written "~40+". It reads "no Posts
  expected" only at 0 with every pace known, and "unknown" at 0 otherwise.

### Routes

- A live check route takes a Scope's Channels and window and answers the
  verdicts and the held total. The Action and Posts tabs call it; it never
  syncs.
- The four Artifact creation paths (Summary, Chat, Tag run, Discovery report)
  take the gate's outcome: the choice (synced, continued early, skipped,
  complete only, nothing to sync, complete), the Channels the person skipped,
  the ones whose sync timed out, and the Left out ones. The server runs the
  check at freeze itself, overlays skipped and timed out, and stores the
  record. The client's view of the check is never trusted as the record.
- An Artifact read returns the record; History's list carries only the pill's
  fields (Unproven Posts, its floor flag, whether a sync could have fixed any,
  and the Incomplete count), per the list-light rule.
- A re-check-now for an Artifact runs the check on its frozen Channels and
  window at the current moment.

### The record

- The frozen Scope gains a completeness block: checked, choice, the Incomplete
  Channels (name, reasons, reason shown, Last sync, stretches, missing ids),
  Left out names, Unproven Posts (number and floor flag), and the window's held
  Posts. Absent means not checked.
- A skip touches no shared state: no Channel field, no sync state, no failure
  count.

### The gate (frontend)

- Replaces main's pre-Summary and pre-Chat syncs. A Chat's later turns never
  sync.
- States: checking, review, syncing, done. Opens on the cached live check when
  it has one, marked refreshing.
- The 30 s countdown runs only while the review is untouched; Unfreeze, Leave
  out and Leave all out stop it. Enter syncs.
- Sync joins any sync already in flight for its Channels (the banner's, or
  another), queues the rest, and queues another for a Channel whose in-flight
  sync read its head before E. Rows say what each is doing.
- "Unfreeze" moves the Channel into the Account's default group, as the
  Channels tab does, and nothing else; the row moves into the fixable group and
  Sync's count rises.
- "Leave out" narrows the Channel selection with Undo and records the Channel
  as Left out. "Continue with N complete only" leaves out every Incomplete
  Channel; hidden at 0.
- With nothing fixable, the gate shows nothing and records "nothing to sync".

### Surfaces

- One banner component serves the Action tab, the Posts tab and each
  Artifact's page: the line, an action slot (Sync on the live window; "now …"
  and Regenerate on an Artifact), and Details (bar, legend toggles with
  click-to-toggle and double-click-to-isolate, Visualize, Hide rows, the rows).
- The live banner's Sync syncs every fixable Channel; it shortens the gate's
  sync but never replaces it.
- History's pill opens its breakdown in a popover: hover for a mouse, tap or
  click otherwise, kept on screen.
- Regenerate restores the Artifact's Scope as "Use this Scope" does, opens the
  Action tab and runs the same action through the gate. It makes a new
  Artifact, not a successor. Hidden for Chats and when no sync can change
  anything.
- Charts colour what is missing, never why (prototype, validated with the
  dataviz script in both themes): hole orange `#eb6834`/`#d95926`, short
  history aqua `#1baf7a`/`#199e70`, Overdue end gap blue `#2a78d6`/`#3987e5`,
  Behind end gap a quieter blue `#86b6ef`/`#184f95`, covered stretch a neutral
  track `#f0efec`/`#383835`, no sync can fix hatched gray. Failed and skipped
  stay in row chips.
- Phone width: rows stack name over why, the timeline gives each bar its own
  line, no surface scrolls sideways.

### The scheduler

- The successor's pre-sync loses the "any sync job active, skip" shortcut. It
  checks, syncs what it can repair (joining in-flight syncs, queueing behind
  ones that read their head before E), waits up to 5 minutes, re-checks,
  freezes the record with choice synced or timed out, and auto-publishes.
- The metadata line, when metadata is sent: Unproven Posts and its share, then
  the Channels that are not Behind ("~40 Posts unproven (2%): @a, @b +3").
  Omitted when only Behind Channels remain. The prompt never mentions any of it.

### Naming

- The kept-Partial-response state formerly called Incomplete is Cut short
  everywhere (code, API fields, copy), so "incomplete" means only this.

## Testing Decisions

- Good tests here assert what a person or a route caller sees: a verdict's
  reasons, a record read back, a row's words, a button's count. Never a
  helper's internals, never a query's shape.
- **The HTTP API** (the main seam). Seed Posts, confirmed gaps, sync logs,
  Follows and setting groups, then call the routes:
  - the live check: each of the three tests failing alone; every reason,
    including unavailable from a group and from a last error; Behind against
    Overdue from the next due sync; Unproven Posts exact for holes, paced for
    lag, the "+" floor, "no Posts expected" only with every pace known;
  - each Artifact kind's creation with each choice, then a read: the record
    holds Incomplete, skipped, timed out and Left out as sent, the check's
    reasons are the server's, and a skip changed no shared row;
  - an Artifact made before the record reads not checked;
  - the History list carries only the pill's fields.
  Prior art: the route tests, the isolation probes for the Follow-scoped
  reads, and the resolve-then-read pattern of the Posts view guard. New routes
  join the route inventories (`scripts/route-guards.sh`).
- **The sync orchestrator.** A stored Post clears its confirmed gap; the
  head-read moment is set when the newest page is read and survives a capped
  walk; Last sync is unchanged in meaning. Prior art: the sync orchestrator and
  post sync state tests. The backfill migration is tested against the unique
  indexes, per the backfill-migration lessons.
- **The scheduler's successor job.** Runs while another sync job is active
  (no skip); joins an in-flight sync; queues behind one that read its head
  before E; freezes with timed out after the deadline (time injected); the
  metadata line's three cases (Incomplete with non-Behind, only Behind, none).
  Prior art: the auto-sync job tests.
- **Playwright with mocked routes** (workers=1, mutation-tested): the gate's
  review, countdown, edit stopping it, Enter, continue without syncing,
  complete only with Undo, Leave out, Unfreeze moving its row, nothing to sync,
  a banner sync joined with its rows labelled; the live banner and its Sync;
  Details toggles and isolate; an Artifact banner with "now" and Regenerate;
  the History pill's words and colours and its popover by hover and by tap at
  375 px with no sideways scroll. Prior art: the History tab and Summary
  failures specs; route mocks must match the new response shapes.
- A new branching component needs a render test for the CRAP ratchet.

## Out of Scope

- The Coverage workspace tab and "Open in a tab"; Visualize inside Details
  covers it until someone asks for a bigger view.
- Syncing Channels a sync cannot repair: frozen, unavailable, past retention.
- Refusing or holding an action until the window is Complete (rejected in
  ADR-043).
- Telling the model about gaps in the prompt.
- Checking Artifacts made before the record retroactively; the prototype's
  reconstruction from sync logs stays in the prototype.
- A grace period on test 1 for windows ending at the click.
- Per-Channel checkboxes in the gate.

## Prototype reference

Branch `prototype/complete-window`: one sanitized commit on top of `main`,
never merged. Run it with `?variant=D` (variant 0 is main) and its check API
pointed at a deployment, as its README says. It is the reference for how every
surface looks and behaves; build the real thing to this spec, reading the
prototype for the details prose leaves open:

- The store module: the reason order, Behind (`isRoutine`), `measure` for the
  one-line phrase, `lacks` and `postsPhrase` for Unproven Posts with its floor,
  `shortfall` for each row's words, and the sort by Posts at risk.
- The variants module: the gate (`useGate`: checking, review, syncing, the
  countdown that an edit stops, joining a banner sync, complete only),
  `useStuckActions` (Leave out, Unfreeze), the shared `WindowBanner` with
  `SyncNow` and `NowAndRegenerate`, `CoverageBar` and its legend toggles,
  `Timeline` for Visualize, and History's pill in a popover.
- The check API script: one statement per check for the three tests, the hole
  positions, and the pace; the SQL is the reference for the read model's
  semantics, not its shape.

Where the prototype and this spec differ, the spec wins:

- The head test reads Last sync, because the head-read moment does not exist
  yet.
- Overdue uses the setting group's fixed sync interval, not the scheduler's
  next due sync (grilling Q13).
- "Unavailable" is not its own reason; those Channels show "sync failed" or
  frozen, under "No sync can fix these" (grilling Q14).
- The record lives in a scratch table and the client sends it; the spec has the
  server check at freeze and store it in the frozen Scope.
- Artifacts made before the record are reconstructed from sync logs; the spec
  says they read "not checked".
- The Coverage tab and "Open in a tab" exist; they are out of scope.
- Confirmed gaps are not cleaned, so hole counts run high.
- The scheduler's successor and its metadata line are not prototyped.

## Further Notes

- About 6% of followed Channels show unexplained holes on any day, so expect
  the gate to appear often until the gap hygiene and the head-read moment land.
- The prototype's scratch table on the deployment it ran against
  (`<schema>.complete_window_runs`) is dropped when the prototype is done.
