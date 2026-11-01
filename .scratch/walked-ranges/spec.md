# Spec: Walked ranges and a live window check (ADR-044)

**Status:** ready-for-agent

Decided in a grilling session on 2026-11-01 and recorded in ADR-044, which
supersedes ADR-043's three tests and its walk-back repair. The plan and the
staging measurements are in `docs/window-check-realtime-plan.md`. Terms are
the glossary's: Walked range, Hole, Incomplete Channel, Complete window,
Unproven Posts, Behind, Overdue, Left out.

## Problem Statement

When I open the Action tab, or click Generate, the window check takes a long
time to answer: a median of 17 seconds on staging, up to 47. While the gate
waits on a sync it asks the whole check again every 2 seconds, so I watch a
spinner for most of a minute before anything moves.

And when it answers, it is mostly wrong. It tells me 292 of my 364 Channels
have holes, including Channels whose whole history was walked from the newest
Post to the first. Nearly all of those holes are Posts that were deleted, or
are part of an album, which Telegram never shows publicly. The workspace holds
everything there is to hold, yet the gate offers to sync them, the Artifact
records them as Incomplete, and Unproven Posts counts Posts that do not exist.
When a real hole does exist, the sync repairs it by walking back from the
newest page and re-reading every page it already holds, and the scheduler
never repairs one in the middle of a Channel's history at all.

## Solution

The workspace remembers, for each Channel, which stretches of its history a
sync walked page by page without a break: its Walked ranges. A post id missing
inside a Walked range is a Post that does not exist publicly, never one the
workspace lacks. A Hole is only the ids between two Walked ranges, which nobody
has read. A Channel is Complete for a window when one Walked range spans it.

Because the ranges are stored, the check reads a few rows per Channel instead
of every Post, and answers in milliseconds. Channels walked in one piece read
Complete. A real Hole is repaired by jumping straight to it and reading the one
or two pages missing, and the scheduler does that by itself.

The workspace also tells my browser the moment a sync changes a Channel, and my
browser asks the check again for that Channel alone. The banner and the gate's
rows update about a second after the Posts land, with no polling.

## User Stories

### A check I do not wait for

1. As a person opening the Action tab, I want the window check to answer in well under a second, so that the banner is there when I look at it.
2. As a person, I want the check to cost the same whatever the window's length, so that a 90-day window is as quick as a 1-day one.
3. As a person with hundreds of Channels selected, I want the check to stay quick, so that a large Scope is not punished.
4. As a person clicking Generate, I want the gate to open on a fresh answer at once, so that I decide on what is true now.
5. As a person, I want the check to stay quick while syncs are running on the deployment, so that a busy worker does not stall my gate.
6. As an Operator, I want the check not to read the whole Posts table, so that one person's banner does not slow everyone's syncs.

### Holes that are real

7. As a person, I want a Channel walked from its newest Post back past my window's Start to read Complete, even when Posts inside it were deleted, so that I am not asked to fix what cannot be fixed.
8. As a person, I want ids that belong to an album, or that Telegram hides from its public view, never to count as a Hole, so that a Hole means Posts the workspace may lack.
9. As a person, I want a Hole to be only the stretch between two Walked ranges, so that every Hole I see is something a sync can read.
10. As a person, I want a Hole to read "hole: up to 4 posts, 7:13 PM to 7:30 PM", so that I know 4 is the most it can be, since some of those ids may be deleted.
11. As a person, I want Unproven Posts to count a Hole's missing ids as the upper bound it is, so that the "~" figure never undercounts.
12. As a person, I want a sync that was cut short (at the iteration limit, by a failure or by a cancel) to still count the pages it read, so that a partial walk proves what it saw.
13. As a person, I want a walk that reaches a Post another walk already read to join the two into one Walked range, so that consecutive syncs do not leave a Hole where they meet.
14. As a person, I want Posts imported from a file, or upserted without a walk, to prove nothing about their neighbours, so that an imported Channel reads Incomplete until a sync reads it.
15. As a person, I want imported Posts still counted among the Posts my window holds, so that the share Unproven Posts shows stays honest.
16. As a person, I want a Channel whose newest page was read after my window's End to pass the end test only when that read joins the range spanning my window, so that a fresh head read above a Hole does not hide the Hole.
17. As a person, I want "history short of the Start" to mean no Walked range reaches back to the Start or to the Channel's first Post, so that the reason names what is missing.

### Repairs that read only what is missing

18. As a person pressing Sync in the gate, I want a sync to jump to each Hole and read only its missing pages, so that repairing a 30-day window costs a few Requests, not hundreds.
19. As a person, I want a sync that must reach my window's Start to start from the lowest page it holds and walk down from there, so that it never re-reads pages it already has.
20. As a person, I want a repair walk to stop as soon as a page reaches the Walked range below, so that it reads nothing twice.
21. As a person whose Budget is tight, I want repairs charged and laned like any sync, so that a repair never bypasses my Budget or its ceiling.
22. As a person who relies on scheduled successors, I want the scheduler's regular sync to repair a Channel's Holes within the scrape cutoff after reading its head, so that an unattended Artifact does not carry the same Hole forever.
23. As a person, I want a Hole that a repair walk could not finish (cut short again) to shrink to what is still unread, so that progress is kept between attempts.
24. As a person, I want a Hole older than the scrape cutoff left alone by the scheduler, so that retention and repair do not fight.
25. As a person, I want the gate's sync to still join a sync already in flight for a Channel, and queue another when that one read its head before the window's End, as ADR-043 decided, so that nothing is synced twice.

### Retention

26. As an Operator, I want retention to raise a Walked range's bottom to its lowest remaining Post, so that a range never claims Posts that were deleted for age.
27. As a person, I want a range to stop claiming the Channel's first Post once retention deletes that Post, so that "reached the first Post" stays true.
28. As a person, I want a window whose Start is before the retention cutoff to keep reading "before the retention cutoff", so that I know no sync can help.

### Moving to Walked ranges

29. As an Operator upgrading a deployment, I want Walked ranges built from the Posts already held, so that Channels walked in one piece read Complete the moment the upgrade lands.
30. As an Operator, I want two consecutive held Posts joined into one range when the same sync job stored both, or when every id between them was a confirmed gap, so that the backfill uses what the workspace actually knows.
31. As an Operator, I want the few places where two sync jobs' Posts meet left as Holes rather than guessed closed, so that the backfill claims nothing it cannot prove.
32. As an Operator, I want those remaining Holes repaired by the scheduler after the upgrade, so that they close without anyone acting.
33. As an Operator, I want the per-id confirmed-gap records retired once the ranges exist, so that the workspace keeps one account of what was walked.
34. As an Operator, I want the backfill safe to run on a live deployment, so that the upgrade needs no downtime beyond the usual migration.
35. As a person, I want Artifacts made before the upgrade to keep their frozen records unchanged, so that History does not rewrite what an Artifact lacked at the time.

### Posting pace

36. As a person, I want Unproven Posts for an end or start stretch to use each Channel's own posting pace as before, so that the figure means the same thing.
37. As a person, I want that pace stored when a sync reads the Channel's newest page, so that the check never recomputes it.
38. As a person, I want a Channel with less than an hour of pace history to keep making the total a floor ("~40+"), so that an unknown pace is never read as zero.

### A live check

39. As a person on the Action or Posts tab, I want the banner to change about a second after a sync stores Posts for one of my Channels, so that I see progress as it happens.
40. As a person, I want that to happen whichever Account's sync stored the Posts, including the scheduler's, since the Posts are shared, so that I benefit from every sync.
41. As a person waiting in the gate, I want each row to flip as its Channel's sync lands, instead of the whole list refreshing every 2 seconds, so that I can see which Channels are done.
42. As a person, I want the gate to continue the moment the last Channel it waits on lands, so that I do not wait for the next poll.
43. As a person, I want only the Channels that changed asked again, so that a bulk sync of hundreds of Channels does not ask the whole check hundreds of times.
44. As a person, I want changes arriving in a burst gathered into one ask per second, so that a busy sync does not flood my browser or the API.
45. As a person, I want the banner's totals (Unproven Posts, its share, the floor) recomputed from the updated Channels, so that the line always matches the rows.
46. As a person, I want to hear only about Channels I follow, so that another Account's Channels never reach my browser.
47. As a person in View-as, I want the live updates to answer for the Account I am viewing, so that View-as shows what that Account sees.
48. As a person whose connection drops, I want the browser to ask the whole check once when it reconnects, so that a change missed while offline is never lost.
49. As a person with a Live window, I want the check asked again as the window's End moves, so that "last 18 h on 149" keeps counting without a sync.
50. As a person, I want a Fixed window not asked again on a clock tick, so that nothing is fetched when nothing can change.
51. As an Operator, I want one listening connection on the API however many browsers watch, so that live updates cost one database connection.
52. As an Operator, I want the worker's notification to stay small (the Channel's name), so that it never meets the notification size limit.

### Unchanged behaviour

53. As a person, I want every reason, its order, Behind and Overdue, and the gate's controls to work exactly as ADR-043 says, so that only the proof and the speed change.
54. As a person, I want the frozen record an Artifact keeps to still be computed by the server at the gate's moment, so that the browser's view is never the record.
55. As a person in another Account, I want Walked ranges shared like Posts, so that one Follower's walk proves the window for every Follower of that Channel.

## Implementation Decisions

### Walked ranges

- A new corpus-shared table of Walked ranges, one row per range per Channel: the Channel name, the lowest and highest post id read, the publish times of the Posts at those two ids, when the top was read, and whether the walk reached the Channel's first Post. It is follow-scoped in the tenancy seam, keyed on the Channel name like Posts and confirmed gaps are today.
- One aggregate module is the sole writer of the table. Its interface is small: record a page a walk read (Channel, the walk's current range, the page's lowest and highest id and their times, whether it was the head page and when it was asked for, whether it reached the first Post); merge ranges that touch or overlap; trim a Channel's ranges below a post id (retention); and read a Channel's ranges.
- A walk's range grows page by page. Pages chain through each page's next id, and the backfill pass restarts at the lowest stored Post, so a walk is always contiguous with a range. A page that contains a Post already inside a range merges the two.
- The range is written in the same transaction as the page's Posts, so a walk cut short keeps exactly the pages it applied.
- A Post stored by bulk upsert or import writes no range.
- Confirmed gaps are retired: the per-id table, its writers in the sync, the gap clearing added to the Post writer in CW-01, and the gap pruning in retention go. Their export section goes with them, and the import tolerates documents that still carry it.

### The check

- The check stays a server-side read model behind the same route, with the same request and response shapes.
- A Channel is Complete when one Walked range spans the window: its top was read at or after E, or it holds a Post published after E; its bottom holds a Post at or before the Start, or it reached the Channel's first Post.
- The unproven stretches come from the ranges: the end stretch from the top range's newest Post to E; a Hole for each space between consecutive ranges inside the window, its missing ids being the ids between them minus any held Posts there; the start stretch from the Start to the lowest range's bottom. Reasons, their order, Behind, Overdue and the overlays (skipped, timed out, refused) are unchanged.
- The check reads the Account's Follows with their groups, the Channels' ranges, the stored pace, the last sync logs, the syncs in flight, and one index-only count of held Posts in the window per Channel. It never scans a Channel's whole history.
- The response's per-Channel verdict is unchanged in shape. A Hole's count keeps its field; the browser words it as an upper bound.
- The check accepts any subset of Channel names, and answering one Channel costs the same as that Channel's share of a full check, so the browser can ask for changed Channels alone.

### Posting pace

- Each Channel gains a stored posting pace (Posts an hour over the week before its head-read moment, no earlier than its first Post or the scrape cutoff), written by the sync in the same place it stamps the head-read moment. A span under an hour stores no pace.
- The check reads it instead of counting the week's Posts.

### Repair

- The gate's sync stops sending a walk-back moment. It sends, per Channel, where to read: each Hole inside the window and, when the start test fails, the Start.
- The sync orchestrator gains a hole pass: start a walk at a Hole's upper range's lowest id and stop when a page reaches the range below, or at the Start for a start repair. It replaces the walk back from the head.
- The scheduler's regular sync runs the hole pass for each of the Channel's Holes within the scrape cutoff after its head pass, newest first, under the usual iteration limit, lanes, Budget and ceilings. A Hole the pass could not finish shrinks to what is still unread.
- Joining a sync in flight, and queueing behind one whose head read came before E, are unchanged.

### Retention

- Retention, after deleting a Channel's old Posts, trims its ranges: a range wholly below the lowest remaining Post goes; one straddling it starts at that Post, and loses its first-Post claim.

### Backfill migration

- A migration creates the range table and builds ranges from the Posts held: walking each Channel's Posts in id order, two consecutive Posts share a range when the same sync job stored both or every id between them is a confirmed gap. A range's top-read moment is the Channel's head-read moment for the range holding its newest Post, and unknown for the rest. The first-Post claim goes to the lowest range of a Channel whose walk reached its first Post.
- The migration then drops the confirmed-gap table. It holds its own frozen logic and imports no app code, as the CW-01 migrations do.
- It works one Channel at a time, so it holds no long lock on Posts.

### Live updates

- The worker sends a notification, carrying only the Channel's name, when a walk applies a page that stored Posts or read the head, and when a Hole closes. It rides the existing process-crossing notification module on its own channel name.
- The API keeps one listening connection, fans out in process, and serves one Account-wide event stream. Each subscriber gets the names of Channels it follows, gathered for up to a second. The stream is a safe read, so it is open to View-as and answers for the viewed Account.
- The browser subscribes while the Action or Posts tab is open. On an event it asks the check for the named Channels alone and merges their verdicts into the cached answer, then recomputes the Scope's totals (held Posts, Unproven Posts, the floor) from the verdicts.
- The gate's wait for syncs it joined listens to the same events instead of asking every 2 seconds.
- On reconnect the browser asks the whole check once.
- A Live window's tick still asks the server; a Fixed window's never does. The browser never computes a verdict.

## Testing Decisions

- A good test drives the system from its edge and asserts what a person or the next caller observes: the verdict the check answers, the pages a sync asks Telegram for, the events a browser receives. No test asserts a range row directly, except the backfill migration's, which has no other observer.
- **The main seam is "sync in, check out."** A test fakes Telegram's pages at the sync's page fetch (prior art: the Complete window sync tests), runs one Channel's sync, then asks the window check route and asserts the verdict. This covers ranges being written, merged, kept on a cut-short walk, ids missing inside a range not being Holes, imported Posts proving nothing, and the end and start tests. The existing window check tests convert to this seam where they seed confirmed gaps; tests about reasons, Behind, pace and isolation keep their current shape.
- **Repair is tested through the same seam**: the test asserts which page ids the sync asked for (prior art: the walk-back test that records `before_id`s) and then the verdict. One test each for a gate repair of a Hole, a start repair, the scheduler's hole pass after its head pass, a Hole beyond the scrape cutoff left alone, and a repair cut short that leaves a smaller Hole.
- **The backfill migration** is tested by loading the migration's module and running its upgrade on seeded Posts and confirmed gaps (prior art: the CW-01 gap-clearing migration test): same-job runs join, confirmed gaps join, a junction between jobs stays a Hole, the top-read moment lands on the newest range, the first-Post claim lands on the lowest.
- **Retention** is tested by running the retention job on a Channel with old Posts and asserting the check's verdict for windows above and below the cutoff (prior art: the retention tests under jobs).
- **Speed** is guarded by one test that seeds a Channel with many Posts and asserts the check's query plan touches no sequential scan of Posts, so a regression to a whole-table read fails the suite rather than staging.
- **Live updates**, backend: a worker-side page applied in a test produces an event on the Account's stream for a followed Channel and none for an unfollowed one (prior art: the notification module tests and the sync job event stream tests); bursts are gathered; View-as answers for the viewed Account and joins the View-as read-path inventory.
- **Live updates**, frontend: unit tests of the merge (one Channel's new verdict replaces its row and the totals follow) and of the gate flow ending on an event instead of a poll (prior art: the gate and window-check unit tests). The "up to N posts" wording joins the window-check phrasing tests.
- Every guard is mutation-checked before it is trusted, and each test's docstring names its mutation, as the CW tests do.

## Out of Scope

- Computing verdicts in the browser. The check stays on the server.
- A faster version of the current confirmed-gap check before ranges ship.
- Changing the reasons, their order, Behind, Overdue, the gate's controls, the Artifact's frozen record or History's marks.
- Bridging small junctions between sync jobs in the backfill.
- WebSockets, or pushing verdicts rather than Channel names.
- Re-checking Artifacts already frozen: their records stay as they were.
- Raising the staging database's shared buffers or shared memory.

## Further Notes

- Measured on staging on 2026-11-01: the check took a median of 17 s (max 47 s) over 19 slow requests in 48 h; the Posts read alone averaged 13.6 s, reading all 1.1 GB of Posts through 128 MB of shared buffers. Of 21,593 runs of missing ids, 21,246 (98.4%) had both neighbours stored by the same sync job, and the 307 others were all 10 ids or fewer.
- The root cause of the false holes: the sync confirms a gap only when both neighbouring Posts are already stored, and it checks before storing the page, so a page read for the first time never confirms its gaps. Walked ranges remove that path entirely rather than reorder it.
- Ticket order: the range table, its writer and the backfill first; then the check reading ranges; then repair and the scheduler's hole pass; then the live updates. The live updates depend only on the check accepting a subset of Channels cheaply.
- The staging database runs parallel workers with 64 MB of shared memory; the backfill should run with parallel workers off.
