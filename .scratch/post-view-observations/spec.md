# Reach from View observations

Status: ready-for-agent

A Channel's Reach is today a Directory-only statistic, `median_views`, computed from one preview
page whose newest Posts are hours old, so it reads low for any busy Channel. Followed Channels have
no Reach at all, and a stored Post's View count is frozen at whatever age sync first saw it. This
spec refreshes View counts during sync, records a sample of View observations, fits a Settling
curve from them every day, and computes Reach the same way for followed Channels and Directory
entries, estimating it where too few Posts are Settled. Settled in a grilling session on
2026-09-27; the storage change is recorded in
[ADR-024](../../docs/migration/ADR-024-view-counts-are-observations.md), which supersedes the
storage part of ADR-023. The terms **View count**, **Settled View count**, **Reach**, **Settling
curve** and **View observation** are defined in `CONTEXT.md`. Ticket ids use the prefix `REACH`.

## Problem Statement

An Operator judging a Channel wants to know how many people a Post from it typically reaches. The
number the Directory shows today is biased low, because the preview page it is computed from
contains Posts only hours old: a Post captured under 3 hours after publication has about 20% of the
View count it will settle at, and a Channel posting more than 20 times a day has its whole sample
that young. A Channel the Account follows shows no Reach anywhere, and its stored Posts cannot
supply one honestly: sync never revisits a stored Post, so its View count is whatever it was the
moment sync first met it, and on the incremental pass that is usually within hours of publication.

Measured on staging (2026-09-27, 491,420 Posts): relative to the median View count of Posts
captured at 14 days or older, Posts captured at 0 to 3h hold 0.20, 3 to 6h 0.59, 6 to 12h 0.70,
12 to 24h 0.86 and 24 to 48h 0.89, flat thereafter. The median active Channel posts 3 times a day;
62 of 230 post more than 20.

## Solution

Sync refreshes the View count and reaction chips of every stored Post it meets again on a page,
until the Post is 7 days old, and records when it saw them. A sample of those sightings is kept as
View observations for 14 days, and every day the worker fits one global Settling curve from them:
how far along its climb a View count typically is at a given age. Reach is the median Settled View
count of a Channel's newest Posts. When fewer than five of them are Settled, Reach is estimated from
younger View counts through the Settling curve and marked as an estimate. A followed Channel's Reach
comes from its stored Posts; an unfollowed Directory entry's comes from its preview sample. The
Operator can tune the settling age, the estimation floor, how many Posts Reach reads and how often
the curve is refitted.

## User Stories

1. As an Operator, I want every followed Channel to show its Reach, so that I can compare Channels I already read by how many people they reach.
2. As an Operator, I want a Directory entry's Reach to reflect Settled View counts rather than hours-old ones, so that a busy Channel is not ranked below a quiet one for posting often.
3. As an Operator, I want Reach marked as an estimate when it was derived from young View counts, so that I know how much weight to give it.
4. As an Operator, I want Reach shown as "not measured" when there is not enough to measure or estimate it, so that an absent number is never mistaken for zero.
5. As an Operator, I want the same definition of Reach for a followed Channel and a Directory entry, so that the two numbers are comparable across the Discover and Channels views.
6. As an Operator, I want a followed Channel's Directory entry to show the Reach computed from its stored Posts, so that one Channel never shows two different Reach values.
7. As an Operator, I want the Discover candidate table to sort by Reach, so that I can find the Channels with the largest audiences first.
8. As an Operator whose saved Discover sort was "Median views", I want it to become "Reach" without resetting, so that my preferences survive the rename.
9. As an Operator, I want to set the settling age (default 24 hours), so that I can decide how old a View count must be before it counts as Settled.
10. As an Operator, I want the settling age refused when it is not below the 7-day refresh horizon, so that a Settled View count is always one sync could still observe.
11. As an Operator, I want to set the estimation floor (default 3 hours), so that View counts too young to correct reliably are never used.
12. As an Operator, I want the estimation floor refused when it is not below the settling age, so that the two settings cannot contradict each other.
13. As an Operator, I want to set how many of a Channel's newest Posts Reach reads (default 100), so that I can trade responsiveness against stability.
14. As an Operator, I want to set how often the Settling curve is refitted (default daily), so that the curve keeps up with the corpus without refitting needlessly.
15. As an Operator, I want the Settling curve refitted immediately when I change the settling age, so that estimates never use a curve anchored at the old age.
16. As an Operator, I want every stored Post's View count to keep updating while sync still meets it, so that the View counts I read in the feed are not frozen at their first minutes.
17. As an Operator, I want reaction chips refreshed together with the View count, so that the reaction counts I see come from the same moment as the views.
18. As an Operator, I want a Post's per-chip reaction counts to keep the paid Stars chip distinct, so that paid reactions are never mixed into emoji counts.
19. As an Account reading the feed, I want a View count refresh not to make my feed refetch, so that a sync that found nothing new costs my browser nothing.
20. As an Operator, I want a refresh never to change a Post's retrieval provenance, language or reference-extraction state, so that re-reading a View count does not send the Post back through unrelated pipelines.
21. As an Operator, I want View observations kept only for a sample of Posts and only for 14 days after publication, so that the table stays small however large the corpus grows.
22. As an Operator, I want the observation sample to shrink automatically when the table is forecast to exceed its row cap, so that disk use has a hard ceiling.
23. As an Operator, I want the observation sample to grow again when load falls well below the cap, so that the curve is fitted from as much data as the budget allows.
24. As an Operator, I want the sample to change size without flapping, so that a busy evening followed by a quiet night does not repeatedly delete half the table.
25. As an Operator, I want the row cap set by an environment variable with its approximate disk cost documented in `.env.example`, so that I can size it against the server's disk.
26. As an Operator, I want a fresh deployment to estimate Reach from day one with a seed curve, so that estimates do not wait for the first fit.
27. As an Operator, I want a stretch of the curve with too few observations to fall back to the seed curve, so that one thin age range never produces a wild estimate.
28. As an Operator, I want a fit with no usable stretch at all to be discarded, so that an empty table never replaces a good curve.
29. As an Operator, I want every fit kept with the number of pairs, Posts and Channels it learned from, so that I can explain why an estimated Reach moved.
30. As an Operator, I want each fit to record the observation stride it ran under, so that I can tell when sampling thinned the data a curve came from.
31. As a maintainer, I want the seed curve replaced by a curve fitted from real observations once a few days of data exist, so that estimates no longer depend on a one-off cross-Post measurement.
32. As an Operator, I want existing Directory entries' Reach recomputed from their stored samples under the new rule, so that old and new definitions of Reach are never shown side by side.
33. As an Operator, I want the counters moved out of Post media without losing any stored View count or reaction chip, so that the migration is invisible in the feed.
34. As an Operator exporting data, I want export and import to carry View counts, reaction chips and their observation time, so that a restored deployment keeps them.
35. As an Operator, I want the observation and fit tables left out of account exports, so that an export stays about one Account's data.
36. As an Account, I want a followed Channel's Reach computed from the corpus rather than only the Posts I can see, so that the number describes the Channel and not my Follow.

## Implementation Decisions

### Counters on Posts (supersedes the storage part of ADR-023)

- `tg_posts` gains three nullable columns: an integer View count, a jsonb list of reaction chips in the existing `{emoji | customEmojiId, count, isPaid}` shape, and a millisecond timestamp of when they were observed. `NULL` still means "the page showed none", never zero.
- The counters leave the Post media JSON. The parser still produces them inside media; the Post write path lifts them out into the columns, so there is one reader of the parser's shape. The reaction total is never stored; it is summed from the chips when needed.
- A new Post's observation time is its retrieval time. The backfill sets it to `retrieved_at` for every existing Post, which is exact because nothing has refreshed any Post before this change.
- The backfill copies the counters into the columns and strips the media keys in a batched script after deploy (ADR-023's pattern), never inside the migration. Readers switch to the columns in the same release, so leftover media keys are inert until the script runs. Since REACH-10 `prestart.sh` runs it on every deploy with `--if-needed`, so every deployment converges without an Operator step.
- The API exposes `viewsCount`, `reactionCounts` and `viewsObservedAt` on the Post, not inside `media`. The frontend's two readers of `media.viewsCount` and its reaction readers move to the new fields. Import accepts only the new shape; no export in the old shape exists.
- `tg_posts` gets `fillfactor = 90` and the counter columns get no index, so a refresh can be a HOT update.

### Refresh on overlap

- When a scraped page contains Posts already stored, sync updates their View count, reaction chips and observation time with one narrow statement per page, for Posts younger than the fixed 7-day refresh horizon. It stamps the observation time even when the count is unchanged, because Telegram's rounded display holds one value for hours and a skipped stamp would make a Settled Post look young.
- The refresh writes nothing else: not `retrieval_*`, not `updated_at`, not `language`, not `references_extracted`, and it never runs the full Post upsert.
- The refresh does not bump the posts etag. The incremental pass still stops on the overlap page exactly as today.
- The refresh horizon is a code constant, not a setting. The settling age setting is validated to be below it.
- The initial pass is different. It re-upserts every Post on its page through the full Post upsert, stored ones included, and REACH-02 let that upsert refresh a stored Post's counters whatever the Post's age. Since REACH-10 every pass re-observes a stored Post's counters through the one horizon-bounded refresh, and the initial pass's upsert leaves them alone, so no pass refreshes a Post older than the horizon.

### View observations

- A new table `tg_view_observations` holds one row per sighting: the Post, its View count, and its age at the sighting as the Post's publication time and the observation time. Rows are written at first capture and at every refresh, for Posts selected by the current Observation stride.
- A Post is selected when `(post_id - 1) % stride == 0`, where `post_id` is Telegram's per-Channel id. The stride is a power of two starting at 1 (every Post). A Post selected at stride `2s` is selected at stride `s`, so doubling only removes rows and halving only adds future ones. The album-parity bias (a Channel whose Posts always consume an even number of ids is wholly in or out above stride 1) is accepted; each fit records its Channel count so a collapse is visible.
- Rows are deleted once their Post is 14 days past publication, all of one Post's rows together. Deleting a Post cascades to its observations.
- The row cap is an environment variable, default 1,000,000, documented in `.env.example` with its measured disk cost.
- The stride lives in a runtime row in `tg_app_settings`, classified in the settings registry as deployment state, as `sync_runtime` is.
- An hourly worker job decides the stride from a forecast 6 hours ahead: rows now, plus the inflow rate measured over the last 6 hours times 6 hours, minus the rows whose Posts pass 14 days within those 6 hours. It doubles the stride and deletes the rows no longer selected when the forecast exceeds the cap. It halves the stride when the forecast recomputed at doubled inflow stays under half the cap, so the two thresholds are a full doubling apart and cannot flap.
- The decision is a pure function of (row count, recent inflow, rows expiring, cap, current stride) returning the next stride; the job only gathers the numbers and applies the answer.

### Settling curve

- A daily worker job (interval configurable, default 24 hours) fits one global curve, and the same job runs immediately when the settling age changes.
- The curve is piecewise-linear log share over log age, with about 16 knots log-spaced from 30 minutes to 7 days. Each pair of consecutive observations of one Post at ages `a < b` contributes one linear equation `log F(b) − log F(a) = log(views_b / views_a)`, however many knots it spans. The system is solved by least squares with numpy, made non-decreasing by pool-adjacent-violators, and anchored at `F(settling age) = 1`. Only consecutive pairs are used, because they telescope: a Post with 100 sightings would otherwise contribute 4,950 correlated pairs.
- Every Post in the table contributes equally; there is no weighting by Channel and no condition on which page a Post was seen on. A Post with one observation contributes nothing.
- A span between knots with fewer than 30 pairs takes its shape from the seed curve. A fit where every span falls back is not stored.
- Fits go to a new table, one row per fit: the knots, the settling age it was anchored at, the observation stride at the time, and the counts of pairs, Posts and Channels it used. Rows are kept forever and excused from retention with that reason. The current curve is the newest row; before any fit, the seed curve in code is used.
- The seed curve starts as the staging measurement above. A follow-up ticket replaces it with a curve fitted from real observations once a few days of data exist.
- The fit is a pure function of (pairs, settling age, seed) returning knots or nothing; the job gathers pairs through `unscoped_select(reason=...)`, since the curve is a corpus fact.

### Reach

- One pure function computes Reach from a list of (View count, age at observation) pairs, the settings and the current curve, and returns the value and whether it was estimated. Both sources call it.
- Reach reads a Channel's newest N Posts (setting, default 100). If at least five are Settled (observed at or past the settling age), Reach is their median. Otherwise the Posts aged between the estimation floor and the settling age are each divided by the curve's share at their age, and Reach is the median of the Settled and corrected counts, marked as an estimate, provided at least five such Posts exist. Otherwise Reach is not measured.
- A followed Channel's Reach is computed on read from its stored Posts over the corpus, by Channel name, because Posts are shared by every Follower. For a Channel the caller follows this is the same set a follow-scoped read would return (a Post has no owner, and the follow-scoped `EXISTS` asks only whether the caller follows the Channel), and both stats reads answer only for followed Channels, so no test can tell the two apart and none tries. The Channel stats reads carry `reach` and `reachEstimated`: `GET /data/channels/stats` for the list and `GET /data/channels/{id}/stats` for one Channel. The plain Channel list `GET /data/channels` does not, because Reach is a Post aggregate like the other stats and the grid paints before they load. The scheduler's `compute_channel_stats_batch` does not compute Reach.
- An unfollowed Directory entry's Reach is computed at probe time from its sample (each sample's age is its probe time minus its publication time) and stored on the entry. `median_views` is renamed `reach`, and a boolean `reach_estimated` is added. A Directory entry whose Channel is followed by any Account shows the Post-based Reach instead of the stored one.
- Existing entries' Reach is recomputed from their stored samples by a batched script after deploy. When the settling age changes, stored Directory Reach catches up at each entry's next probe, with no recompute sweep.
- The wire field `medianViews` becomes `reach` plus `reachEstimated`. The Discover sort key and its label change to Reach, and the settings schema maps the stored legacy sort value to the new key.

### Settings

- The Reach settings are one `reach` row in `tg_app_settings`, classified in the settings registry, holding `settlingAgeHours` (default 24, must be below 168), `estimationFloorHours` (default 3, must be below the settling age) and `reachSampleSize` (Posts, default 100, at least 5). One row rather than three keys, because the settling age and the floor are validated against each other and the store merges a PUT into the stored row. `PUT /data/settings/reach` validates the merged row and answers 422 with the reason.
- The curve refit interval (hours, default 24) arrives with REACH-07 as a fourth field of the same row.
- The row cap is an environment variable, not a setting.

## Testing Decisions

- Tests assert behaviour visible from outside the seam: what a page does to stored rows, what a probe stores, what an API response carries, what a pure function returns. They never assert which SQL ran or how a function is split.
- Seam 1, `_apply_scrape_page` (prior art: `tests/services/test_sync_orchestrator.py`): a page overlapping stored Posts refreshes their counters and observation time; a Post older than 7 days is not refreshed; an unchanged count still moves the observation time; provenance, language and reference state are untouched; the etag does not move; an observation row is written only for Posts the stride selects; the incremental pass still stops.
- Seam 2, `record_probe_result` (prior art: `tests/services/test_directory_statistics_write_path.py`): a probe stores measured Reach when five samples are Settled, estimated Reach when fewer are Settled but five are past the floor, and nothing when neither holds.
- Seam 3, the Channel and Directory API responses (prior art: `tests/api/test_*_projection.py` and `tests/api/test_account_isolation.py`): a followed Channel's Reach comes from the corpus, a Directory entry of a followed Channel shows the Post-based Reach, and response key sets are updated rather than the projection guards deleted.
- Seam 4, the Reach function (prior art: `tests/services/test_directory_statistics.py`): measured, estimated and not measured, the floor excluding young Posts, the five-Post minimum on each path, the median of an even set rounding as the existing statistic does.
- Seam 5, the curve fit and the stride decision as pure functions, each driven by a thin job (prior art: `tests/jobs/test_post_language_walk.py`, `tests/jobs/test_retention_split_four_ways.py`). The fit recovers a known curve from synthetic pairs, is monotone, is anchored at the settling age, falls back per span below 30 pairs, and returns nothing when every span falls back. The stride doubles above the cap, halves only when doubled inflow stays under half, and holds in between; a doubling deletes exactly the rows no longer selected.
- Existing guards that must be updated, not deleted: the settings-table split guard (the `reach` row and a runtime row), the tenancy seam classification and the cleanup inventory (two new tables), the retention inventories (the observation prune is its own rule, the fits table is excused), the export coverage guard (counters travel with Posts, the two new tables are omissions with reasons), `types.conform.ts`, `client-split.conform.ts`, the `.env.example` defaults guard, and the CLAUDE.md budget guard if a rule is added.
- Every new guard is mutation-tested: watch it go red before trusting it.

## Out of Scope

- The Audience check (Reach against subscribers, View count dispersion, reactions per view) and any credibility score.
- A paid-reactions signal.
- Separate curves per kind of Channel (fast or slow, large or small).
- Extra Requests to fetch older pages for a probe or a sync, for any purpose in this spec.
- Refreshing a Post's text, links or any field other than its counters.
- A history of a Post's View count beyond the 14-day observation window.
- Rewriting recorded sync-log payloads, which age out on their own retention.

## Further Notes

- The fast Channels, whose Posts leave the first page within hours, are exactly the ones that need estimates and exactly the ones that cannot teach the late part of the curve. Their early sightings still teach the young spans; the single global curve covers the rest.
- The seed curve is cross-Post data confounded by Channel growth. It is a starting point, and REACH's seed-replacement ticket exists so nobody treats it as a measurement.
- Staging's corpus is about 491K Posts and about 75K are published in any 14 days. At stride 1 the observation table's size depends on sync frequency; the stride controller exists so that number never needs predicting.
