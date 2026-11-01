# ADR-045: A Directory entry comes due when its Channel has likely posted its Refresh target

**Status:** Accepted (2026-11-01). Decided in a grilling session; plan and
staging sizing in `docs/directory-refresh-by-posts-plan.md`; spec and tickets (DRP) in
`.scratch/directory-refresh-by-posts/`.
Supersedes ADR-014's fixed refresh window and ADR-015's definition of posts per
week, and keeps ADR-015's promise that a live entry's samples never age out.

## Context

A live Directory entry came due for a Refresh a fixed `directoryRefreshDays`
(a week) after its last answer, whatever its Channel published. That spends
Requests in the wrong places. A preview page holds about 20 Posts, so a Channel
posting 20 a day rolls it over daily and a weekly Refresh sees one day in seven
of what it cites; the crawl that ADR-020 drives from samples misses the rest. A
Channel silent for three months costs the same Request a week to learn its
subscriber count. On staging on 2026-11-01 the fixed window asked for 102,688
Refreshes a day against about 58,000 conclusive answers a day, and 300,263 of
718,818 live entries were overdue, draining alphabetically because every
Refresh carried the same priority.

## Decision

An entry comes due when its Channel is expected to have published its Refresh
target in new Posts since the fetch that last answered it:

```
due = last conclusive answer + clamp(Refresh target / Posting rate, min, max)
```

- **Posting rate** counts the sample's Posts over the time from the oldest of
  them to the fetch that took the sample. It ends at that fetch, not at the
  newest Post, so a burst after a long silence reads slow; and not at now,
  because "we have not looked" is not "it has not posted". It replaces the old
  newest-to-oldest posts per week in the same column, so the Directory shows
  the number the Refresh uses.
- **Refresh target** is a deployment setting (default 20, one preview page)
  that each entry may override, 1 to 1000. It is per entry from the start
  because the Priority boost showed that per-entry control gets used. It is set
  and cleared on one entry or on a Directory view.
- **min and max** are deployment settings in whole days (defaults 4 and 120;
  `directoryRefreshDays` becomes the max). They clamp every entry, per-entry
  targets included: the minimum is what keeps total traffic an Operator's
  choice rather than the corpus's, and a target set on a whole view must not
  undo it. An entry needed sooner gets an on-demand Refresh. An entry with too
  few samples for a rate is due at the max.
- **The Priority boost orders entries already due and never makes one due
  sooner.** Due entries are taken by effective priority, then most overdue
  first. The Refresh target says when; the boost says which first.
- Dead verdicts are still never due, and a followed Channel's sync still keeps
  its entry current for free.

Settings show the projected Refreshes a day for the values being edited beside
the last 7 days' measured Directory probe Requests, because a target means
nothing without its cost. On staging the defaults project 42,300 Refreshes a
day, plus about 15,400 new handles, against about 58,000.

## Considered options

- **Keep a fixed window, longer.** Rejected: any single number over-fetches
  quiet Channels and under-fetches busy ones; the spread of Posting rates on
  staging runs from under one a week (188k entries) to over 20 a day (23k).
- **Rate from newest to oldest sample** (the existing posts per week).
  Rejected: it reads a burst after silence as a busy Channel.
- **A deployment-wide target only.** Rejected by the Operator from experience
  with the Priority boost.
- **Per-entry targets that bypass the minimum, or a "never refresh" value.**
  Rejected: either reopens the budget; a huge target already lands on the max,
  three Requests a year.
- **A boost that also shortens the wait.** Rejected: it would make two levers
  answer the same question.

## Consequences

- **Sample retention collects only entries that are no longer refreshable.**
  ADR-015 relied on the refresh window being far shorter than the 30-day sample
  retention. Waits up to 120 days break that, so a live entry keeps its one
  sample page until its next Refresh replaces it, and the retention window
  applies to dead entries only. Storage stays one page per live entry, as
  before.
- **Changing a target, min or max moves due dates at once**, in one update over
  the live entries; a row already made due on demand stays due. Deploying this
  backfills Posting rate from stored columns and recomputes every live entry's
  due date in one migration, which takes minutes on staging.
- **The Directory merge stops carrying Operator choices.** It took every column
  of the more recently checked entry, so staging's zero boost already wiped
  production's Priority boosts. The boost and the Refresh target are now kept
  on the deployment being merged into.
- A followed Channel's Posting rate stays at its last probe, since sync writes
  no samples. It only affects the Posts/week shown for followed Channels.
