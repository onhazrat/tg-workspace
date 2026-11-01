# DRP-01: Entries come due by expected new posts

**What to build:** A live Directory entry comes due when its Channel has likely
published its Refresh target in new Posts since the fetch that last answered
it, `due = checked_at + clamp(target / Posting rate, min, max)`, as ADR-045
decides. The Operator sets the deployment's target, shortest wait and longest
wait in Settings. While editing those values, Settings shows the projected
Refreshes a day next to the last week's measured Directory probe Requests.
Saving moves every live entry's due date at once. Due entries drain by
effective priority, then most overdue first, not alphabetically. A live entry
keeps its sample until its next Refresh. The Directory merge stops wiping the
target deployment's Priority boosts. The spec is
`.scratch/directory-refresh-by-posts/spec.md`; this ticket covers every part of
it except writing a per-entry Refresh target and the two Directory columns
(DRP-02).

The per-entry `refresh_target` column is added here, nullable and unwritten.
That way the migration, the due-date computation and the bulk recompute honour
it from the start, and DRP-02 needs no migration.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## Acceptance criteria

The rule

- [ ] Posting rate (the stored posts per week, same column and unit) is the sample's Post count over the time from its oldest Post to the conclusive fetch that took it. A burst after a long silence reads slow. Below the existing minimum sample count it is not measured.
- [ ] A conclusive live verdict sets the due date to `checked_at + clamp(effective target / rate, min, max)`. The effective target is the entry's `refresh_target`, or the deployment's when null. With no rate, the wait is the longest. Dead verdicts still get no due date, and the provisional unavailable case behaves as today.
- [ ] A followed Channel's sync keeps refreshing its entry with the stored rate and writes no rate.
- [ ] The queue hands out never-answered handles first (unchanged priority constants), then due entries by effective priority, then due date ascending, then handle. An index serves the stale leg in that order.
- [ ] A Priority boost changes an entry's place in the queue, never its due date.

Settings

- [ ] There are three deployment settings in the Settings registry. `directoryRefreshTarget` (`directory.deployment.refreshTarget`, 1 to 1000, default 20). `directoryRefreshMinDays` (`directory.deployment.refreshMinDays`, at least 1, default 4). `directoryRefreshMaxDays` (`directory.deployment.refreshMaxDays`, renamed from `refreshDays` / `directoryRefreshDays`, at least 1, default 120). Each has an env default in `.env.example`, and the old env default is renamed.
- [ ] A save with min above max is refused with nothing written.
- [ ] Saving any of the three recomputes every refreshable entry's due date in one statement. An entry made due on demand stays due, and dead entries are untouched.
- [ ] A projection read, gated by the settings' permission, takes target, min and max as query parameters. It answers projected Refreshes a day, the count at the shortest wait, the count at the longest, and the last 7 days' average Directory probe Requests a day from the Request stats daily totals. It reads stored columns only, never samples.
- [ ] Settings shows the three settings laid out like the existing Directory settings, with the projection and measured throughput beside them. The projection is fetched debounced as values change and never on page load.

Retention, merge, migration

- [ ] Sample retention collects only entries with no due date. A live entry's samples older than the window survive, and a dead entry's are collected as before.
- [ ] `scripts/merge-directory.sh` leaves `priority_boost` and `refresh_target` out of its update of existing rows. A row new to the target still takes every source column. This is verified by one manual run between two local databases and noted in the PR.
- [ ] One revision does five things. It renames a stored `directoryRefreshDays` to `directoryRefreshMaxDays`. It adds the nullable `refresh_target`. It rebuilds every Posting rate from stored columns (oldest = `last_post_at - (sample_count - 1) / old rate`). It recomputes live entries' due dates from the stored settings, falling back to 20 / 4 / 120. All of this is pure SQL frozen in the revision.

Tests and guards

- [ ] There are tests at the spec's seams for the probe write path and queue, the routes (settings save, min > max, projection), sample retention, the migration, and the Settings projection. The last one is a mocked Playwright spec, run with one worker. Each new assertion is mutation-tested with `scripts/mutate.py`.
- [ ] Existing guards are satisfied, not deleted: route inventories, env example defaults, Settings registry classification, generated client.
- [ ] `cd backend && uv run prek run --all-files` passes, then the backend suite.
