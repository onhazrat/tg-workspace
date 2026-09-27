# REACH-03: Followed Channels show Reach

**What to build:** Every followed Channel shows its Reach, the median Settled View count of its
newest Posts, computed on read from the corpus. When fewer than five of those Posts are Settled,
Reach is estimated from younger View counts through the seed Settling curve and marked as an
estimate; when that is not possible either, Reach is not measured. The Channels tab gains a Reach
column. See `.scratch/post-view-observations/spec.md` ("Reach", "Settings") and ADR-024.

**Blocked by:** REACH-01

**Status:** resolved

### Backend

- [x] Three deployment settings in `tg_app_settings`, each classified in the settings registry with a sentence: settling age (hours, default 24, refused unless below 168), estimation floor (hours, default 3, refused unless below the settling age) and Reach sample size (Posts, default 100)
- [x] One pure Reach function takes (View count, age at observation) pairs, the settings and a curve, and returns the value and whether it was estimated
- [x] Measured: when at least five of the newest N Posts were observed at or past the settling age, Reach is the median of those Settled View counts
- [x] Estimated: otherwise each Post aged between the estimation floor and the settling age is divided by the curve's share at its age, and Reach is the median of the Settled and corrected counts, marked as an estimate, provided at least five such Posts exist
- [x] Not measured otherwise, answered as `null` and never zero
- [x] The seed curve is a code constant (0 to 3h 0.20, 3 to 6h 0.59, 6 to 12h 0.70, 12 to 24h 0.86, 24 to 48h 0.89, relative to the 14-day median), rescaled so the share at the settling age is 1
- [x] The Channel list and detail responses carry `reach` and `reachEstimated`, computed on read over the corpus (every Follower's Posts, not only the caller's Follows); the list computes it in one query, not one per Channel
- [x] Tests of the pure function (prior art: `tests/services/test_directory_statistics.py`): measured, estimated and not measured; the floor excluding young Posts; the five-Post minimum on each path; an even set's median rounding as the existing statistic does
- [x] API test: a followed Channel's Reach comes from the corpus, including Posts only a second Account's Follow brought in
- [x] The settings-table split guard (three new keys), the Channel projection guards and the account-isolation probes are updated, not deleted; the client is regenerated

### Frontend

- [x] The Channels tab shows a Reach column, with an estimate marker when `reachEstimated` is true and "not measured" when `reach` is `null`
- [x] The three settings are editable in the deployment settings section, declared in `src/lib/settings/schema.ts`, and a refused value shows the server's message
- [x] `types.conform.ts` is updated; unit tests cover measured, estimated and not measured cells
- [x] Every new guard and test is mutation-tested (watched red before trusted)

### Resolution notes

- The three settings are one `reach` row (`settlingAgeHours`, `estimationFloorHours`,
  `reachSampleSize`) rather than three keys, because two of them are validated against each
  other and the store merges a PUT into the stored row. `PUT /data/settings/reach` answers 422
  with the reason.
- Reach rides the stats reads, `GET /data/channels/stats` (list) and
  `GET /data/channels/{id}/stats` (detail), not `GET /data/channels`: it is a Post aggregate like
  the other four, and the grid paints without those on purpose. The scheduler's
  `compute_channel_stats_batch` does not compute it.
- The pure function and the seed curve are `app/services/reach.py`; the corpus read is
  `channels.reach_by_channel(session, names)`. REACH-04 can call both.
- The Channels tab is a card grid, so the "column" is a Reach chip on each card.
