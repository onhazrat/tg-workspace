# Spec: Directory refresh by expected new posts (ADR-045)

**Status:** ready-for-agent

Decided in ADR-045 and grilled on 2026-11-01; the plan with every decision and
the staging sizing is `docs/directory-refresh-by-posts-plan.md`. Ticket ids use
the prefix `DRP`. Terms are the glossary's: Directory entry, Refresh, Recheck,
Refresh target, Posting rate, Priority boost, Operator.

## Problem Statement

As the Operator, I cannot make the Directory spend its Requests where they
matter. Every live Directory entry comes due for a Refresh a fixed number of
days after its last answer, a week by default, whatever its Channel publishes.
A Channel posting twenty times a day rolls its preview page over daily, so a
weekly Refresh sees about one day in seven of what it cites, and the crawl
never learns of the Channels it cited the other six days. A Channel that has
not posted for three months costs the same Request every week to learn that
its subscriber count moved.

The only lever I have is that one window. Widening it starves the busy
Channels; narrowing it multiplies the waste on the quiet ones. On staging the
week window asks for about 102,700 Refreshes a day against about 58,000
answers the proxies deliver, so 300,000 of 719,000 live entries are overdue,
and they drain in alphabetical order because every Refresh carries the same
priority. I cannot see any of this from Settings.

I also lose choices I make. A Priority boost I set on production is wiped the
next time the Directory merge brings in an entry staging checked more recently.

## Solution

A Directory entry comes due when its Channel is expected to have published its
Refresh target in new Posts since the fetch that last answered it:

```
due = last conclusive answer + clamp(Refresh target / Posting rate, min, max)
```

The Refresh target is a deployment setting, 20 by default (one preview page),
and I can override it on a single entry or on a whole Directory view. The
shortest and longest waits are deployment settings too, 4 and 120 days by
default, and they bound every entry, overrides included, so the total traffic
stays my choice. The Posting rate counts the sample's Posts from the oldest of
them up to the fetch that took them, so a Channel that went quiet reads slow
rather than as busy as its last burst. An entry with too few samples to have a
rate waits the longest.

Due entries are taken by effective priority first, so a Priority boost still
decides which goes first, and then most overdue first. A boost never makes an
entry due sooner; the Refresh target does that.

While I edit the three settings, Settings shows the Refreshes a day those
values would cost next to what the proxies actually fetched for the Directory
over the last week, so I can pick a target I can afford before saving. Saving
moves every live entry's due date at once.

The Directory shows two optional columns, Refresh target and Next refresh, so
I can see what I set and when each entry is next fetched. A live entry keeps
its sample until its next Refresh replaces it, however long it waits. The
Directory merge keeps my Priority boosts and Refresh targets on the deployment
being merged into.

## User Stories

1. As the Operator, I want a busy Channel's Directory entry refreshed more often than a quiet one's, so that the crawl sees most of what busy Channels cite.
2. As the Operator, I want a Channel that has not posted for months refreshed rarely, so that it stops costing a Request a week.
3. As the Operator, I want one deployment-wide Refresh target, so that I can set how many new Posts an entry may accumulate before it is fetched again.
4. As the Operator, I want the Refresh target to default to 20, so that a Refresh lands about when the previous preview page has fully rolled over.
5. As the Operator, I want to override the Refresh target on one Directory entry, so that a Channel I care about is fetched on its own terms.
6. As the Operator, I want to set a Refresh target on every entry a Directory view matches, so that I can tune a class of Channels in one action.
7. As the Operator, I want to clear an entry's Refresh target, so that it follows the deployment's again.
8. As the Operator, I want a cleared entry to follow later changes to the deployment's Refresh target, so that I never have to stamp the default onto rows.
9. As the Operator, I want a Refresh target outside 1 to 1000 refused with nothing changed, so that a typo cannot stop or flood refreshing.
10. As the Operator, I want a shortest wait between Refreshes, defaulting to 4 days, so that no Channel, however busy, can consume the probe budget.
11. As the Operator, I want a longest wait, defaulting to 120 days, so that a dormant Channel is still noticed if it goes private, is renamed or loses subscribers.
12. As the Operator, I want the shortest and longest waits to bound per-entry targets too, so that a target set on a whole view cannot undo the budget.
13. As the Operator, I want settings where the shortest wait exceeds the longest refused, so that the bounds always mean something.
14. As the Operator, I want an entry with too few samples to measure a rate to wait the longest, so that near-empty Channels cost almost nothing.
15. As the Operator, I want dead verdicts (bots, groups, personal accounts, private or deleted channels) never to come due on their own, as today, so that they stay free.
16. As the Operator, I want the Posting rate measured up to the fetch that took the sample, so that a Channel that went quiet reads slow rather than busy.
17. As the Operator, I want the Posting rate measured to that fetch and not to now, so that "not looked at yet" is never read as "stopped posting".
18. As the Operator, I want the Directory's Posts/week column to show the Posting rate the Refresh uses, so that what I read and what is scheduled agree.
19. As the Operator, I want due entries taken by Priority boost first and then most overdue first, so that my boosts still lead and nothing waits behind the alphabet.
20. As the Operator, I want a Priority boost to change only an entry's place among due entries, never its due date, so that the two levers answer different questions.
21. As the Operator, I want handles that have never been answered to keep going before Refreshes, as today, so that the crawl keeps growing.
22. As the Operator, I want an on-demand Refresh to stay available and jump the queue, as today, so that I can get a current answer sooner than the shortest wait.
23. As the Operator, I want an entry I asked to refresh on demand to stay due when I change the settings, so that my request is not silently pushed out.
24. As the Operator, I want saving the Refresh target or either wait to move every live entry's due date immediately, so that a change takes effect today, not over 120 days.
25. As the Operator, I want changing an entry's own Refresh target to move that entry's due date immediately, so that I see the effect at once.
26. As the Operator, I want Settings to show the projected Refreshes a day for the values I am editing, before I save, so that I know what a target costs.
27. As the Operator, I want the projection to say how many entries sit at the shortest and at the longest wait, so that I can tell which bound is doing the work.
28. As the Operator, I want the last seven days' measured Directory probe Requests a day beside the projection, so that I can compare cost with capacity.
29. As the Operator, I want the projection computed only when I edit the values, not when Settings opens, so that Settings stays fast.
30. As the Operator, I want the longest-wait setting to keep any value I stored for the old refresh window, so that an upgrade does not change my policy behind my back.
31. As the Operator, I want the three settings found by search under their Setting ids, so that I can link to and reach them like any other Setting.
32. As the Operator, I want an optional Refresh target column in the Directory, showing an override or the deployment's value greyed, so that I can see what I set.
33. As the Operator, I want an optional Next refresh column in the Directory, so that I can see when each entry will be fetched.
34. As the Operator, I want both columns sortable, so that I can find the entries due soonest or the ones I overrode.
35. As the Operator, I want setting and clearing a Refresh target to sit beside the Priority boost in the Directory, so that both per-entry levers are in one place.
36. As the Operator, I want a live entry's sample kept until its next Refresh replaces it, however long it waits, so that its sample Posts stay searchable and visible in the Directory.
37. As the Operator, I want samples of entries that are no longer refreshed still collected on the sample retention window, as today, so that dead entries do not hold storage.
38. As the Operator, I want a followed Channel's entry kept current by sync at no Request cost, as today, so that followed Channels never need a Refresh.
39. As the Operator, I want deploying this to recompute every existing entry's Posting rate and due date, so that the backlog under the old window is resolved on day one.
40. As the Operator, I want the Directory merge to keep my Priority boosts on the deployment being merged into, so that staging's crawl never wipes production's choices.
41. As the Operator, I want the Directory merge to keep my Refresh targets the same way, so that per-deployment tuning survives a merge.
42. As the Operator, I want an entry new to the deployment being merged into to arrive with the source's boost and target, so that nothing is lost on a fresh row.
43. As an Account without permission to manage the Directory, I want setting a Refresh target refused, as the boost is, so that only Operators tune the crawl.
44. As the Operator on a deployment whose Directory probe Request kind is off, I want the settings and targets still editable and the due dates still computed, so that the policy is ready when probing resumes.

## Implementation Decisions

### The rule

- The Posting rate replaces the stored posts per week in the same column, keeping its unit (Posts per week): the sample's Post count divided by the time from its oldest Post to the conclusive fetch that took it. It needs at least the existing minimum sample count; below that it is not measured. The UI label "Posts/week" stays.
- The due-date computation that runs when a conclusive verdict is written computes `checked_at + clamp(target / rate, min, max)`, with the target the entry's own or the deployment's, and the longest wait when the rate is not measured. A dead verdict still gets no due date; the provisional unavailable case keeps its current behaviour.
- The sync path keeps calling the same computation with the stored rate; sync writes no samples and does not change the rate.
- The queue's order becomes effective priority, then due date ascending, then handle. The Refresh priority constant is unchanged, so never-answered handles still precede Refreshes. The index the stale leg reads must serve this order.

### Per-entry Refresh target

- A nullable integer column on the Directory entry; null means the deployment's. Valid values are 1 to 1000.
- The Directory aggregate gains one operation that sets or clears the target on a list of handles or on a Directory view statement, mirroring the Priority boost's operation: all or nothing, it validates every value before writing, skips handles the Directory does not hold, commits, and returns how many entries changed. It recomputes the due dates of the entries it changed, leaving entries made due on demand due.
- A route beside the boost route sets or clears the target, gated by the same permission, answering 422 on an out-of-range value or an empty handle list with nothing changed. It joins every route inventory (`scripts/route-guards.sh`).
- The Directory list and detail reads expose the override (null when unset) and the due date; the client shows the deployment's target when the override is null.

### Settings

- Three deployment settings in the Directory settings row, declared in the Settings registry: `directoryRefreshTarget` (Setting id `directory.deployment.refreshTarget`, 1 to 1000, default 20), `directoryRefreshMinDays` (`directory.deployment.refreshMinDays`, at least 1, default 4) and `directoryRefreshMaxDays` (`directory.deployment.refreshMaxDays`, renamed from `directory.deployment.refreshDays` / `directoryRefreshDays`, at least 1, default 120). Each has an env default documented in `.env.example`; the old refresh-days env default is renamed with it.
- A save where min exceeds max is refused with nothing written.
- Saving any of the three recomputes the due date of every refreshable entry in one statement from its last conclusive answer, its stored rate and its effective target. Rows already due on demand stay due. Rows that are not refreshable are untouched.
- A projection read, under the same permission as the settings, takes target, min and max as query parameters and answers the projected Refreshes a day, the count of entries at the shortest wait, the count at the longest, and the last seven days' average of Directory probe Requests a day from the Request stats daily totals. It scans live entries' stored columns only, never the samples. The Settings page calls it debounced as the values change, never on load.

### Retention

- Sample retention collects samples only from entries with no due date (not refreshable). A live entry's samples are replaced only by its next conclusive fetch. The retention window and its setting are unchanged.

### Migration

- One revision: renames any stored `directoryRefreshDays` to `directoryRefreshMaxDays`; adds the per-entry target column; rebuilds every stored Posting rate from stored columns (the oldest sample time is the last Post time minus (sample count - 1) / old rate; the new rate is sample count over the time from there to the last conclusive answer); then recomputes every live entry's due date from the stored settings, falling back to 20 / 4 / 120. Pure SQL, frozen in the revision. On staging it scans about 700,000 rows in prestart.

### Directory merge

- `scripts/merge-directory.sh` leaves `priority_boost` and the Refresh target column out of the update it applies to existing entries. A row the target does not hold still takes every column from the source.

### Frontend

- Settings: the three settings with the live projection and measured throughput beside the target, laid out as the existing Directory settings are.
- Directory: set and clear a Refresh target on one entry and on the selection or view, beside the Priority boost; two optional sortable columns, Refresh target (override, or the deployment's greyed) and Next refresh, through the existing columns machinery.
- The generated client is regenerated after the routes change.

## Testing Decisions

A good test here drives the system through a public seam and observes what an entry holds afterwards, what the queue hands out next, or what a route answers. Never a column layout or an internal call. Every new assertion is mutation-tested (`python3 scripts/mutate.py`), and frontend guard mutations go in `docs/agents/guard-mutations.json`.

- **Probe write path and queue** (prior art: `test_directory_refresh.py`, `test_directory_statistics_write_path.py`). A burst after a long silence yields a low Posting rate; a rate ends at the fetch, not at now; due = answer + target / rate inside the bounds; a busy Channel is clamped to the shortest wait and a dormant one to the longest; no rate means the longest; a per-entry target moves only its entry and is still clamped; dead verdicts stay never due; the queue hands out the boosted entry first, then the most overdue, and never-answered handles before both; a boost does not change a due date; sync keeps using the stored rate.
- **Routes** (prior art: `test_directory_boost.py`, `test_settings_registry.py`). Set and clear on handles and on a view; refusal without the permission; 422 with nothing changed for out-of-range and empty input; a settings save moves due dates (observed through the queue) and leaves an on-demand Refresh due; min above max is refused; the projection answers the expected counts on a small fixture and its measured throughput matches the Request stats.
- **Sample retention** (prior art: `test_directory_samples.py`). A live entry's samples older than the retention window survive; a dead entry's are collected as before.
- **Migration** (prior art: `test_tag_move_migration.py`, which runs the revision's own statement). The rebuilt rate matches a samples-based rate on fixture rows; a stored `directoryRefreshDays` arrives as `directoryRefreshMaxDays`; due dates are recomputed for live entries only.
- **Frontend** (prior art: `DirectoryBoost.test.tsx`, `settings-page.spec.ts`). Component tests for setting and clearing a target and the two columns; one mocked Playwright spec for the debounced projection in Settings, run with one worker.
- **Directory merge**: no automated test. Verified by one manual run between two local databases, showing a boosted, targeted entry on the target keeping both after a merge that brings a newer verdict.
- Existing guards that will fire and must be satisfied, not deleted: the route inventories, the env example matching defaults, the Settings registry classification, the generated client.

## Out of Scope

- Ordering due entries by expected missed Posts. Not indexable; revisit only if the Refresh backlog stays large after this ships.
- Recomputing a followed Channel's Posting rate from its synced Posts; it stays at its last probe.
- Any change to how new handles are harvested or prioritised, or to the probe lane's pacing.
- A "never refresh" per-entry value.
- Changing staging's or production's stored settings; an Operator does that after deploy.

## Further Notes

- Staging sizing on 2026-11-01: the defaults project 42,300 Refreshes a day plus about 15,400 new handles, against about 58,000 conclusive answers a day. Full tables are in the plan.
- The Directory probe Request kind is off on production, so production schedules Refreshes it does not send; staging is the crawler.
- The default for the longest wait rises from 7 to 120 days, but a deployment that stored 7 keeps 7.
