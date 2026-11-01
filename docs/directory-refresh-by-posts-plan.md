# Directory refresh by expected new posts

Status: decisions agreed and grilled 2026-11-01, defaults 20 / 4 / 120; recorded
as [ADR-045](adr/ADR-045-refresh-by-expected-new-posts.md); spec and tickets
in `.scratch/directory-refresh-by-posts/`. Terms (Refresh, Recheck, Refresh target, Posting rate) are
in `GLOSSARY.md`.

## The problem

Every live Directory entry comes due `directoryRefreshDays` (7) after its last
conclusive answer, whatever it publishes. A Channel posting 20 a day rolls its
`t.me/s/` preview page over daily, so a weekly probe sees about one day in seven
of what it cites and the crawl misses the rest. A Channel silent for three
months costs the same Request a week to learn that its subscriber count moved.
Stale entries also drain alphabetically, because every Refresh carries the same
`REFRESH_PRIORITY`.

## The rule

An entry comes due for a Refresh when we expect its Channel to have published
its Refresh target in new Posts since we last looked:

```
refresh_due_at = checked_at + clamp(refresh target / posting rate, min, max)
```

- **Refresh target** is the entry's own `refresh_target` when set, else the
  deployment's `directoryRefreshTarget` (default 20, about one preview page).
- **Posting rate** is `posts_per_week`, redefined below.
- **min** is `directoryRefreshMinDays` (default 4). It bounds probe traffic:
  without it a Channel posting 500 a day is due hourly, and the total Request
  rate is set by the corpus rather than by the Operator.
- **max** is `directoryRefreshMaxDays` (default 120), renamed from
  `directoryRefreshDays`. A dormant Channel can still go private, be renamed or
  lose subscribers.
- **No rate** (fewer than `MIN_SAMPLES` = 5 samples): due at max.
- Dead verdicts stay never due (`is_refreshable` is unchanged).
- A followed Channel's sync keeps refreshing its entry for free;
  `record_sync_metadata` keeps calling `_schedule_refresh`, which uses the
  stored rate.

## Decisions

### The rule

1. **Posting rate ends at the last check, not at the newest Post or now.**
   `posts_per_week = count / (checked_at - oldest sample)`. Today it is
   `(count - 1) / (newest - oldest)` (`directory_statistics.py:164`), which reads
   a burst after a long silence as a busy Channel. Ending at now was rejected
   too: "we have not looked" is not "it has not posted". The same column is
   redefined rather than a second rate added, so the Directory's Posts/week
   column shows the number the Refresh uses. The UI label stays "Posts/week".
2. **Min and max are deployment settings**, both whole days, validated
   `min <= max`, and they **always apply, per-entry targets included**. The
   minimum is the budget guarantee, and a per-entry bypass could undo it across
   a Directory view in one action. An entry needed sooner gets an on-demand
   Refresh.
3. **The Priority boost orders due entries; it never makes one due sooner.**
   The Refresh target is the "when" lever and the boost the "which first" lever.
4. **Queue order is `effective_priority`, then `refresh_due_at`, then handle.**
   Pending (never answered) handles keep their lower priority number and still
   go before Refreshes.

### The per-entry Refresh target

5. **Per entry from the start**, a nullable `refresh_target` column where `NULL`
   means the deployment's. Chosen over a deployment-only target from experience
   with the Priority boost.
6. **Values 1 to 1000, or cleared.** No "never refresh" value: a large target
   already lands on the 120-day max, three Requests a year, and "never" would be
   a third kind of dead entry.
7. **Set and cleared on one entry or on a Directory view**, the way
   `boost_entries` takes a view statement. Set and clear only, no "add" mode.
8. **Two optional, sortable Directory columns**: "Refresh target" (the override,
   or the deployment's greyed) and "Next refresh" (`refresh_due_at`).

### Settings

9. **Setting ids**: `directory.deployment.refreshMaxDays` (renamed from
   `refreshDays`; old links stop resolving), `refreshMinDays`, `refreshTarget`.
   Fields `directoryRefreshMaxDays`, `directoryRefreshMinDays`,
   `directoryRefreshTarget`. A stored `directoryRefreshDays` moves to
   `directoryRefreshMaxDays`, so a deployment that stored 7 keeps 7 until an
   Operator changes it.
10. **A settings change recomputes due dates immediately**: one `UPDATE` over
    refreshable entries from `checked_at`, the stored rate and the effective
    target. A per-entry target change recomputes those entries. A row already
    made due on demand (`refresh_entries`) stays due.
11. **Projected probes/day while editing.** A read endpoint takes target, min
    and max as query parameters and returns probes/day and the counts at min
    and at max. Settings calls it debounced as the Operator types, never on page
    load (a full Directory scan, 1 to 3 s on staging warm).
12. **Measured throughput beside it**: the last 7 days' average Directory probe
    Requests per day from the Request stats daily totals, which already include
    new handles. The projection alone has no reference point.

### Deploy and merge

13. **One migration backfills and recomputes, in SQL.** It rebuilds Posting
    rate from stored columns (the sizing formula below, exact for every row with
    a rate) and recomputes `refresh_due_at` for live entries from the stored
    settings, falling back to 20 / 4 / 120. On staging that is a ~700k-row
    scan in prestart, so the deploy takes minutes.
14. **The Directory merge keeps the target's Operator choices.**
    `scripts/merge-directory.sh` overwrites every column of an entry the source
    checked more recently, which today already wipes a production Priority boost
    whenever staging probes that handle. `priority_boost` and `refresh_target`
    leave the merge's update list; a row new to the target still takes the
    source's values.
15. **Sample retention collects only entries that are no longer refreshable**
    (`refresh_due_at IS NULL`). Its 30-day default is shorter than most new
    waits, and ADR-015 relies on a live entry's samples never ageing out. A
    live entry keeps its one page until the next Refresh replaces it; storage
    stays one page per live entry. Chosen over raising retention above the max,
    which couples two settings.

## Staging sizing (2026-11-01)

Read-only, from stored columns: the redefined rate is rebuilt as
`sample_count / (checked_at - oldest)`, where the oldest sample is
`last_post_at - (sample_count - 1) / posts_per_week`. Scanning the samples table
instead timed out at 5 minutes. Script: kept in the session scratchpad, not the
repo.

718,818 live entries; 631,606 have a rate; **300,263 are due now**. The pending
queue holds 108 handles; the harvest adds about **15,400 entries a day**, all
answered the same day.

| Rate (redefined) | Entries | Last post | Entries |
|---|---|---|---|
| no rate | 87,212 | over 90 days ago | 141,755 |
| under 1/week | 187,966 | 30 to 90 days | 132,892 |
| 1/week to 1/day | 227,813 | 7 to 30 days | 269,047 |
| 1 to 5/day | 140,285 | under 7 days | 174,769 |
| 5 to 20/day | 52,622 | unknown | 355 |
| 20/day or more | 22,920 | | |

Refresh demand in probes/day, against a measured capacity of about **58,000
conclusive answers/day** (28 to 31 October, new handles included):

| Rule (target, min to max days) | Probes/day | At min | At max |
|---|---|---|---|
| Today: 7 days flat | 102,688 | | |
| 10, 1 to 90 | 111,060 | 42,677 | 253,752 |
| 20, 1 to 90 | 72,545 | 22,920 | 319,169 |
| **20, 4 to 120 (default)** | **42,300** | 75,540 | 289,700 |
| 20, 1 to 30 | 81,362 | 22,920 | 453,732 |
| 20, 2 to 90 | 57,133 | 42,677 | 319,169 |
| 40, 1 to 90 | 46,337 | 11,730 | 401,674 |

Reading: today's rule asks for nearly twice what staging can fetch, which is
the 300k backlog. A 1-day minimum spends a third of its budget on the 22,920
Channels posting 20 a day or more. The defaults were set to **20 / 4 / 120**
from this table: 42,300 Refreshes plus ~15,400 new handles is ~57,700 a day
against ~58,000, so it fits with almost no headroom. The cost is that 75,540
Channels posting 5 a day or more wait 4 days and are seen partially.

## Steps

- [x] Read-only staging sizing (above).
- [x] Grilling, two rounds; glossary terms added.
- [x] ADR-045, with superseded notes on ADR-014 and ADR-015.
- [x] Spec: `.scratch/directory-refresh-by-posts/spec.md` (ticket prefix `DRP`).
- [x] Tickets: DRP-01 (the rule, settings, projection, migration, retention,
  merge) and DRP-02 (per-entry target and the two Directory columns), in
  `.scratch/directory-refresh-by-posts/issues/`.

Likely ticket shape, for the spec to confirm:

- Backend rule: redefine Posting rate; `_schedule_refresh` computes the clamped
  due date; dequeue order; settings (rename and two new) with declarations; the
  backfill-and-recompute migration.
- Per-entry Refresh target: column and migration; set/clear on entries and on a
  view; recompute on change; the route joins the route inventories.
- Bulk recompute on settings save; projection endpoint with measured
  throughput.
- Frontend: the three settings with the live projection; set/clear target from
  the Directory beside the boost; the two optional columns.
- `merge-directory.sh`: keep `priority_boost` and `refresh_target` on the
  target.
- Retention: expire samples only for entries with no `refresh_due_at`.

## Verification

- Unit tests for the clamp, the no-rate case, the redefined rate (a burst after
  silence gives a low rate), per-entry targets still clamped, and the dequeue
  order, each mutation-tested.
- The migration against a copy with the stored-column formula checked against
  a samples-based rate on a handful of rows.
- `cd backend && uv run prek run --all-files`, `bash scripts/route-guards.sh`,
  then the backend suite.

## Out of scope

- Ordering due entries by expected missed Posts (`rate * overdue`). Not
  indexable; revisit only if the Refresh backlog stays large after this ships.
- A followed Channel's Posting rate stays frozen at its last probe; sync keeps
  its entry current, and only ~330 entries show a stale Posts/week.
- Any change to how new handles are harvested or prioritised.
